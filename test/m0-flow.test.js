import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startClient } from "./helpers/testClient.js";

test("M0 flow creates a lead, generates intelligence, executes an action, and completes from callback", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Demo Org");
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Asha Mehta",
    email: "asha@example.com",
    source: "MANUAL"
  });

  const workerResult = await client.post("/api/worker/run", {});
  assert.equal(workerResult.processed_events.length, 1);
  assert.equal(workerResult.executed_actions.length, 1);
  assert.equal(workerResult.executed_actions[0].status, "EXECUTING");

  const leadBeforeCallback = await client.get(
    `/api/leads/${leadResponse.lead.id}?organization_id=${organization.organization.id}`
  );
  assert.equal(leadBeforeCallback.lead.status, "NORMALIZED");
  assert.equal(leadBeforeCallback.lead.intelligence.next_best_action, "CREATE_HUMAN_TASK");
  assert.equal(leadBeforeCallback.lead.intelligence.recommendation.action_type, "READY_FOR_RESEARCH");
  assert.equal(leadBeforeCallback.lead.actions.length, 1);
  assert.equal((await client.db.all("SELECT * FROM intelligence_snapshots WHERE lead_id = ?", [leadResponse.lead.id])).length, 1);
  assert.equal((await client.db.all("SELECT * FROM actions WHERE lead_id = ?", [leadResponse.lead.id])).length, 1);
  assert.equal((await client.db.all("SELECT * FROM action_executions WHERE action_id = ?", [leadBeforeCallback.lead.actions[0].id])).length, 1);

  const action = leadBeforeCallback.lead.actions[0];
  const callback = await client.post("/api/callbacks/mock", {
    action_id: action.id,
    provider_event_id: "provider-event-1",
    status: "COMPLETED",
    provider_reference: "provider-ref-1"
  });
  assert.equal(callback.duplicate, false);
  assert.equal(callback.action.status, "COMPLETED");

  const leadAfterCallback = await client.get(
    `/api/leads/${leadResponse.lead.id}?organization_id=${organization.organization.id}`
  );
  assert.equal(leadAfterCallback.lead.status, "ACTIVE");
  assert.equal(leadAfterCallback.lead.actions[0].executions[0].status, "COMPLETED");
  assert.equal((await client.db.get("SELECT status FROM leads WHERE id = ?", [leadResponse.lead.id])).status, "ACTIVE");
  assert.equal((await client.db.get("SELECT status FROM actions WHERE id = ?", [action.id])).status, "COMPLETED");
});

// Organizations are no longer created through a standalone endpoint — POST /api/organizations
// was removed once workspace creation moved entirely into POST /api/auth/register (one
// workspace per account). Under that model, two different accounts naming their workspace the
// same thing is expected and fine — they're isolated tenants, not competing for one global name.
test("two accounts can register workspaces with the same name without colliding", async (t) => {
  const client = await startClient(t);
  const first = await client.register("Demo Org");
  const second = await client.register("Demo Org");

  assert.notEqual(first.organization.id, second.organization.id);
  assert.equal((await client.db.all("SELECT * FROM organizations WHERE name = ?", ["Demo Org"])).length, 2);
});

test("worker action planning is idempotent for the same LeadCreated event outcome", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Idempotency Org");
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Rohan Verma",
    phone: "+91 99999 11111"
  });

  await client.post("/api/worker/run", {});
  await client.post("/api/worker/run", {});

  const lead = await client.get(`/api/leads/${leadResponse.lead.id}?organization_id=${organization.organization.id}`);
  assert.equal(lead.lead.actions.length, 1);
  assert.equal(lead.lead.actions[0].executions.length, 1);
  assert.equal((await client.db.all("SELECT * FROM actions WHERE lead_id = ?", [leadResponse.lead.id])).length, 1);
});

test("duplicate action planning creates one action for the same idempotency key", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Duplicate Action Org");
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Devika Iyer",
    email: "devika@example.com"
  });

  const first = await client.post(`/api/leads/${leadResponse.lead.id}/actions`, {
    organization_id: organization.organization.id,
    type: "SEND_EMAIL",
    mock_behavior: "SUCCESS"
  });
  const second = await client.post(`/api/leads/${leadResponse.lead.id}/actions`, {
    organization_id: organization.organization.id,
    type: "SEND_EMAIL",
    mock_behavior: "SUCCESS"
  });

  assert.equal(first.action.id, second.action.id);
  assert.equal((await client.db.all("SELECT * FROM actions WHERE lead_id = ?", [leadResponse.lead.id])).length, 1);
});

test("duplicate callback is accepted without duplicate side effects", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Callback Org");
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Nisha Rao",
    email: "nisha@example.com"
  });
  await client.post("/api/worker/run", {});
  const lead = await client.get(`/api/leads/${leadResponse.lead.id}?organization_id=${organization.organization.id}`);
  const action = lead.lead.actions[0];

  await client.post("/api/callbacks/mock", {
    action_id: action.id,
    provider_event_id: "same-provider-event",
    status: "COMPLETED"
  });
  const duplicate = await client.post("/api/callbacks/mock", {
    action_id: action.id,
    provider_event_id: "same-provider-event",
    status: "COMPLETED"
  });

  assert.equal(duplicate.duplicate, true);
  const afterDuplicate = await client.get(`/api/leads/${leadResponse.lead.id}?organization_id=${organization.organization.id}`);
  assert.equal(afterDuplicate.lead.actions[0].executions.length, 1);
  assert.equal(afterDuplicate.lead.actions[0].status, "COMPLETED");
  assert.equal((await client.db.all("SELECT * FROM callbacks WHERE action_id = ?", [action.id])).length, 1);
});

test("retryable handler failure moves action to retrying and succeeds on the next worker run", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Retry Org");
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Kabir Singh",
    email: "kabir@example.com"
  });
  const manualAction = await client.post(`/api/leads/${leadResponse.lead.id}/actions`, {
    organization_id: organization.organization.id,
    type: "SEND_EMAIL",
    mock_behavior: "TRANSIENT_FAIL_ONCE"
  });

  const firstRun = await client.post("/api/worker/run", {});
  const failedExecution = firstRun.executed_actions.find((item) => item.action_id === manualAction.action.id);
  assert.equal(failedExecution.status, "RETRYING");
  assert.equal(failedExecution.retryable, true);

  const secondRun = await client.post("/api/worker/run", {});
  const retriedExecution = secondRun.executed_actions.find((item) => item.action_id === manualAction.action.id);
  assert.equal(retriedExecution.status, "EXECUTING");

  const lead = await client.get(`/api/leads/${leadResponse.lead.id}?organization_id=${organization.organization.id}`);
  const action = lead.lead.actions.find((item) => item.id === manualAction.action.id);
  assert.equal(action.executions.length, 2);
});

test("non-retryable execution failure blocks the action", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Blocked Org");
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Sameer Bose",
    email: "sameer@example.com"
  });
  const manualAction = await client.post(`/api/leads/${leadResponse.lead.id}/actions`, {
    organization_id: organization.organization.id,
    type: "SEND_EMAIL",
    mock_behavior: "PERMANENT_FAILURE"
  });

  const workerResult = await client.post("/api/worker/run", {});
  const failedExecution = workerResult.executed_actions.find((item) => item.action_id === manualAction.action.id);
  assert.equal(failedExecution.status, "BLOCKED");
  assert.equal(failedExecution.retryable, false);

  const action = await client.db.get("SELECT status FROM actions WHERE id = ?", [manualAction.action.id]);
  assert.equal(action.status, "BLOCKED");
});

test("tenant isolation keeps lead list and detail scoped by organization", async (t) => {
  const client = await startClient(t);
  const firstOrg = await client.register("First Tenant");
  const firstLead = await client.post("/api/leads", {
    organization_id: firstOrg.organization.id,
    name: "Tenant One Lead",
    email: "tenant-one@example.com"
  });
  const firstList = await client.get(`/api/leads?organization_id=${firstOrg.organization.id}`);
  assert.deepEqual(firstList.leads.map((lead) => lead.name), ["Tenant One Lead"]);

  const secondOrg = await client.register("Second Tenant"); // switches the active session to org B
  await client.post("/api/leads", {
    organization_id: secondOrg.organization.id,
    name: "Tenant Two Lead",
    email: "tenant-two@example.com"
  });
  const secondList = await client.get(`/api/leads?organization_id=${secondOrg.organization.id}`);
  assert.deepEqual(secondList.leads.map((lead) => lead.name), ["Tenant Two Lead"]);

  const crossTenantResponse = await client.rawFetch(`/api/leads/${firstLead.lead.id}`);
  assert.equal(crossTenantResponse.status, 404);
});

test("persisted state survives application restart", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-lead-m0-"));
  const databaseFile = path.join(tempDir, "app.db");
  let firstClient;
  let secondClient;

  try {
    firstClient = await startClient(t, databaseFile, { autoCleanup: false });
    const organization = await firstClient.register("Restart Org");
    const leadResponse = await firstClient.post("/api/leads", {
      organization_id: organization.organization.id,
      name: "Meera Das",
      email: "meera@example.com"
    });
    await firstClient.post("/api/worker/run", {});
    const firstLead = await firstClient.get(
      `/api/leads/${leadResponse.lead.id}?organization_id=${organization.organization.id}`
    );
    await firstClient.post("/api/callbacks/mock", {
      action_id: firstLead.lead.actions[0].id,
      provider_event_id: "restart-provider-event",
      status: "COMPLETED"
    });
    await firstClient.stop();

    secondClient = await startClient(t, databaseFile, { autoCleanup: false });
    await secondClient.login(organization.user.email);
    const restartedLead = await secondClient.get(
      `/api/leads/${leadResponse.lead.id}?organization_id=${organization.organization.id}`
    );

    assert.equal(restartedLead.lead.status, "ACTIVE");
    assert.equal(restartedLead.lead.intelligence.next_best_action, "CREATE_HUMAN_TASK");
    assert.equal(restartedLead.lead.intelligence.recommendation.action_type, "READY_FOR_RESEARCH");
    assert.equal(restartedLead.lead.actions[0].status, "COMPLETED");
  } finally {
    await firstClient?.stop();
    await secondClient?.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("lead creation requires a session and validates malformed fields", async (t) => {
  const client = await startClient(t);

  // No session cookie at all: rejected before route logic ever runs, regardless of body.
  const noSession = await fetch(`${client.baseUrl}/api/leads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Missing organization" })
  });
  assert.equal(noSession.status, 401);

  const organization = await client.register("Validation Org");
  const invalidEmail = await client.rawFetch("/api/leads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Invalid Email",
      email: "bad-email"
    })
  });
  assert.equal(invalidEmail.status, 400);
  assert.match((await invalidEmail.json()).error, /valid email/);

  const invalidPhone = await client.rawFetch("/api/leads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Invalid Phone",
      phone: "abc123"
    })
  });
  assert.equal(invalidPhone.status, 400);
  assert.match((await invalidPhone.json()).error, /phone must include an explicit country code/);
  assert.ok(organization.organization.id); // keeps the registered org referenced/used above
});

test("action creation validates action type and mock behavior", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Action Validation Org");
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Invalid Action Lead",
    email: "action@example.com"
  });

  const invalidAction = await client.rawFetch(`/api/leads/${leadResponse.lead.id}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "CALL_PHONE",
      mock_behavior: "SUCCESS"
    })
  });

  assert.equal(invalidAction.status, 400);
  assert.match((await invalidAction.json()).error, /type must be one of/);
});
