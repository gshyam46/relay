import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp, createServices } from "../src/api/app.js";
import { createDatabase } from "../src/database/database.js";
import { validateNextBestActionPlanOutput } from "../src/modules/next-best-action/nextBestActionContract.js";

test("next-best-action contract requires policy, approval, evidence, and non-executable plan", () => {
  const errors = validateNextBestActionPlanOutput({
    action_type: "SEND_EMAIL",
    title: "",
    rationale: "",
    policy_decision: { decision: "IGNORE_POLICY" },
    approval: { requirement: "AUTO_APPROVED" },
    decision_evidence_refs: [],
    execution_contract: { executable: true }
  });

  assert.match(errors.join(" "), /action_type is invalid/);
  assert.match(errors.join(" "), /title is required/);
  assert.match(errors.join(" "), /policy_decision.decision is invalid/);
  assert.match(errors.join(" "), /approval.requirement is invalid/);
  assert.match(errors.join(" "), /execution_contract.executable must be false/);
});

test("next-best-action planning requires current recommendation intelligence", async (t) => {
  const client = await startClient(t);
  const organization = await client.post("/api/organizations", { name: "NBA Not Ready Org" });
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Not Ready Lead",
    email: "not-ready-nba@example.com",
    company: "Not Ready Co"
  });

  const current = await client.get(`/api/leads/${leadResponse.lead.id}/next-best-action?organization_id=${organization.organization.id}`);
  const run = await fetch(`${client.baseUrl}/api/leads/${leadResponse.lead.id}/next-best-action/plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organization_id: organization.organization.id })
  });

  assert.equal(current.plan_status, "NOT_READY");
  assert.match(current.reason, /Run intelligence recommendation/);
  assert.equal(run.status, 400);
  assert.match((await run.json()).error, /Run intelligence recommendation/);
});

test("ready recommendation creates a policy-checked plan without executable actions", async (t) => {
  const client = await startClient(t);
  const { organization, lead } = await createReadyRecommendedLead(client, "NBA Ready Org");

  const result = await client.post(`/api/leads/${lead.id}/next-best-action/plan`, {
    organization_id: organization.id
  });
  const current = await client.get(`/api/leads/${lead.id}/next-best-action?organization_id=${organization.id}`);

  assert.equal(result.next_best_action_plan.status, "PLANNED");
  assert.equal(result.next_best_action_plan.action_type, "PREPARE_OUTBOUND_REVIEW");
  assert.equal(result.next_best_action_plan.policy_decision.decision, "REQUIRE_HUMAN_APPROVAL");
  assert.equal(result.next_best_action_plan.approval.requirement, "REQUIRED");
  assert.equal(result.next_best_action_plan.execution_contract.executable, false);
  assert.equal(result.next_best_action_plan.decision_evidence_refs.length > 0, true);
  assert.equal(current.next_best_action_plan.id, result.next_best_action_plan.id);
  assert.equal(client.db.all("SELECT * FROM actions WHERE lead_id = ?", [lead.id]).length, 0);
  assert.equal(client.db.all("SELECT * FROM action_executions").length, 0);
});

test("incomplete recommendation creates a gather-more-data plan allowed by policy", () => {
  const db = createDatabase(":memory:");
  const services = createServices(db);
  try {
    const organization = services.leadsRepository.createOrganization({ name: "NBA Needs Data Org" });
    const lead = services.leadsRepository.createLead({
      organization_id: organization.id,
      name: "Future Furniture",
      company: "Future Furniture",
      source: "MANUAL"
    });
    services.intelligenceService.runForLead(lead);
    services.synthesisService.runForLead(lead);
    services.intelligenceRecommendationService.runForLead(lead);

    const plan = services.nextBestActionService.planForLead(lead);

    assert.equal(plan.status, "PLANNED");
    assert.equal(plan.action_type, "GATHER_MORE_DATA");
    assert.equal(plan.policy_decision.decision, "ALLOW");
    assert.equal(plan.approval.requirement, "NOT_REQUIRED");
    assert.equal(db.all("SELECT * FROM actions WHERE lead_id = ?", [lead.id]).length, 0);
  } finally {
    db.close();
  }
});

test("opted-out lead produces blocked plan and no executable action", () => {
  const db = createDatabase(":memory:");
  const services = createServices(db);
  try {
    const organization = services.leadsRepository.createOrganization({ name: "NBA Opted Out Org" });
    const lead = services.leadsRepository.createLead({
      organization_id: organization.id,
      name: "Opted Out Lead",
      email: "opted-out@example.com",
      company: "Opted Out Co",
      source: "MANUAL"
    });
    services.leadsRepository.updateLeadStatus(lead.id, "OPTED_OUT");
    const updatedLead = services.leadsRepository.getLead(lead.id);
    services.intelligenceService.runForLead(updatedLead);
    services.synthesisService.runForLead(updatedLead);
    services.intelligenceRecommendationService.runForLead(updatedLead);

    const plan = services.nextBestActionService.planForLead(updatedLead);

    assert.equal(plan.status, "BLOCKED");
    assert.equal(plan.policy_decision.decision, "BLOCK");
    assert.equal(plan.approval.requirement, "BLOCKED");
    assert.match(plan.approval.reason, /suppressed or opted out/);
    assert.equal(db.all("SELECT * FROM actions WHERE lead_id = ?", [lead.id]).length, 0);
  } finally {
    db.close();
  }
});

test("duplicate warning creates duplicate review plan instead of outbound preparation", async (t) => {
  const client = await startClient(t);
  const organizationResponse = await client.post("/api/organizations", { name: "NBA Duplicate Org" });
  const organization = organizationResponse.organization;
  await client.post("/api/leads", {
    organization_id: organization.id,
    name: "Existing Lead",
    email: "same-nba@example.com"
  });
  const preview = await client.post("/api/imports/csv/preview", {
    organization_id: organization.id,
    filename: "duplicate-nba.csv",
    csv_text: "Name,Email,Company\nImported Lead,same-nba@example.com,Northstar Interiors",
    default_phone_region: "INTERNATIONAL_ONLY"
  });
  const committed = await client.post(`/api/imports/${preview.import.id}/commit`, {
    organization_id: organization.id,
    selected_row_ids: [preview.rows[0].id]
  });
  const leadId = committed.rows[0].created_lead_id;
  await runRecommendationPipeline(client, organization.id, leadId);

  const result = await client.post(`/api/leads/${leadId}/next-best-action/plan`, {
    organization_id: organization.id
  });

  assert.equal(result.next_best_action_plan.action_type, "REVIEW_DUPLICATE_CANDIDATE");
  assert.equal(result.next_best_action_plan.policy_decision.decision, "REQUIRE_HUMAN_APPROVAL");
});

test("repeated next-best-action planning is idempotent for the same recommendation", async (t) => {
  const client = await startClient(t);
  const { organization, lead } = await createReadyRecommendedLead(client, "NBA Idempotency Org");

  const first = await client.post(`/api/leads/${lead.id}/next-best-action/plan`, {
    organization_id: organization.id
  });
  const second = await client.post(`/api/leads/${lead.id}/next-best-action/plan`, {
    organization_id: organization.id
  });

  assert.equal(first.next_best_action_plan.id, second.next_best_action_plan.id);
  assert.equal(client.db.all("SELECT * FROM next_best_action_plans WHERE lead_id = ?", [lead.id]).length, 1);
});

test("failed next-best-action planning can retry safely", () => {
  const db = createDatabase(":memory:");
  const services = createServices(db);
  try {
    const organization = services.leadsRepository.createOrganization({ name: "NBA Failure Org" });
    const lead = services.leadsRepository.createLead({
      organization_id: organization.id,
      name: "Failure Lead",
      email: "failure-nba@example.com",
      company: "Failure Co",
      source: "MANUAL"
    });
    services.intelligenceService.runForLead(lead);
    services.synthesisService.runForLead(lead);
    services.intelligenceRecommendationService.runForLead(lead);

    assert.throws(
      () => services.nextBestActionService.planForLead(lead, { simulate_failure_stage: "AFTER_POLICY" }),
      /Simulated next-best-action planning failure/
    );
    assert.equal(db.get("SELECT status FROM next_best_action_plans WHERE lead_id = ?", [lead.id]).status, "FAILED");

    const retried = services.nextBestActionService.planForLead(lead);

    assert.equal(retried.status, "PLANNED");
    assert.equal(db.all("SELECT * FROM next_best_action_plans WHERE lead_id = ?", [lead.id]).length, 1);
  } finally {
    db.close();
  }
});

test("new recommendation creates a new plan version and preserves history", async (t) => {
  const client = await startClient(t);
  const { organization, lead } = await createReadyRecommendedLead(client, "NBA Version Org");
  const first = await client.post(`/api/leads/${lead.id}/next-best-action/plan`, {
    organization_id: organization.id
  });
  await client.post(`/api/leads/${lead.id}/research-evidence`, {
    organization_id: organization.id,
    provider_key: "APPROVED_MANUAL_RESEARCH",
    idempotency_key: "new-evidence-for-nba",
    evidence_items: [companyEvidence()]
  });
  await client.post(`/api/leads/${lead.id}/synthesis/run`, {
    organization_id: organization.id
  });
  await client.post(`/api/leads/${lead.id}/intelligence-recommendation/run`, {
    organization_id: organization.id
  });
  const second = await client.post(`/api/leads/${lead.id}/next-best-action/plan`, {
    organization_id: organization.id
  });
  const history = await client.get(`/api/leads/${lead.id}/next-best-action/history?organization_id=${organization.id}`);

  assert.equal(first.next_best_action_plan.version, 1);
  assert.equal(second.next_best_action_plan.version, 2);
  assert.equal(history.next_best_action_plans.length, 2);
  assert.equal(history.next_best_action_plans[0].status, "PLANNED");
  assert.equal(history.next_best_action_plans[1].status, "SUPERSEDED");
});

test("next-best-action APIs are organization scoped", async (t) => {
  const client = await startClient(t);
  const firstOrg = await client.post("/api/organizations", { name: "NBA Tenant A" });
  const secondOrg = await client.post("/api/organizations", { name: "NBA Tenant B" });
  const leadResponse = await client.post("/api/leads", {
    organization_id: firstOrg.organization.id,
    name: "Tenant Lead",
    email: "tenant-nba@example.com",
    company: "Tenant Co"
  });
  await runRecommendationPipeline(client, firstOrg.organization.id, leadResponse.lead.id);

  const wrongRead = await fetch(
    `${client.baseUrl}/api/leads/${leadResponse.lead.id}/next-best-action?organization_id=${secondOrg.organization.id}`
  );
  const wrongPlan = await fetch(`${client.baseUrl}/api/leads/${leadResponse.lead.id}/next-best-action/plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organization_id: secondOrg.organization.id })
  });

  assert.equal(wrongRead.status, 404);
  assert.equal(wrongPlan.status, 404);
  assert.equal(client.db.all("SELECT * FROM next_best_action_plans WHERE organization_id = ?", [secondOrg.organization.id]).length, 0);
});

test("next-best-action plan state survives application restart", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-lead-m3-"));
  const databaseFile = path.join(tempDir, "app.db");
  let firstClient;
  let secondClient;

  try {
    firstClient = await startClient(t, databaseFile, { autoCleanup: false });
    const { organization, lead } = await createReadyRecommendedLead(firstClient, "NBA Restart Org");
    const planned = await firstClient.post(`/api/leads/${lead.id}/next-best-action/plan`, {
      organization_id: organization.id
    });
    await firstClient.stop();

    secondClient = await startClient(t, databaseFile, { autoCleanup: false });
    const persisted = await secondClient.get(`/api/leads/${lead.id}/next-best-action?organization_id=${organization.id}`);

    assert.equal(persisted.next_best_action_plan.id, planned.next_best_action_plan.id);
    assert.equal(persisted.next_best_action_plan.status, "PLANNED");
    assert.equal(persisted.next_best_action_plan.execution_contract.executable, false);
  } finally {
    await firstClient?.stop();
    await secondClient?.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createReadyRecommendedLead(client, organizationName) {
  const organizationResponse = await client.post("/api/organizations", { name: organizationName });
  const organization = organizationResponse.organization;
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.id,
    name: "Priya Sharma",
    email: "priya@example.com",
    company: "Northstar Interiors"
  });
  await runRecommendationPipeline(client, organization.id, leadResponse.lead.id);
  return { organization, lead: leadResponse.lead };
}

async function runRecommendationPipeline(client, organizationId, leadId) {
  await client.post(`/api/leads/${leadId}/intelligence/run`, {
    organization_id: organizationId
  });
  await client.post(`/api/leads/${leadId}/synthesis/run`, {
    organization_id: organizationId
  });
  await client.post(`/api/leads/${leadId}/intelligence-recommendation/run`, {
    organization_id: organizationId
  });
}

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
