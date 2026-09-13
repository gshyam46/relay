import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServices } from "../src/api/app.js";
import { createDatabase } from "../src/database/database.js";
import { startClient } from "./helpers/testClient.js";
import { validateSynthesisOutput } from "../src/modules/lead-intelligence/synthesisContract.js";

const evaluationFixture = JSON.parse(
  readFileSync(new URL("./fixtures/m2.2-synthesis-evaluation.json", import.meta.url), "utf8")
);

test("synthesis contract requires evidence-grounded structured output", async () => {
  const errors = validateSynthesisOutput({
    summary: { text: "Ungrounded summary" },
    findings: [{ field: "COMPANY_NAME", value: "Northstar Interiors", evidence_refs: [] }],
    qualification: { outcome: "READY_FOR_DEEPER_INTELLIGENCE", reasons: ["Looks useful"], evidence_refs: [] },
    recommendation: { type: "READY_FOR_DEEPER_INTELLIGENCE", reason: "Proceed", evidence_refs: [] }
  });

  assert.match(errors.join(" "), /finding 1: evidence_refs/);
  assert.match(errors.join(" "), /qualification.evidence_refs/);
  assert.match(errors.join(" "), /recommendation.evidence_refs/);
});

test("M2.2 evaluation fixture covers qualification boundary cases", async () => {
  assert.equal(evaluationFixture.cases.length, 3);
  assert.deepEqual(
    evaluationFixture.cases.map((item) => item.id),
    ["ready-foundation-no-research", "ready-foundation-with-research", "incomplete-foundation"]
  );

  for (const item of evaluationFixture.cases) {
    assert.equal(typeof item.expected_qualification_outcome, "string");
    assert.equal(typeof item.expected_recommendation_type, "string");
  }
});

test("local synthesis agent satisfies the M2.2 evaluation fixture", async () => {
  const db = await createDatabase(":memory:");
  const services = createServices(db);
  try {
    const organization = await services.leadsRepository.createOrganization({ name: "Synthesis Evaluation Org" });
    for (const item of evaluationFixture.cases) {
      const lead = await services.leadsRepository.createLead({
        organization_id: organization.id,
        name: item.lead.name,
        email: item.lead.email || null,
        company: item.lead.company || null,
        source: "MANUAL"
      });
      await services.intelligenceService.runForLead(lead);
      if (item.research_evidence) {
        await services.researchEvidenceService.ingestForLead({
          lead,
          provider_key: "APPROVED_MANUAL_RESEARCH",
          idempotency_key: `evaluation-${item.id}`,
          evidence_items: item.research_evidence.map((evidence) => companyEvidence(evidence))
        });
        assert.equal((await services.intelligenceService.assessLead(lead)).snapshot, null);
        await services.intelligenceService.runForLead(lead);
      }

      const synthesis = await services.synthesisService.runForLead(lead);

      assert.equal(synthesis.qualification.outcome, item.expected_qualification_outcome);
      assert.equal(synthesis.recommendation.type, item.expected_recommendation_type);
      assert.equal(synthesis.evidence_refs.length > 0, true);
    }
  } finally {
    await db.close();
  }
});

test("synthesis requires a current Lead Intelligence snapshot", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Synthesis Not Ready Org");
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Not Ready Lead",
    email: "not-ready@example.com"
  });

  const current = await client.get(`/api/leads/${leadResponse.lead.id}/synthesis?organization_id=${organization.organization.id}`);
  const run = await client.rawFetch(`/api/leads/${leadResponse.lead.id}/synthesis/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });

  assert.equal(current.synthesis_status, "NOT_READY");
  assert.match(current.reason, /Run Lead Intelligence/);
  assert.equal(run.status, 400);
  assert.match((await run.json()).error, /Run Lead Intelligence/);
});

test("synthesis run persists evidence-grounded qualification without outbound side effects", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Synthesis Org");
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Priya Sharma",
    email: "priya@example.com",
    company: "Northstar Interiors"
  });
  let snapshot = await client.post(`/api/leads/${leadResponse.lead.id}/intelligence/run`, {
    organization_id: organization.organization.id
  });
  await client.post(`/api/leads/${leadResponse.lead.id}/research-evidence`, {
    organization_id: organization.organization.id,
    provider_key: "APPROVED_MANUAL_RESEARCH",
    idempotency_key: "synthesis-research",
    evidence_items: [companyEvidence()]
  });
  const originalSnapshotId = snapshot.intelligence.id;
  snapshot = await refreshAfterResearch(client, leadResponse.lead.id, organization.organization.id);
  assert.notEqual(snapshot.intelligence.id, originalSnapshotId);
  assert.equal((await client.db.get("SELECT status FROM intelligence_snapshots WHERE id=?", [originalSnapshotId])).status, "SUPERSEDED");

  const result = await client.post(`/api/leads/${leadResponse.lead.id}/synthesis/run`, {
    organization_id: organization.organization.id
  });
  const current = await client.get(`/api/leads/${leadResponse.lead.id}/synthesis?organization_id=${organization.organization.id}`);

  assert.equal(result.synthesis.status, "READY");
  assert.equal(result.synthesis.snapshot_id, snapshot.intelligence.id);
  assert.equal(result.synthesis.qualification.outcome, "NEEDS_REVIEW");
  assert.equal(result.synthesis.findings.some((finding) => finding.source === "APPROVED_RESEARCH_EVIDENCE"), true);
  assert.equal(result.synthesis.evidence_refs.some((ref) => ref.startsWith("snapshot_evidence:")), true);
  assert.equal(result.synthesis.evidence_refs.some((ref) => ref.startsWith("research_evidence:")), true);
  assert.equal(current.synthesis.id, result.synthesis.id);
  assert.equal((await client.db.all("SELECT * FROM actions WHERE lead_id = ?", [leadResponse.lead.id])).length, 0);
});

test("repeated synthesis run is idempotent for the same evidence input", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Synthesis Idempotency Org");
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Asha Mehta",
    email: "asha@example.com",
    company: "Design Co"
  });
  await client.post(`/api/leads/${leadResponse.lead.id}/intelligence/run`, {
    organization_id: organization.organization.id
  });

  const first = await client.post(`/api/leads/${leadResponse.lead.id}/synthesis/run`, {
    organization_id: organization.organization.id
  });
  const second = await client.post(`/api/leads/${leadResponse.lead.id}/synthesis/run`, {
    organization_id: organization.organization.id
  });

  assert.equal(first.synthesis.id, second.synthesis.id);
  assert.equal((await client.db.all("SELECT * FROM intelligence_synthesis_runs WHERE lead_id = ?", [leadResponse.lead.id])).length, 1);
});

test("failed synthesis run can retry safely", async () => {
  const db = await createDatabase(":memory:");
  const services = createServices(db);
  try {
    const organization = await services.leadsRepository.createOrganization({ name: "Synthesis Failure Org" });
    const lead = await services.leadsRepository.createLead({
      organization_id: organization.id,
      name: "Failure Lead",
      email: "failure-synthesis@example.com",
      company: "Failure Co",
      source: "MANUAL"
    });
    await services.intelligenceService.runForLead(lead);

    await assert.rejects(
      async () => await services.synthesisService.runForLead(lead, { simulate_failure_stage: "AFTER_SYNTHESIS" }),
      /Simulated synthesis failure/
    );
    assert.equal((await db.get("SELECT status FROM intelligence_synthesis_runs WHERE lead_id = ?", [lead.id])).status, "FAILED");

    const retried = await services.synthesisService.runForLead(lead);

    assert.equal(retried.status, "READY");
    assert.equal((await db.all("SELECT * FROM intelligence_synthesis_runs WHERE lead_id = ?", [lead.id])).length, 1);
    assert.equal(retried.findings.length > 0, true);
  } finally {
    await db.close();
  }
});

test("new staged research evidence creates a new synthesis version and preserves history", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Synthesis Version Org");
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Devika Iyer",
    email: "devika@example.com",
    company: "Restart Co"
  });
  await client.post(`/api/leads/${leadResponse.lead.id}/intelligence/run`, {
    organization_id: organization.organization.id
  });
  const first = await client.post(`/api/leads/${leadResponse.lead.id}/synthesis/run`, {
    organization_id: organization.organization.id
  });
  await client.post(`/api/leads/${leadResponse.lead.id}/research-evidence`, {
    organization_id: organization.organization.id,
    provider_key: "APPROVED_MANUAL_RESEARCH",
    idempotency_key: "new-evidence-for-synthesis",
    evidence_items: [companyEvidence({ claim_value: "Restart Co" })]
  });
  await refreshAfterResearch(client, leadResponse.lead.id, organization.organization.id);
  const second = await client.post(`/api/leads/${leadResponse.lead.id}/synthesis/run`, {
    organization_id: organization.organization.id
  });
  const history = await client.get(`/api/leads/${leadResponse.lead.id}/synthesis/history?organization_id=${organization.organization.id}`);

  assert.equal(first.synthesis.version, 1);
  assert.equal(second.synthesis.version, 2);
  assert.equal(history.syntheses.length, 2);
  assert.equal(history.syntheses[0].status, "READY");
  assert.equal(history.syntheses[1].status, "SUPERSEDED");
});

test("synthesis APIs are organization scoped", async (t) => {
  const client = await startClient(t);
  const firstOrg = await client.register("Synthesis Tenant A");
  const leadResponse = await client.post("/api/leads", {
    organization_id: firstOrg.organization.id,
    name: "Tenant Lead",
    email: "tenant-synthesis@example.com",
    company: "Tenant Co"
  });
  await client.post(`/api/leads/${leadResponse.lead.id}/intelligence/run`, {
    organization_id: firstOrg.organization.id
  });

  await client.register("Synthesis Tenant B"); // switches the active session to org B

  const wrongRead = await client.rawFetch(`/api/leads/${leadResponse.lead.id}/synthesis`);
  const wrongRun = await client.rawFetch(`/api/leads/${leadResponse.lead.id}/synthesis/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });

  assert.equal(wrongRead.status, 404);
  assert.equal(wrongRun.status, 404);
  assert.equal((await client.db.all("SELECT * FROM intelligence_synthesis_runs WHERE lead_id = ?", [leadResponse.lead.id])).length, 0);
});

test("synthesis state survives application restart", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-lead-m22-"));
  const databaseFile = path.join(tempDir, "app.db");
  let firstClient;
  let secondClient;

  try {
    firstClient = await startClient(t, databaseFile, { autoCleanup: false });
    const organization = await firstClient.register("Synthesis Restart Org");
    const leadResponse = await firstClient.post("/api/leads", {
      organization_id: organization.organization.id,
      name: "Restart Lead",
      email: "restart-synthesis@example.com",
      company: "Restart Co"
    });
    await firstClient.post(`/api/leads/${leadResponse.lead.id}/intelligence/run`, {
      organization_id: organization.organization.id
    });
    const generated = await firstClient.post(`/api/leads/${leadResponse.lead.id}/synthesis/run`, {
      organization_id: organization.organization.id
    });
    await firstClient.stop();

    secondClient = await startClient(t, databaseFile, { autoCleanup: false });
    await secondClient.login(organization.user.email);
    const persisted = await secondClient.get(
      `/api/leads/${leadResponse.lead.id}/synthesis?organization_id=${organization.organization.id}`
    );

    assert.equal(persisted.synthesis.id, generated.synthesis.id);
    assert.equal(persisted.synthesis.status, "READY");
    assert.equal(persisted.synthesis.findings.length, generated.synthesis.findings.length);
  } finally {
    await firstClient?.stop();
    await secondClient?.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

function companyEvidence(overrides = {}) {
  return {
    source_type: "APPROVED_RESEARCH",
    source_reference: "manual-research-note",
    source_url: "https://example.com/northstar",
    title: "Approved research note",
    claim_field: "COMPANY_NAME",
    claim_value: "Northstar Interiors",
    confidence: "MEDIUM",
    evidence_timestamp: new Date(Date.now() - 1000).toISOString(),
    metadata: { reviewed_by: "qa" },
    ...overrides
  };
}

async function refreshAfterResearch(client, leadId, organizationId) {
  const outdated = await client.get(`/api/leads/${leadId}/intelligence`);
  assert.equal(outdated.intelligence, null);
  assert.equal(outdated.currentness.state, "OUTDATED");
  return client.post(`/api/leads/${leadId}/intelligence/run`, { organization_id: organizationId });
}
