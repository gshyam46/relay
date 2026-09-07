import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp, createServices } from "../src/api/app.js";
import { createDatabase } from "../src/database/database.js";
import { validateIntelligenceRecommendationOutput } from "../src/modules/lead-intelligence/intelligenceRecommendationContract.js";

test("intelligence recommendation contract requires grounded priority, segment, personalization, and recommendation", () => {
  const errors = validateIntelligenceRecommendationOutput({
    priority: { score: 101, evidence_refs: [] },
    segment: { type: "HOT_LEAD", evidence_refs: [] },
    personalization_context: [{ label: "Company", value: "Northstar", evidence_refs: [] }],
    recommendation: { step: "SEND_EMAIL_NOW", reason: "Contact them", evidence_refs: [] }
  });

  assert.match(errors.join(" "), /priority.score/);
  assert.match(errors.join(" "), /segment.type is invalid/);
  assert.match(errors.join(" "), /personalization_context 1: evidence_refs/);
  assert.match(errors.join(" "), /recommendation.step is invalid/);
});

test("intelligence recommendation requires a current synthesis", async (t) => {
  const client = await startClient(t);
  const organization = await client.post("/api/organizations", { name: "Recommendation Not Ready Org" });
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Not Ready Lead",
    email: "not-ready-rec@example.com",
    company: "Not Ready Co"
  });
  await client.post(`/api/leads/${leadResponse.lead.id}/intelligence/run`, {
    organization_id: organization.organization.id
  });

  const current = await client.get(
    `/api/leads/${leadResponse.lead.id}/intelligence-recommendation?organization_id=${organization.organization.id}`
  );
  const run = await fetch(`${client.baseUrl}/api/leads/${leadResponse.lead.id}/intelligence-recommendation/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organization_id: organization.organization.id })
  });

  assert.equal(current.recommendation_status, "NOT_READY");
  assert.match(current.reason, /Run Lead Intelligence synthesis/);
  assert.equal(run.status, 400);
  assert.match((await run.json()).error, /Run Lead Intelligence synthesis/);
});

test("intelligence recommendation produces priority, segment, and personalization without creating actions", async (t) => {
  const client = await startClient(t);
  const organization = await client.post("/api/organizations", { name: "Recommendation Org" });
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Priya Sharma",
    email: "priya@example.com",
    company: "Northstar Interiors"
  });
  await client.post(`/api/leads/${leadResponse.lead.id}/intelligence/run`, {
    organization_id: organization.organization.id
  });
  await client.post(`/api/leads/${leadResponse.lead.id}/synthesis/run`, {
    organization_id: organization.organization.id
  });

  const result = await client.post(`/api/leads/${leadResponse.lead.id}/intelligence-recommendation/run`, {
    organization_id: organization.organization.id
  });
  const current = await client.get(
    `/api/leads/${leadResponse.lead.id}/intelligence-recommendation?organization_id=${organization.organization.id}`
  );

  assert.equal(result.intelligence_recommendation.status, "READY");
  assert.equal(result.intelligence_recommendation.segment.type, "READY_FOR_OUTBOUND_REVIEW");
  assert.equal(result.intelligence_recommendation.recommendation.step, "PREPARE_OUTBOUND_REVIEW");
  assert.equal(result.intelligence_recommendation.priority.score >= 70, true);
  assert.equal(result.intelligence_recommendation.personalization_context.some((fact) => fact.label === "Company"), true);
  assert.equal(result.intelligence_recommendation.evidence_refs.some((ref) => ref.startsWith("snapshot_evidence:")), true);
  assert.equal(current.intelligence_recommendation.id, result.intelligence_recommendation.id);
  assert.equal(client.db.all("SELECT * FROM actions WHERE lead_id = ?", [leadResponse.lead.id]).length, 0);
});

test("incomplete synthesis produces gather-more-data recommendation and low attention priority", () => {
  const db = createDatabase(":memory:");
  const services = createServices(db);
  try {
    const organization = services.leadsRepository.createOrganization({ name: "Recommendation Needs Data Org" });
    const lead = services.leadsRepository.createLead({
      organization_id: organization.id,
      name: "Future Furniture",
      company: "Future Furniture",
      source: "MANUAL"
    });
    services.intelligenceService.runForLead(lead);
    services.synthesisService.runForLead(lead);

    const recommendation = services.intelligenceRecommendationService.runForLead(lead);

    assert.equal(recommendation.segment.type, "NEEDS_DATA");
    assert.equal(recommendation.recommendation.step, "GATHER_MORE_DATA");
    assert.equal(recommendation.priority.score <= 35, true);
    assert.equal(db.all("SELECT * FROM actions WHERE lead_id = ?", [lead.id]).length, 0);
  } finally {
    db.close();
  }
});

test("duplicate warning produces duplicate-candidate recommendation instead of outbound preparation", async (t) => {
  const client = await startClient(t);
  const organization = await client.post("/api/organizations", { name: "Recommendation Duplicate Org" });
  await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Existing Lead",
    email: "same-rec@example.com"
  });
  const preview = await client.post("/api/imports/csv/preview", {
    organization_id: organization.organization.id,
    filename: "duplicate-rec.csv",
    csv_text: "Name,Email,Company\nImported Lead,same-rec@example.com,Northstar Interiors",
    default_phone_region: "INTERNATIONAL_ONLY"
  });
  const committed = await client.post(`/api/imports/${preview.import.id}/commit`, {
    organization_id: organization.organization.id,
    selected_row_ids: [preview.rows[0].id]
  });
  const importedLeadId = committed.rows[0].created_lead_id;
  await client.post(`/api/leads/${importedLeadId}/intelligence/run`, {
    organization_id: organization.organization.id
  });
  await client.post(`/api/leads/${importedLeadId}/synthesis/run`, {
    organization_id: organization.organization.id
  });

  const result = await client.post(`/api/leads/${importedLeadId}/intelligence-recommendation/run`, {
    organization_id: organization.organization.id
  });

  assert.equal(result.intelligence_recommendation.segment.type, "DUPLICATE_CANDIDATE");
  assert.equal(result.intelligence_recommendation.recommendation.step, "REVIEW_DUPLICATE_CANDIDATE");
  assert.equal(result.intelligence_recommendation.priority.score <= 55, true);
});

test("repeated intelligence recommendation run is idempotent for the same synthesis", async (t) => {
  const client = await startClient(t);
  const organization = await client.post("/api/organizations", { name: "Recommendation Idempotency Org" });
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Asha Mehta",
    email: "asha-rec@example.com",
    company: "Design Co"
  });
  await client.post(`/api/leads/${leadResponse.lead.id}/intelligence/run`, {
    organization_id: organization.organization.id
  });
  await client.post(`/api/leads/${leadResponse.lead.id}/synthesis/run`, {
    organization_id: organization.organization.id
  });

  const first = await client.post(`/api/leads/${leadResponse.lead.id}/intelligence-recommendation/run`, {
    organization_id: organization.organization.id
  });
  const second = await client.post(`/api/leads/${leadResponse.lead.id}/intelligence-recommendation/run`, {
    organization_id: organization.organization.id
  });

  assert.equal(first.intelligence_recommendation.id, second.intelligence_recommendation.id);
  assert.equal(client.db.all("SELECT * FROM intelligence_recommendation_runs WHERE lead_id = ?", [leadResponse.lead.id]).length, 1);
});

test("failed intelligence recommendation run can retry safely", () => {
  const db = createDatabase(":memory:");
  const services = createServices(db);
  try {
    const organization = services.leadsRepository.createOrganization({ name: "Recommendation Failure Org" });
    const lead = services.leadsRepository.createLead({
      organization_id: organization.id,
      name: "Failure Lead",
      email: "failure-rec@example.com",
      company: "Failure Co",
      source: "MANUAL"
    });
    services.intelligenceService.runForLead(lead);
    services.synthesisService.runForLead(lead);

    assert.throws(
      () =>
        services.intelligenceRecommendationService.runForLead(lead, {
          simulate_failure_stage: "AFTER_RECOMMENDATION"
        }),
      /Simulated intelligence recommendation failure/
    );
    assert.equal(db.get("SELECT status FROM intelligence_recommendation_runs WHERE lead_id = ?", [lead.id]).status, "FAILED");

    const retried = services.intelligenceRecommendationService.runForLead(lead);

    assert.equal(retried.status, "READY");
    assert.equal(db.all("SELECT * FROM intelligence_recommendation_runs WHERE lead_id = ?", [lead.id]).length, 1);
  } finally {
    db.close();
  }
});

test("new synthesis creates a new intelligence recommendation version and preserves history", async (t) => {
  const client = await startClient(t);
  const organization = await client.post("/api/organizations", { name: "Recommendation Version Org" });
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Devika Iyer",
    email: "devika-rec@example.com",
    company: "Restart Co"
  });
  await client.post(`/api/leads/${leadResponse.lead.id}/intelligence/run`, {
    organization_id: organization.organization.id
  });
  await client.post(`/api/leads/${leadResponse.lead.id}/synthesis/run`, {
    organization_id: organization.organization.id
  });
  const first = await client.post(`/api/leads/${leadResponse.lead.id}/intelligence-recommendation/run`, {
    organization_id: organization.organization.id
  });
  await client.post(`/api/leads/${leadResponse.lead.id}/research-evidence`, {
    organization_id: organization.organization.id,
    provider_key: "APPROVED_MANUAL_RESEARCH",
    idempotency_key: "new-evidence-for-recommendation",
    evidence_items: [companyEvidence()]
  });
  await client.post(`/api/leads/${leadResponse.lead.id}/synthesis/run`, {
    organization_id: organization.organization.id
  });
  const second = await client.post(`/api/leads/${leadResponse.lead.id}/intelligence-recommendation/run`, {
    organization_id: organization.organization.id
  });
  const history = await client.get(
    `/api/leads/${leadResponse.lead.id}/intelligence-recommendation/history?organization_id=${organization.organization.id}`
  );

  assert.equal(first.intelligence_recommendation.version, 1);
  assert.equal(second.intelligence_recommendation.version, 2);
  assert.equal(history.intelligence_recommendations.length, 2);
  assert.equal(history.intelligence_recommendations[0].status, "READY");
  assert.equal(history.intelligence_recommendations[1].status, "SUPERSEDED");
});

test("intelligence recommendation APIs are organization scoped", async (t) => {
  const client = await startClient(t);
  const firstOrg = await client.post("/api/organizations", { name: "Recommendation Tenant A" });
  const secondOrg = await client.post("/api/organizations", { name: "Recommendation Tenant B" });
  const leadResponse = await client.post("/api/leads", {
    organization_id: firstOrg.organization.id,
    name: "Tenant Lead",
    email: "tenant-rec@example.com",
    company: "Tenant Co"
  });
  await client.post(`/api/leads/${leadResponse.lead.id}/intelligence/run`, {
    organization_id: firstOrg.organization.id
  });
  await client.post(`/api/leads/${leadResponse.lead.id}/synthesis/run`, {
    organization_id: firstOrg.organization.id
  });

  const wrongRead = await fetch(
    `${client.baseUrl}/api/leads/${leadResponse.lead.id}/intelligence-recommendation?organization_id=${secondOrg.organization.id}`
  );
  const wrongRun = await fetch(`${client.baseUrl}/api/leads/${leadResponse.lead.id}/intelligence-recommendation/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organization_id: secondOrg.organization.id })
  });

  assert.equal(wrongRead.status, 404);
  assert.equal(wrongRun.status, 404);
  assert.equal(client.db.all("SELECT * FROM intelligence_recommendation_runs WHERE organization_id = ?", [secondOrg.organization.id]).length, 0);
});

test("intelligence recommendation state survives application restart", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-lead-m23-"));
  const databaseFile = path.join(tempDir, "app.db");
  let firstClient;
  let secondClient;

  try {
    firstClient = await startClient(t, databaseFile, { autoCleanup: false });
    const organization = await firstClient.post("/api/organizations", { name: "Recommendation Restart Org" });
    const leadResponse = await firstClient.post("/api/leads", {
      organization_id: organization.organization.id,
      name: "Restart Lead",
      email: "restart-rec@example.com",
      company: "Restart Co"
    });
    await firstClient.post(`/api/leads/${leadResponse.lead.id}/intelligence/run`, {
      organization_id: organization.organization.id
    });
    await firstClient.post(`/api/leads/${leadResponse.lead.id}/synthesis/run`, {
      organization_id: organization.organization.id
    });
    const generated = await firstClient.post(`/api/leads/${leadResponse.lead.id}/intelligence-recommendation/run`, {
      organization_id: organization.organization.id
    });
    await firstClient.stop();

    secondClient = await startClient(t, databaseFile, { autoCleanup: false });
    const persisted = await secondClient.get(
      `/api/leads/${leadResponse.lead.id}/intelligence-recommendation?organization_id=${organization.organization.id}`
    );

    assert.equal(persisted.intelligence_recommendation.id, generated.intelligence_recommendation.id);
    assert.equal(persisted.intelligence_recommendation.status, "READY");
    assert.equal(persisted.intelligence_recommendation.recommendation.step, "PREPARE_OUTBOUND_REVIEW");
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
    metadata: { reviewed_by: "qa" },
    ...overrides
  };
}

async function startClient(t, databaseFile = ":memory:", { autoCleanup = true } = {}) {
  const db = createDatabase(databaseFile);
  const server = createApp({ db });
  let stopped = false;

  await new Promise((resolve) => server.listen(0, resolve));
  if (autoCleanup) {
    t.after(() => stop());
  }

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  async function stop() {
    if (stopped) {
      return;
    }
    stopped = true;
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }

  return {
    baseUrl,
    db,
    stop,
    async get(route) {
      const response = await fetch(`${baseUrl}${route}`);
      if (!response.ok) {
        assert.fail(`${response.status} ${await response.text()}`);
      }
      return response.json();
    },
    async post(route, body) {
      const response = await fetch(`${baseUrl}${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        assert.fail(`${response.status} ${await response.text()}`);
      }
      return response.json();
    }
  };
}
