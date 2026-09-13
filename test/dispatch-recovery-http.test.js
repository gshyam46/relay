import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";

async function fixture(t, { scheduled_at = null } = {}) {
  const client = await startClient(t);
  const { organization, user } = await client.register("Recovery owner");
  const lead = await client.services.leadsRepository.createLead({
    organization_id: organization.id, name: "Synthetic recovery lead", email: "recovery@example.test", source: "MANUAL"
  });
  const action = await client.services.actionsRepository.createAction({
    organization_id: organization.id, lead_id: lead.id, type: "SEND_EMAIL", scheduled_at,
    idempotency_key: "recovery-http-action", payload: { subject: "A question", message: "May we discuss your requirements?" }
  });
  await client.approve(action.id);
  return { client, action, organization, user };
}
async function command(client, path, body) {
  const response = await client.rawFetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

test("future action is deferred by HTTP and worker without attempts, then dispatches once when due", async (t) => {
  let time = Date.parse("2026-09-11T10:00:00.000Z");
  const due = new Date(time + 60000).toISOString();
  const { client, action } = await fixture(t, { scheduled_at: due });
  client.services.actionExecutor.now = () => time;
  let sends = 0;
  client.services.actionExecutor.adapter = { async invoke() { sends++; return { ok: true, provider: "email-sandbox", provider_reference: "synthetic" }; } };
  const result = await client.post("/api/actions/" + action.id + "/execute", {});
  assert.equal(result.execution_result.deferred, true);
  assert.equal((await client.services.executionsRepository.listForAction(action.id)).length, 0);
  await client.post("/api/worker/run", {});
  assert.equal(sends, 0);
  time += 60000;
  await client.post("/api/worker/run", {});
  assert.equal(sends, 1);
  assert.equal((await client.get("/api/actions/" + action.id + "/recovery")).execution.outcome_class, "ACCEPTED");
});

test("owner recovery API binds exact attempt and actor while exposing acceptance separately from delivery", async (t) => {
  const { client, action, user } = await fixture(t);
  client.services.actionExecutor.adapter = { async invoke() { throw new Error("Unknown synthetic transport result"); } };
  await client.post("/api/actions/" + action.id + "/execute", {});
  const path = "/api/actions/" + action.id + "/recovery";
  const detail = await client.get(path);
  assert.equal(detail.execution.outcome_class, "UNCERTAIN");
  assert.equal(detail.can_resolve, true);
  const input = { expected_execution_id: detail.execution.id, expected_fence: detail.execution.fence_token,
    decision: "ACCEPTED", evidence_note: "Checked provider test record.", provider_reference: "synthetic-provider-record",
    reviewer_user_id: "forged-reviewer" };
  assert.equal((await command(client, path + "/resolve", { ...input, expected_fence: input.expected_fence + 1 })).status, 409);
  assert.equal((await command(client, path + "/resolve", { ...input, evidence_note: "" })).status, 400);
  const saved = await client.post(path + "/resolve", input);
  assert.equal(saved.execution.outcome_class, "ACCEPTED");
  assert.notEqual(saved.execution.status, "COMPLETED");
  const row = await client.db.get("SELECT * FROM dispatch_resolutions WHERE action_execution_id = ?", [detail.execution.id]);
  assert.equal(row.reviewer_user_id, user.id);
  assert.equal((await client.post(path + "/resolve", input)).duplicate, true);
  assert.equal((await client.services.executionsRepository.listForAction(action.id)).length, 1);
});

test("foreign and non-owner recovery commands cannot inspect or modify another workspace", async (t) => {
  const { client, action, organization } = await fixture(t);
  client.services.actionExecutor.adapter = { async invoke() { throw new Error("synthetic uncertain"); } };
  await client.post("/api/actions/" + action.id + "/execute", {});
  const original = await client.services.actionsRepository.getAction(action.id);
  const execution = await client.services.executionsRepository.latestForAction(action.id);
  const other = await client.register("Other recovery owner");
  const path = "/api/actions/" + action.id + "/recovery";
  const read = await client.rawFetch(path);
  assert.equal(read.status, 404);
  const result = await command(client, path + "/resolve", {
    organization_id: organization.id, expected_execution_id: execution.id, expected_fence: execution.fence_token,
    decision: "CLOSE_WITHOUT_RETRY", evidence_note: "Foreign attempt"
  });
  assert.equal(result.status, 404);
  assert.deepEqual(await client.services.actionsRepository.getAction(action.id), original);
  assert.equal((await client.get("/api/outbound/recovery")).items.length, 0);
  await client.db.run("UPDATE users SET role = 'VIEWER' WHERE id = ?", [other.user.id]);
  assert.equal((await client.rawFetch("/api/outbound/recovery")).status, 403);
});

test("normal synthetic callback refuses ambiguous action-only correlation", async (t) => {
  const { client, action } = await fixture(t);
  const response = await command(client, "/api/actions/" + action.id + "/callback", { provider_event_id: "no-attempt" });
  assert.equal(response.status, 400);
  assert.equal((await client.services.executionsRepository.listForAction(action.id)).length, 0);
});

test("bulk execution counts only new dispatches and reports deferred or held actions", async (t) => {
  let time = Date.parse("2026-09-11T10:00:00.000Z");
  const { client, action } = await fixture(t, { scheduled_at: new Date(time + 60000).toISOString() });
  client.services.actionExecutor.now = () => time;
  const route = "/api/actions/bulk-execute";
  const deferred = await client.post(route, { action_ids: [action.id] });
  assert.equal(deferred.executed, 0);
  assert.equal(deferred.deferred, 1);
  assert.equal(deferred.held, 0);
  time += 60000;
  const started = await client.post(route, { action_ids: [action.id] });
  assert.equal(started.executed, 1);
  const held = await client.post(route, { action_ids: [action.id] });
  assert.equal(held.executed, 0);
  assert.equal(held.held, 1);
  assert.equal((await client.services.executionsRepository.listForAction(action.id)).length, 1);
});

test("sandbox completion requires accepted current attempt and never invents delivery for uncertain work", async (t) => {
  const { client, action } = await fixture(t);
  client.services.actionExecutor.adapter = { async invoke() {
    return { ok: false, uncertain: true, provider: "email-sandbox", error: "Synthetic uncertain outcome" };
  } };
  await client.post("/api/actions/" + action.id + "/execute", {});
  assert.deepEqual(await client.services.worker.autoCompleteMockExecutions(), []);
  const execution = await client.services.executionsRepository.latestForAction(action.id);
  assert.equal(execution.outcome_class, "UNCERTAIN");
  assert.equal((await client.services.actionsRepository.getAction(action.id)).status, "EXECUTING");
  assert.equal((await client.db.all("SELECT * FROM callbacks WHERE action_id = ?", [action.id])).length, 0);
  client.services.worker.stop();
  assert.equal((await client.services.worker.runOnce()).draining, true);
  assert.deepEqual(await client.services.worker.autoCompleteMockExecutions(), []);
});
