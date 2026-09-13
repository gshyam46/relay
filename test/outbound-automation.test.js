import test from "node:test";
import { advanceToNextAttempt } from "./helpers/review.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServices } from "../src/api/app.js";
import { startClient } from "./helpers/testClient.js";

test("approval-required next-best-action plan creates a waiting outbound action without execution", async (t) => {
  const client = await startClient(t);
  const { organization, lead, plan } = await createReadyPlan(client, "M4 Approval Org");

  const first = await client.post(`/api/next-best-action-plans/${plan.id}/action`, {
    organization_id: organization.id
  });
  const second = await client.post(`/api/next-best-action-plans/${plan.id}/action`, {
    organization_id: organization.id
  });
  const execute = await client.rawFetch(`/api/actions/${first.action.id}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organization_id: organization.id })
  });

  assert.equal(first.action.id, second.action.id);
  assert.equal(first.action.status, "AWAITING_APPROVAL");
  assert.equal(first.action.next_best_action_plan_id, plan.id);
  assert.equal(first.action.approval_requirement, "REQUIRED");
  assert.equal(first.action.executions.length, 0);
  assert.equal(execute.status, 409);
  assert.match((await execute.json()).error, /approve the current message revision/);
  assert.equal((await client.db.all("SELECT * FROM actions WHERE lead_id = ?", [lead.id])).length, 1);
  assert.equal((await client.db.all("SELECT * FROM action_executions WHERE action_id = ?", [first.action.id])).length, 0);
});

test("non-approval next-best-action action executes through sandbox and completes from scoped callback", async (t) => {
  const client = await startClient(t);
  const { organization, lead, plan } = await createGatherMoreDataPlan(client, "M4 Gather Org");
  const prepared = await client.post(`/api/next-best-action-plans/${plan.id}/action`, {
    organization_id: organization.id
  });
  const started = await client.post(`/api/actions/${prepared.action.id}/execute`, {
    organization_id: organization.id
  });
  const repeatedStart = await client.post(`/api/actions/${prepared.action.id}/execute`, {
    organization_id: organization.id
  });
  const callback = await client.post(`/api/actions/${prepared.action.id}/callback`, {
    organization_id: organization.id,
    provider_event_id: "m4-provider-event-1",
    status: "COMPLETED",
    action_execution_id: started.action.executions[0].id,
    provider_reference: started.action.executions[0].provider_reference
  });
  const duplicateCallback = await client.post(`/api/actions/${prepared.action.id}/callback`, {
    organization_id: organization.id,
    provider_event_id: "m4-provider-event-1",
    status: "COMPLETED",
    action_execution_id: started.action.executions[0].id,
    provider_reference: started.action.executions[0].provider_reference
  });
  const outbound = await client.get(`/api/leads/${lead.id}/outbound?organization_id=${organization.id}`);

  assert.equal(prepared.action.status, "PLANNED");
  assert.equal(prepared.action.type, "CREATE_HUMAN_TASK");
  assert.equal(started.execution_result.status, "EXECUTING");
  assert.equal(repeatedStart.execution_result.status, "EXECUTING");
  assert.equal(callback.action.status, "COMPLETED");
  assert.equal(duplicateCallback.duplicate, true);
  assert.equal(outbound.actions[0].status, "COMPLETED");
  assert.equal(outbound.actions[0].executions.length, 1);
  assert.equal(outbound.actions[0].executions[0].status, "COMPLETED");
  assert.equal(outbound.actions[0].callbacks.length, 1);
  assert.equal((await client.db.all("SELECT * FROM callbacks WHERE action_id = ?", [prepared.action.id])).length, 1);
});

test("execution retry and non-retryable failure are persisted through the M4 execution API", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("M4 Retry Org");
  const lead = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Retry Lead",
    email: "retry-m4@example.com",
    phone: "+919876543210"
  });
  const retryAction = await client.post(`/api/leads/${lead.lead.id}/actions`, {
    organization_id: organization.organization.id,
    type: "SEND_EMAIL",
    mock_behavior: "TRANSIENT_FAIL_ONCE"
  });
  const blockedAction = await client.post(`/api/leads/${lead.lead.id}/actions`, {
    organization_id: organization.organization.id,
    type: "SEND_WHATSAPP",
    mock_behavior: "PERMANENT_FAILURE"
  });

  await client.approve(retryAction.action.id);
  await client.approve(blockedAction.action.id);

  const firstRetry = await client.post(`/api/actions/${retryAction.action.id}/execute`, {
    organization_id: organization.organization.id
  });
  await advanceToNextAttempt(client.services, retryAction.action.id);
  const secondRetry = await client.post(`/api/actions/${retryAction.action.id}/execute`, {
    organization_id: organization.organization.id
  });
  const blocked = await client.post(`/api/actions/${blockedAction.action.id}/execute`, {
    organization_id: organization.organization.id
  });

  assert.equal(firstRetry.execution_result.status, "RETRYING");
  assert.equal(firstRetry.action.status, "RETRYING");
  assert.equal(secondRetry.execution_result.status, "EXECUTING");
  assert.equal(secondRetry.action.executions.length, 2);
  assert.equal(blocked.execution_result.status, "BLOCKED");
  assert.equal(blocked.action.status, "BLOCKED");
  assert.equal(blocked.action.executions[0].status, "FAILED");
});

test("M4 outbound APIs are organization scoped", async (t) => {
  const client = await startClient(t);
  const first = await createReadyPlan(client, "M4 Tenant A");
  const prepared = await client.post(`/api/next-best-action-plans/${first.plan.id}/action`, {
    organization_id: first.organization.id
  });

  await client.register("M4 Tenant B"); // switches the active session to org B

  const wrongPrepare = await client.rawFetch(`/api/next-best-action-plans/${first.plan.id}/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  const wrongExecute = await client.rawFetch(`/api/actions/${prepared.action.id}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  const wrongOutbound = await client.rawFetch(`/api/leads/${first.lead.id}/outbound`);

  assert.equal(wrongPrepare.status, 404);
  assert.equal(wrongExecute.status, 404);
  assert.equal(wrongOutbound.status, 404);
});

test("outbound action, execution, and callback state survive restart", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-lead-m4-"));
  const databaseFile = path.join(tempDir, "app.db");
  let firstClient;
  let secondClient;

  try {
    firstClient = await startClient(t, databaseFile, { autoCleanup: false });
    const { organization, lead, plan, user } = await createGatherMoreDataPlan(firstClient, "M4 Restart Org");
    const prepared = await firstClient.post(`/api/next-best-action-plans/${plan.id}/action`, {
      organization_id: organization.id
    });
    await firstClient.post(`/api/actions/${prepared.action.id}/execute`, {
      organization_id: organization.id
    });
    await firstClient.post(`/api/actions/${prepared.action.id}/callback`, {
      organization_id: organization.id,
      provider_event_id: "m4-restart-event",
      status: "COMPLETED"
    });
    await firstClient.stop();

    secondClient = await startClient(t, databaseFile, { autoCleanup: false });
    await secondClient.login(user.email);
    const outbound = await secondClient.get(`/api/leads/${lead.id}/outbound?organization_id=${organization.id}`);

    assert.equal(outbound.actions.length, 1);
    assert.equal(outbound.actions[0].status, "COMPLETED");
    assert.equal(outbound.actions[0].executions[0].status, "COMPLETED");
    assert.equal(outbound.actions[0].callbacks.length, 1);
  } finally {
    await firstClient?.stop();
    await secondClient?.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createReadyPlan(client, organizationName) {
  const registered = await client.register(organizationName);
  const organization = registered.organization;
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.id,
    name: "M4 Ready Lead",
    email: `${organizationName.toLowerCase().replaceAll(" ", "-")}@example.com`,
    company: "M4 Ready Co"
  });
  await runRecommendationPipeline(client, organization.id, leadResponse.lead.id);
  const planned = await client.post(`/api/leads/${leadResponse.lead.id}/next-best-action/plan`, {
    organization_id: organization.id
  });
  return { organization, user: registered.user, lead: leadResponse.lead, plan: planned.next_best_action_plan };
}

// Direct repository/service calls bypass HTTP (and therefore the auth gate) entirely — that's
// fine, since it's simulating fast internal test-fixture setup, not a real request. The
// organization itself still has to come from a real await client.register() call, though, or the
// HTTP calls a test makes afterward (as this org's "user") would have no session to authenticate with.
async function createGatherMoreDataPlan(client, organizationName) {
  const registered = await client.register(organizationName);
  const organization = registered.organization;
  const services = createServices(client.db);
  const lead = await services.leadsRepository.createLead({
    organization_id: organization.id,
    name: "Needs Data Lead",
    company: "Needs Data Co",
    source: "MANUAL"
  });
  await services.intelligenceService.runForLead(lead);
  await services.synthesisService.runForLead(lead);
  await services.intelligenceRecommendationService.runForLead(lead);
  const plan = await services.nextBestActionService.planForLead(lead);
  return { organization, user: registered.user, lead, plan };
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
