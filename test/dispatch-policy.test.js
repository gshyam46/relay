import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";
import { approveStoredAction } from "./helpers/review.js";
import { loadConfig } from "../src/config.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
async function fixture(t) {
  const client = await startClient(t);
  const { organization } = await client.register("Dispatch policy");
  const lead = await client.services.leadsRepository.createLead({
    organization_id: organization.id, name: "Synthetic recipient", email: "recipient@example.test", phone: "+919876543210"
  });
  const action = await client.services.actionsRepository.createAction({
    organization_id: organization.id, lead_id: lead.id, type: "SEND_EMAIL",
    idempotency_key: organization.id + ":first", payload: { subject: "Reviewed", message: "Exact approved message." }
  });
  return { client, organization, lead, action };
}
const accepted = { ok: true, provider: "email-sandbox", provider_reference: "test-reference" };

test("every send requires a current review even when legacy flags say NOT_REQUIRED", async (t) => {
  const { client, action } = await fixture(t);
  let calls = 0;
  client.services.actionExecutor.adapter = { async invoke() { calls++; return accepted; } };
  const held = await client.services.actionExecutor.execute({ ...action, status: "APPROVED", payload_json: "{}" });
  assert.equal(held.status, "AWAITING_APPROVAL");
  assert.equal(calls, 0);
  assert.equal((await client.services.executionsRepository.listForAction(action.id)).length, 0);
  await approveStoredAction(client.services, action);
  const dispatched = await client.services.actionExecutor.execute(action);
  assert.equal(dispatched.status, "EXECUTING");
  assert.equal(calls, 1);
});

test("opt-out after approval blocks dispatch and ordinary late replies cannot restore permission", async (t) => {
  const { client, lead, action, organization } = await fixture(t);
  await approveStoredAction(client.services, action);
  await client.services.contactPolicyService.restrictLead({
    organization_id: organization.id, lead_id: lead.id, reason: "OPT_OUT", source: "MANUAL", source_event_id: "stop-first"
  });
  await client.services.leadsRepository.updateLeadStatus(lead.id, "ACTIVE");
  let calls = 0;
  client.services.actionExecutor.adapter = { async invoke() { calls++; return accepted; } };
  const held = await client.services.actionExecutor.execute(action);
  assert.equal(held.status, "BLOCKED");
  assert.equal(calls, 0);
  assert.equal((await client.services.leadsRepository.getLead(lead.id)).status, "OPTED_OUT");
});

test("concurrent callers claim once and an in-flight opt-out completes without holding the provider transaction", async (t) => {
  const { client, lead, action, organization } = await fixture(t);
  await approveStoredAction(client.services, action);
  const entered = deferred();
  const finish = deferred();
  let calls = 0;
  client.services.actionExecutor.adapter = { async invoke(current, payload, attempt, { approvedDispatch }) {
    calls++;
    assert.equal(approvedDispatch.envelope.recipient, lead.email);
    assert.equal((await client.services.executionsRepository.listForAction(action.id)).length, 1);
    assert.equal((await client.services.actionsRepository.getAction(action.id)).status, "EXECUTING");
    entered.resolve();
    await finish.promise;
    return accepted;
  } };
  const first = client.services.actionExecutor.execute(action);
  await entered.promise;
  const second = await client.services.actionExecutor.execute(action);
  assert.equal(second.executable, false);
  assert.equal(second.status, "EXECUTING");
  await client.services.contactPolicyService.restrictLead({
    organization_id: organization.id, lead_id: lead.id, reason: "OPT_OUT", source: "MANUAL", source_event_id: "during-request"
  });
  finish.resolve();
  await first;
  assert.equal(calls, 1);
  assert.equal((await client.services.actionsRepository.getAction(action.id)).status, "EXECUTING");
  assert.equal((await client.services.leadsRepository.getLead(lead.id)).status, "OPTED_OUT");
});

test("suppression committed before queued authorization wins the workspace serialization point", async (t) => {
  const { client, lead, action, organization } = await fixture(t);
  await approveStoredAction(client.services, action);
  const entered = deferred();
  const finish = deferred();
  let calls = 0;
  client.services.actionExecutor.adapter = { async invoke() { calls++; return accepted; } };
  const restriction = client.services.contactPolicyService.withWorkspacePolicyTransaction(organization.id, async (tx) => {
    entered.resolve();
    await finish.promise;
    return client.services.contactPolicyService.restrictLeadInTransaction(tx, {
      organization_id: organization.id, lead_id: lead.id, reason: "OPT_OUT", source: "MANUAL", source_event_id: "serialized-first"
    });
  });
  await entered.promise;
  const dispatch = client.services.actionExecutor.execute(action);
  finish.resolve();
  await restriction;
  assert.equal((await dispatch).status, "BLOCKED");
  assert.equal(calls, 0);
});

test("provider uncertainty keeps durable ownership and does not invoke a blind retry", async (t) => {
  const { client, action } = await fixture(t);
  await approveStoredAction(client.services, action);
  let calls = 0;
  client.services.actionExecutor.adapter = { async invoke() { calls++; throw new Error("Connection lost after unknown acceptance"); } };
  const first = await client.services.actionExecutor.execute(action);
  assert.equal(first.uncertain, true);
  assert.equal(first.status, "EXECUTING");
  assert.equal(first.execution.status, "STARTED");
  assert.equal((await client.services.actionExecutor.execute(action)).executable, false);
  assert.equal(calls, 1);
});

test("a provider callback arriving before acceptance persistence is not overwritten", async (t) => {
  const { client, action } = await fixture(t);
  await approveStoredAction(client.services, action);
  client.services.actionExecutor.adapter = { async invoke(_action, _payload, _attempt, { execution_id, approvedDispatch }) {
    await client.services.callbacksService.receiveExecutionCallback({
      organization_id: action.organization_id, action_id: action.id,
      action_execution_id: execution_id, revision_id: approvedDispatch.revision_id,
      provider_event_id: "early-delivery", status: "COMPLETED"
    });
    return accepted;
  } };
  const result = await client.services.actionExecutor.execute(action);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.execution.status, "COMPLETED");
  const message = await client.services.channelMessagesRepository.latestOutboundForAction(action.id, action.organization_id);
  assert.equal(message.status, "DELIVERED");
  assert.equal((await client.services.actionsRepository.getAction(action.id)).status, "COMPLETED");
});

test("unsupported execution types fail closed and foreign action objects have no authority", async (t) => {
  const { client, action, organization, lead } = await fixture(t);
  let calls = 0;
  client.services.actionExecutor.adapter = { async invoke() { calls++; return accepted; } };
  const unsupported = await client.services.actionsRepository.createAction({
    organization_id: organization.id, lead_id: lead.id, type: "UPDATE_CRM", idempotency_key: "unsupported"
  });
  assert.equal((await client.services.actionExecutor.execute(unsupported)).status, "BLOCKED");
  const other = await client.services.leadsRepository.createOrganization({ name: "Other workspace" });
  await assert.rejects(client.services.actionExecutor.execute({ ...action, organization_id: other.id }), { statusCode: 404 });
  assert.equal(calls, 0);
});

test("normal manual placeholder sends are unavailable, while owner contact restriction is durable and tenant scoped", async (t) => {
  const client = await startClient(t, ":memory:", { config: loadConfig({ NODE_ENV: "test" }) });
  const { organization } = await client.register("Normal owner");
  const { lead } = await client.post("/api/leads", { name: "Synthetic", email: "normal@example.test" });
  const manual = await client.rawFetch("/api/leads/" + lead.id + "/actions", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "SEND_EMAIL" })
  });
  assert.equal(manual.status, 409);
  await client.post("/api/leads/" + lead.id + "/contact-restrictions", { reason: "OPT_OUT", idempotency_key: "owner-stop" });
  assert.equal((await client.get("/api/leads/" + lead.id + "/contact-policy?channel=EMAIL")).restricted, true);
  await client.register("Foreign owner");
  const foreign = await client.rawFetch("/api/leads/" + lead.id + "/contact-restrictions", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ organization_id: organization.id, reason: "SUPPRESSED", idempotency_key: "foreign-stop" })
  });
  assert.equal(foreign.status, 404);
});
