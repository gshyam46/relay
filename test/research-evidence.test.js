import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServices } from "../src/api/app.js";
import { createDatabase } from "../src/database/database.js";
import { startClient } from "./helpers/testClient.js";
import {
  normalizeResearchEvidenceItem,
  validateResearchEvidenceItem
} from "../src/modules/lead-intelligence/researchProviderContract.js";

test("research evidence contract normalizes approved provider evidence", async () => {
  const normalized = normalizeResearchEvidenceItem(
    {
      source_type: " approved_research ",
      source_reference: " source-ref ",
      source_url: " https://example.com/profile ",
      title: " Company page ",
      claim_field: "COMPANY_NAME",
      claim_value: " Northstar Interiors ",
      confidence: " high ",
      metadata: { note: "manual QA" }
    },
    { provider_key: "APPROVED_MANUAL_RESEARCH" }
  );

  assert.equal(normalized.source_type, "APPROVED_RESEARCH");
  assert.equal(normalized.source_reference, "source-ref");
  assert.equal(normalized.source_url, "https://example.com/profile");
  assert.equal(normalized.title, "Company page");
  assert.equal(normalized.claim_field, "COMPANY_NAME");
  assert.equal(normalized.claim_value, "Northstar Interiors");
  assert.equal(normalized.confidence, "HIGH");
  assert.deepEqual(normalized.metadata, {
    provider_key: "APPROVED_MANUAL_RESEARCH",
    note: "manual QA"
  });
  assert.deepEqual(validateResearchEvidenceItem(normalized), []);
});

test("research evidence contract rejects unsupported fields and invalid source URLs", async () => {
  const invalid = normalizeResearchEvidenceItem(
    {
      source_type: "APPROVED_RESEARCH",
      source_url: "not-a-url",
      title: "Unsupported claim",
      claim_field: "INDUSTRY",
      claim_value: "Furniture",
      confidence: "CERTAIN"
    },
    { provider_key: "APPROVED_MANUAL_RESEARCH" }
  );

  assert.match(validateResearchEvidenceItem(invalid).join(" "), /claim_field must be a supported claim field/);
  assert.match(validateResearchEvidenceItem(invalid).join(" "), /confidence must be LOW, MEDIUM, or HIGH/);
  assert.match(validateResearchEvidenceItem(invalid).join(" "), /source_url must be an http or https URL/);
});

test("research evidence ingestion persists normalized evidence without mutating snapshots", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Research Evidence Org");
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Priya Sharma",
    email: "priya@example.com",
    company: "Northstar Interiors"
  });
  const snapshot = await client.post(`/api/leads/${leadResponse.lead.id}/intelligence/run`, {
    organization_id: organization.organization.id
  });

  const ingested = await client.post(`/api/leads/${leadResponse.lead.id}/research-evidence`, {
    organization_id: organization.organization.id,
    provider_key: "APPROVED_MANUAL_RESEARCH",
    idempotency_key: "research-evidence-1",
    evidence_items: [companyEvidence()]
  });
  const listed = await client.get(
    `/api/leads/${leadResponse.lead.id}/research-evidence?organization_id=${organization.organization.id}`
  );
  const after = await client.get(`/api/leads/${leadResponse.lead.id}/intelligence?organization_id=${organization.organization.id}`);

  assert.equal(ingested.ingestion.state, "PERSISTED");
  assert.equal(ingested.ingestion.evidence_items.length, 1);
  assert.equal(ingested.ingestion.evidence_items[0].snapshot_id, undefined);
  assert.equal(listed.evidence_items.length, 1);
  assert.equal(listed.evidence_items[0].claim_field, "COMPANY_NAME");
  assert.equal(after.intelligence, null, "new source authority requires explicit refresh");
  assert.equal(after.currentness.state, "OUTDATED");
  assert.equal((await client.db.get("SELECT id FROM intelligence_snapshots WHERE id = ?", [snapshot.intelligence.id])).id, snapshot.intelligence.id, "original snapshot history remains immutable");
  assert.equal((await client.db.all("SELECT * FROM intelligence_evidence WHERE lead_id = ?", [leadResponse.lead.id])).length > 0, true);
  assert.equal((await client.db.all("SELECT * FROM research_evidence_items WHERE lead_id = ?", [leadResponse.lead.id])).length, 1);
});

test("research evidence ingestion is idempotent for repeated commit attempts", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Research Idempotency Org");
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Asha Mehta",
    email: "asha@example.com"
  });

  const first = await client.post(`/api/leads/${leadResponse.lead.id}/research-evidence`, {
    organization_id: organization.organization.id,
    provider_key: "APPROVED_MANUAL_RESEARCH",
    idempotency_key: "same-research-evidence",
    evidence_items: [companyEvidence()]
  });
  const second = await client.post(`/api/leads/${leadResponse.lead.id}/research-evidence`, {
    organization_id: organization.organization.id,
    provider_key: "APPROVED_MANUAL_RESEARCH",
    idempotency_key: "same-research-evidence",
    evidence_items: [companyEvidence()]
  });

  assert.equal(first.ingestion.id, second.ingestion.id);
  assert.equal(first.ingestion.evidence_items[0].id, second.ingestion.evidence_items[0].id);
  assert.equal((await client.db.all("SELECT * FROM research_evidence_ingestions WHERE lead_id = ?", [leadResponse.lead.id])).length, 1);
  assert.equal((await client.db.all("SELECT * FROM research_evidence_items WHERE lead_id = ?", [leadResponse.lead.id])).length, 1);
});

test("failed research evidence ingestion can retry safely", async () => {
  const db = await createDatabase(":memory:");
  const services = createServices(db);
  try {
    const organization = await services.leadsRepository.createOrganization({ name: "Research Failure Org" });
    const lead = await services.leadsRepository.createLead({
      organization_id: organization.id,
      name: "Failure Lead",
      email: "failure@example.com",
      source: "MANUAL"
    });

    await assert.rejects(
      async () =>
        await services.researchEvidenceService.ingestForLead({
          lead,
          provider_key: "APPROVED_MANUAL_RESEARCH",
          idempotency_key: "retry-research-evidence",
          evidence_items: [companyEvidence()],
          simulate_failure_stage: "AFTER_INGESTION"
        }),
      /Simulated research evidence ingestion failure/
    );
    assert.equal((await db.get("SELECT state FROM research_evidence_ingestions WHERE lead_id = ?", [lead.id])).state, "FAILED");
    assert.equal((await db.all("SELECT * FROM research_evidence_items WHERE lead_id = ?", [lead.id])).length, 0);

    const retried = await services.researchEvidenceService.ingestForLead({
      lead,
      provider_key: "APPROVED_MANUAL_RESEARCH",
      idempotency_key: "retry-research-evidence",
      evidence_items: [companyEvidence()]
    });

    assert.equal(retried.state, "PERSISTED");
    assert.equal(retried.evidence_items.length, 1);
    assert.equal((await db.all("SELECT * FROM research_evidence_ingestions WHERE lead_id = ?", [lead.id])).length, 1);
    assert.equal((await db.all("SELECT * FROM research_evidence_items WHERE lead_id = ?", [lead.id])).length, 1);
  } finally {
    await db.close();
  }
});

test("research evidence APIs are organization scoped", async (t) => {
  const client = await startClient(t);
  const firstOrg = await client.register("Research Tenant A");
  const leadResponse = await client.post("/api/leads", {
    organization_id: firstOrg.organization.id,
    name: "Tenant Lead",
    email: "tenant-research@example.com"
  });

  await client.register("Research Tenant B"); // switches the active session to org B

  const wrongList = await client.rawFetch(`/api/leads/${leadResponse.lead.id}/research-evidence`);
  const wrongIngest = await client.rawFetch(`/api/leads/${leadResponse.lead.id}/research-evidence`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider_key: "APPROVED_MANUAL_RESEARCH",
      idempotency_key: "wrong-tenant",
      evidence_items: [companyEvidence()]
    })
  });

  assert.equal(wrongList.status, 404);
  assert.equal(wrongIngest.status, 404);
  assert.equal((await client.db.all("SELECT * FROM research_evidence_ingestions WHERE lead_id = ?", [leadResponse.lead.id])).length, 0);
});

test("research evidence state survives application restart", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-lead-m21-"));
  const databaseFile = path.join(tempDir, "app.db");
  let firstClient;
  let secondClient;

  try {
    firstClient = await startClient(t, databaseFile, { autoCleanup: false });
    const organization = await firstClient.register("Research Restart Org");
    const leadResponse = await firstClient.post("/api/leads", {
      organization_id: organization.organization.id,
      name: "Restart Lead",
      email: "restart-research@example.com"
    });
    const ingested = await firstClient.post(`/api/leads/${leadResponse.lead.id}/research-evidence`, {
      organization_id: organization.organization.id,
      provider_key: "APPROVED_MANUAL_RESEARCH",
      idempotency_key: "restart-research",
      evidence_items: [companyEvidence()]
    });
    await firstClient.stop();

    secondClient = await startClient(t, databaseFile, { autoCleanup: false });
    await secondClient.login(organization.user.email);
    const listed = await secondClient.get(
      `/api/leads/${leadResponse.lead.id}/research-evidence?organization_id=${organization.organization.id}`
    );

    assert.equal(listed.ingestions[0].id, ingested.ingestion.id);
    assert.equal(listed.evidence_items.length, 1);
    assert.equal(listed.evidence_items[0].claim_value, "Northstar Interiors");
  } finally {
    await firstClient?.stop();
    await secondClient?.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

function companyEvidence() {
  return {
    source_type: "APPROVED_RESEARCH",
    source_reference: "manual-research-note",
    source_url: "https://example.com/northstar",
    title: "Approved research note",
    claim_field: "COMPANY_NAME",
    claim_value: "Northstar Interiors",
    confidence: "MEDIUM",
    metadata: { reviewed_by: "qa" }
  };
}
