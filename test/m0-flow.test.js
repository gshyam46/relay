import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/api/app.js";
import { createDatabase } from "../src/database/database.js";

test("M0 flow creates a lead, generates intelligence, executes an action, and completes from callback", async (t) => {
  const client = await startClient(t);
  const organization = await client.post("/api/organizations", { name: "Demo Org" });
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
  assert.equal(client.db.all("SELECT * FROM intelligence_snapshots WHERE lead_id = ?", [leadResponse.lead.id]).length, 1);
  assert.equal(client.db.all("SELECT * FROM actions WHERE lead_id = ?", [leadResponse.lead.id]).length, 1);
  assert.equal(client.db.all("SELECT * FROM action_executions WHERE action_id = ?", [leadBeforeCallback.lead.actions[0].id]).length, 1);

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
  assert.equal(client.db.get("SELECT status FROM leads WHERE id = ?", [leadResponse.lead.id]).status, "ACTIVE");
  assert.equal(client.db.get("SELECT status FROM actions WHERE id = ?", [action.id]).status, "COMPLETED");
});

test("organization creation rejects duplicate names clearly", async (t) => {
  const client = await startClient(t);
  await client.post("/api/organizations", { name: "Demo Org" });

  const duplicate = await fetch(`${client.baseUrl}/api/organizations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: " demo org " })
  });

  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error, "An organization with this name already exists.");
  assert.equal(client.db.all("SELECT * FROM organizations").length, 1);
});

test("worker action planning is idempotent for the same LeadCreated event outcome", async (t) => {
  const client = await startClient(t);
  const organization = await client.post("/api/organizations", { name: "Idempotency Org" });
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
  assert.equal(client.db.all("SELECT * FROM actions WHERE lead_id = ?", [leadResponse.lead.id]).length, 1);
});

test("duplicate action planning creates one action for the same idempotency key", async (t) => {
  const client = await startClient(t);
  const organization = await client.post("/api/organizations", { name: "Duplicate Action Org" });
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
  assert.equal(client.db.all("SELECT * FROM actions WHERE lead_id = ?", [leadResponse.lead.id]).length, 1);
});

test("duplicate callback is accepted without duplicate side effects", async (t) => {
  const client = await startClient(t);
  const organization = await client.post("/api/organizations", { name: "Callback Org" });
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
  assert.equal(client.db.all("SELECT * FROM callbacks WHERE action_id = ?", [action.id]).length, 1);
});

test("retryable handler failure moves action to retrying and succeeds on the next worker run", async (t) => {
  const client = await startClient(t);
  const organization = await client.post("/api/organizations", { name: "Retry Org" });
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
  const organization = await client.post("/api/organizations", { name: "Blocked Org" });
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

  const action = client.db.get("SELECT status FROM actions WHERE id = ?", [manualAction.action.id]);
  assert.equal(action.status, "BLOCKED");
});

test("tenant isolation keeps lead list and detail scoped by organization", async (t) => {
  const client = await startClient(t);
  const firstOrg = await client.post("/api/organizations", { name: "First Tenant" });
  const secondOrg = await client.post("/api/organizations", { name: "Second Tenant" });
  const firstLead = await client.post("/api/leads", {
    organization_id: firstOrg.organization.id,
    name: "Tenant One Lead",
    email: "tenant-one@example.com"
  });
  await client.post("/api/leads", {
    organization_id: secondOrg.organization.id,
    name: "Tenant Two Lead",
    email: "tenant-two@example.com"
  });

  const firstList = await client.get(`/api/leads?organization_id=${firstOrg.organization.id}`);
  const secondList = await client.get(`/api/leads?organization_id=${secondOrg.organization.id}`);

  assert.deepEqual(firstList.leads.map((lead) => lead.name), ["Tenant One Lead"]);
  assert.deepEqual(secondList.leads.map((lead) => lead.name), ["Tenant Two Lead"]);

  const crossTenantResponse = await fetch(
    `${client.baseUrl}/api/leads/${firstLead.lead.id}?organization_id=${secondOrg.organization.id}`
  );
  assert.equal(crossTenantResponse.status, 404);
});

test("persisted state survives application restart", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-lead-m0-"));
  const databaseFile = path.join(tempDir, "app.db");
  let firstClient;
  let secondClient;

  try {
    firstClient = await startClient(t, databaseFile, { autoCleanup: false });
    const organization = await firstClient.post("/api/organizations", { name: "Restart Org" });
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

test("lead creation validates required and malformed fields", async (t) => {
  const client = await startClient(t);
  const response = await fetch(`${client.baseUrl}/api/leads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Missing organization" })
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, "organization_id is required.");

  const organization = await client.post("/api/organizations", { name: "Validation Org" });
  const invalidEmail = await fetch(`${client.baseUrl}/api/leads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organization_id: organization.organization.id,
      name: "Invalid Email",
      email: "bad-email"
    })
  });
  assert.equal(invalidEmail.status, 400);
  assert.match((await invalidEmail.json()).error, /valid email/);

  const invalidPhone = await fetch(`${client.baseUrl}/api/leads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organization_id: organization.organization.id,
      name: "Invalid Phone",
      phone: "abc123"
    })
  });
  assert.equal(invalidPhone.status, 400);
  assert.match((await invalidPhone.json()).error, /phone must include an explicit country code/);
});

test("action creation validates action type and mock behavior", async (t) => {
  const client = await startClient(t);
  const organization = await client.post("/api/organizations", { name: "Action Validation Org" });
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Invalid Action Lead",
    email: "action@example.com"
  });

  const invalidAction = await fetch(`${client.baseUrl}/api/leads/${leadResponse.lead.id}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organization_id: organization.organization.id,
      type: "CALL_PHONE",
      mock_behavior: "SUCCESS"
    })
  });

  assert.equal(invalidAction.status, 400);
  assert.match((await invalidAction.json()).error, /type must be one of/);
});

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
    async get(path) {
      const response = await fetch(`${baseUrl}${path}`);
      if (!response.ok) {
        assert.fail(`${response.status} ${await response.text()}`);
      }
      return response.json();
    },
    async post(path, body) {
      const response = await fetch(`${baseUrl}${path}`, {
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
