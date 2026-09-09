import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServices } from "../src/api/app.js";
import { createDatabase } from "../src/database/database.js";
import { startClient } from "./helpers/testClient.js";
import { LeadsRepository } from "../src/modules/data-foundation/leadsRepository.js";

test("intelligence run creates versioned evidence, claims, signals, qualification, and recommendation", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Intelligence Org");
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Priya Sharma",
    email: " Priya@Example.COM ",
    company: "Northstar Interiors"
  });

  const result = await client.post(`/api/leads/${leadResponse.lead.id}/intelligence/run`, {
    organization_id: organization.organization.id
  });

  assert.equal(result.intelligence.version, 1);
  assert.equal(result.intelligence.status, "READY");
  assert.equal(result.intelligence.readiness_status, "READY_FOR_INTELLIGENCE");
  assert.notEqual(result.intelligence.readiness_score, 64);
  assert.equal(result.intelligence.score, result.intelligence.readiness_score);
  assert.equal(result.intelligence_status, "GENERATED");
  assert.equal(result.readiness.status, "READY");
  assert.equal(result.intelligence.recommendation.action_type, "READY_FOR_RESEARCH");
  assert.equal(result.intelligence.recommendation.outbound_action_type, "CREATE_HUMAN_TASK");
  assert.equal(result.intelligence.claims.some((claim) => claim.field === "CONTACT_EMAIL"), true);
  assert.equal(result.intelligence.claims.some((claim) => claim.field === "COMPANY_INDUSTRY"), false);
  assert.equal(result.intelligence.evidence.every((evidence) => evidence.source_url === null), true);
  assert.equal(result.intelligence.evidence.some((evidence) => evidence.source_type === "MANUAL"), true);
  assert.equal(result.intelligence.signals.some((signal) => signal.type === "CONTACT_INFORMATION_AVAILABLE"), true);
  assert.equal(result.intelligence.qualification.status, "FOUNDATION_READY");
  assert.equal((await client.db.all("SELECT * FROM actions WHERE lead_id = ?", [leadResponse.lead.id])).length, 0);
});

test("lead with enough data can be ready to run before intelligence is generated", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Not Run Org");
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Ready Person",
    email: "ready@example.com",
    source: "MANUAL"
  });

  const lead = await client.get(`/api/leads/${leadResponse.lead.id}?organization_id=${organization.organization.id}`);

  assert.equal(lead.lead.status, "NEW");
  assert.equal(lead.lead.intelligence, null);
  assert.equal(lead.lead.intelligence_context.intelligence_status, "NOT_RUN");
  assert.equal(lead.lead.intelligence_context.readiness.status, "READY");
  assert.equal(lead.lead.intelligence_context.recommendation, null);
});

test("email presence alone does not create an outbound contact recommendation", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Email Boundary Org");
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Email Only",
    email: "email-only@example.com",
    source: "MANUAL"
  });

  const result = await client.post(`/api/leads/${leadResponse.lead.id}/intelligence/run`, {
    organization_id: organization.organization.id
  });

  assert.equal(result.intelligence.recommendation.action_type, "READY_FOR_RESEARCH");
  assert.equal(result.intelligence.recommendation.outbound_action_type, "CREATE_HUMAN_TASK");
  assert.equal(result.intelligence.recommendation.action_type.startsWith("CONTACT_VIA_"), false);
  assert.equal((await client.db.all("SELECT * FROM actions WHERE lead_id = ?", [leadResponse.lead.id])).length, 0);
});

test("deterministic signals only use usable current lead fields", async () => {
  const db = await createDatabase(":memory:");
  const services = createServices(db);
  try {
    const organization = await services.leadsRepository.createOrganization({ name: "Signal Rules Org" });
    const emailOnly = await services.leadsRepository.createLead({
      organization_id: organization.id,
      name: "Email Only",
      email: "email@example.com",
      source: "MANUAL"
    });
    const phoneOnly = await services.leadsRepository.createLead({
      organization_id: organization.id,
      name: "Phone Only",
      phone: "+14155551234",
      normalized_phone: "+14155551234",
      source: "MANUAL"
    });
    const emailAndPhone = await services.leadsRepository.createLead({
      organization_id: organization.id,
      name: "Both Contacts",
      email: "both@example.com",
      phone: "+919876543210",
      normalized_phone: "+919876543210",
      company: "Both Co",
      source: "MANUAL"
    });
    const invalidContact = await services.leadsRepository.createLead({
      organization_id: organization.id,
      name: "Invalid Contact",
      email: "not-an-email",
      phone: "abc123",
      source: "CSV"
    });
    const duplicate = await services.leadsRepository.createLead({
      organization_id: organization.id,
      name: "Duplicate Lead",
      email: "duplicate@example.com",
      source: "MANUAL",
      source_metadata: {
        duplicate_candidates: [{ duplicate_type: "STRONG_EMAIL", matched_lead_id: "lead_existing" }]
      }
    });

    assert.deepEqual(signalTypes(await services.intelligenceService.runForLead(emailOnly)), [
      "COMPANY_MISSING",
      "CONTACT_INFORMATION_AVAILABLE",
      "EMAIL_AVAILABLE",
      "PROVENANCE_AVAILABLE"
    ]);
    assert.deepEqual(signalTypes(await services.intelligenceService.runForLead(phoneOnly)), [
      "COMPANY_MISSING",
      "CONTACT_INFORMATION_AVAILABLE",
      "PHONE_AVAILABLE",
      "PROVENANCE_AVAILABLE"
    ]);
    assert.deepEqual(signalTypes(await services.intelligenceService.runForLead(emailAndPhone)), [
      "COMPANY_PROVIDED",
      "CONTACT_INFORMATION_AVAILABLE",
      "EMAIL_AVAILABLE",
      "PHONE_AVAILABLE",
      "PROVENANCE_AVAILABLE"
    ]);
    assert.deepEqual(signalTypes(await services.intelligenceService.runForLead(invalidContact)), [
      "COMPANY_MISSING",
      "DATA_INCOMPLETE"
    ]);
    assert.equal((await services.intelligenceService.runForLead(invalidContact)).readiness_status, "NEEDS_MORE_DATA");
    assert.equal((await services.intelligenceService.runForLead(duplicate)).signals.some((signal) => signal.type === "DUPLICATE_WARNING"), true);
  } finally {
    await db.close();
  }
});

test("incomplete lead produces needs-more-data readiness without fabricating facts", async () => {
  const db = await createDatabase(":memory:");
  const services = createServices(db);
  const leadsRepository = new LeadsRepository(db);
  try {
    const organization = await leadsRepository.createOrganization({ name: "Incomplete Org" });
    const lead = await leadsRepository.createLead({
      organization_id: organization.id,
      name: "Future Furniture",
      company: "Future Furniture",
      source: "MANUAL"
    });

    const intelligence = await services.intelligenceService.runForLead(lead);

    assert.equal(intelligence.readiness_status, "NEEDS_MORE_DATA");
    assert.equal(intelligence.recommendation.action_type, "GATHER_MORE_DATA");
    assert.equal(intelligence.recommendation.outbound_action_type, "CREATE_HUMAN_TASK");
    assert.equal(intelligence.claims.some((claim) => claim.field === "CONTACT_EMAIL"), false);
    assert.equal(intelligence.claims.some((claim) => claim.field === "COMPANY_INDUSTRY"), false);
    assert.equal(intelligence.signals.some((signal) => signal.type === "DATA_INCOMPLETE"), true);
  } finally {
    await db.close();
  }
});

test("repeated intelligence run is idempotent for the same lead data version", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Idempotent Intelligence Org");
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Asha Mehta",
    email: "asha@example.com",
    company: "Design Co"
  });

  const first = await client.post(`/api/leads/${leadResponse.lead.id}/intelligence/run`, {
    organization_id: organization.organization.id
  });
  const second = await client.post(`/api/leads/${leadResponse.lead.id}/intelligence/run`, {
    organization_id: organization.organization.id
  });

  assert.equal(first.intelligence.id, second.intelligence.id);
  assert.equal((await client.db.all("SELECT * FROM intelligence_snapshots WHERE lead_id = ?", [leadResponse.lead.id])).length, 1);
  assert.equal((await client.db.all("SELECT * FROM intelligence_claims WHERE lead_id = ?", [leadResponse.lead.id])).length > 0, true);
});

test("failed intelligence run can retry without uncontrolled duplicate snapshot children", async () => {
  const db = await createDatabase(":memory:");
  const services = createServices(db);
  try {
    const organization = await services.leadsRepository.createOrganization({ name: "Failure Retry Org" });
    const lead = await services.leadsRepository.createLead({
      organization_id: organization.id,
      name: "Meera Das",
      email: "meera@example.com",
      company: "Meera Studio"
    });

    await assert.rejects(
      async () => await services.intelligenceService.runForLead(lead, { simulate_failure_stage: "AFTER_EVIDENCE" }),
      /Simulated intelligence failure/
    );
    assert.equal((await db.all("SELECT * FROM intelligence_snapshots WHERE lead_id = ?", [lead.id])).length, 1);
    assert.equal((await db.get("SELECT status FROM intelligence_snapshots WHERE lead_id = ?", [lead.id])).status, "FAILED");

    const retried = await services.intelligenceService.runForLead(lead);

    assert.equal(retried.status, "READY");
    assert.equal((await db.all("SELECT * FROM intelligence_snapshots WHERE lead_id = ?", [lead.id])).length, 1);
    assert.equal(
      (await db.all("SELECT * FROM intelligence_evidence WHERE snapshot_id = ?", [retried.id])).length,
      retried.evidence.length
    );
  } finally {
    await db.close();
  }
});

test("new lead data version creates a new snapshot and preserves history", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("History Org");
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Kabir Singh",
    phone: "+919999911111"
  });
  const first = await client.post(`/api/leads/${leadResponse.lead.id}/intelligence/run`, {
    organization_id: organization.organization.id
  });

  await client.db.run("UPDATE leads SET company = ?, updated_at = ? WHERE id = ?", [
    "Northstar Interiors",
    new Date().toISOString(),
    leadResponse.lead.id
  ]);
  const second = await client.post(`/api/leads/${leadResponse.lead.id}/intelligence/run`, {
    organization_id: organization.organization.id
  });
  const history = await client.get(`/api/leads/${leadResponse.lead.id}/intelligence/history?organization_id=${organization.organization.id}`);

  assert.equal(first.intelligence.version, 1);
  assert.equal(second.intelligence.version, 2);
  assert.equal(history.snapshots.length, 2);
  assert.equal(history.snapshots[0].status, "READY");
  assert.equal(history.snapshots[1].status, "SUPERSEDED");
});

test("changed lead data does not expose stale snapshot as current intelligence", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Stale Snapshot Org");
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Stale Lead",
    email: "stale@example.com"
  });
  const first = await client.post(`/api/leads/${leadResponse.lead.id}/intelligence/run`, {
    organization_id: organization.organization.id
  });

  await client.db.run("UPDATE leads SET company = ?, updated_at = ? WHERE id = ?", [
    "Changed Company",
    new Date().toISOString(),
    leadResponse.lead.id
  ]);
  const current = await client.get(`/api/leads/${leadResponse.lead.id}/intelligence?organization_id=${organization.organization.id}`);
  const history = await client.get(`/api/leads/${leadResponse.lead.id}/intelligence/history?organization_id=${organization.organization.id}`);

  assert.equal(first.intelligence.status, "READY");
  assert.equal(current.intelligence_status, "NOT_RUN");
  assert.equal(current.intelligence, null);
  assert.equal(history.snapshots.length, 1);
  assert.equal(history.snapshots[0].id, first.intelligence.id);
});

test("CSV import provenance becomes scoped customer-provided intelligence evidence", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("CSV Evidence Org");
  const preview = await client.post("/api/imports/csv/preview", {
    organization_id: organization.organization.id,
    filename: "evidence.csv",
    csv_text: "Name,Email,Company\nNisha Rao,nisha@example.com,Northstar Interiors",
    default_phone_region: "INTERNATIONAL_ONLY"
  });
  await client.post(`/api/imports/${preview.import.id}/commit`, {
    organization_id: organization.organization.id,
    selected_row_ids: preview.rows.map((row) => row.id)
  });
  await client.post("/api/worker/run", {});
  const leads = await client.get(`/api/leads?organization_id=${organization.organization.id}&source=CSV`);
  const intelligence = await client.get(`/api/leads/${leads.leads[0].id}/intelligence?organization_id=${organization.organization.id}`);

  assert.equal(intelligence.intelligence.evidence.some((evidence) => evidence.source_type === "CSV"), true);
  assert.equal(
    intelligence.intelligence.evidence.some((evidence) => evidence.raw_content_reference === `import_row:${preview.rows[0].id}`),
    true
  );
  assert.equal(intelligence.intelligence.claims.some((claim) => claim.field === "PROVENANCE"), true);
});

test("intelligence APIs are organization scoped, and no session at all is rejected outright", async (t) => {
  const client = await startClient(t);
  const firstOrg = await client.register("Intel Tenant A");
  const leadResponse = await client.post("/api/leads", {
    organization_id: firstOrg.organization.id,
    name: "Tenant Lead",
    email: "tenant-intel@example.com",
    company: "Tenant Co"
  });
  await client.post(`/api/leads/${leadResponse.lead.id}/intelligence/run`, {
    organization_id: firstOrg.organization.id
  });

  await client.register("Intel Tenant B"); // switches the active session to org B

  const wrongRead = await client.rawFetch(`/api/leads/${leadResponse.lead.id}/intelligence`);
  const wrongRun = await client.rawFetch(`/api/leads/${leadResponse.lead.id}/intelligence/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  // A request carrying no session cookie at all must be rejected before it ever reaches route
  // logic — organization_id can't save it, since there's no session to derive one from.
  const noSession = await fetch(`${client.baseUrl}/api/leads/${leadResponse.lead.id}/intelligence`);

  assert.equal(wrongRead.status, 404);
  assert.equal(wrongRun.status, 404);
  assert.equal(noSession.status, 401);
  assert.equal((await client.db.all("SELECT * FROM intelligence_snapshots WHERE lead_id = ?", [leadResponse.lead.id])).length, 1);
});

test("intelligence state persists after restart", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-lead-m2-"));
  const databaseFile = path.join(tempDir, "app.db");
  let firstClient;
  let secondClient;

  try {
    firstClient = await startClient(t, databaseFile, { autoCleanup: false });
    const organization = await firstClient.register("Intelligence Restart Org");
    const leadResponse = await firstClient.post("/api/leads", {
      organization_id: organization.organization.id,
      name: "Devika Iyer",
      email: "devika@example.com",
      company: "Restart Co"
    });
    const generated = await firstClient.post(`/api/leads/${leadResponse.lead.id}/intelligence/run`, {
      organization_id: organization.organization.id
    });
    await firstClient.stop();

    secondClient = await startClient(t, databaseFile, { autoCleanup: false });
    await secondClient.login(organization.user.email);
    const persisted = await secondClient.get(
      `/api/leads/${leadResponse.lead.id}/intelligence?organization_id=${organization.organization.id}`
    );

    assert.equal(persisted.intelligence.id, generated.intelligence.id);
    assert.equal(persisted.intelligence.claims.length, generated.intelligence.claims.length);
    assert.equal(persisted.intelligence.recommendation.action_type, "READY_FOR_RESEARCH");
  } finally {
    await firstClient?.stop();
    await secondClient?.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("duplicate warnings from import provenance are available in lead detail context", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Duplicate Detail Org");
  await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Existing Lead",
    email: "same@example.com",
    source: "MANUAL"
  });
  const preview = await client.post("/api/imports/csv/preview", {
    organization_id: organization.organization.id,
    filename: "duplicates.csv",
    csv_text: "Name,Email,Company\nImported Lead,same@example.com,Northstar Interiors",
    default_phone_region: "INTERNATIONAL_ONLY"
  });
  const committed = await client.post(`/api/imports/${preview.import.id}/commit`, {
    organization_id: organization.organization.id,
    selected_row_ids: [preview.rows[0].id]
  });
  const importedLeadId = committed.rows[0].created_lead_id;

  const detail = await client.get(`/api/leads/${importedLeadId}?organization_id=${organization.organization.id}`);

  assert.equal(detail.lead.source_metadata.duplicate_candidate_count > 0, true);
  assert.equal(detail.lead.source_metadata.duplicate_candidates.length > 0, true);
  assert.equal(detail.lead.source_metadata.duplicate_candidates[0].duplicate_type, "STRONG_EMAIL");
});

function signalTypes(intelligence) {
  return intelligence.signals.map((signal) => signal.type).sort();
}
