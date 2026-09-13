import test from "node:test";
import assert from "node:assert/strict";
import { callbackFixture } from "./helpers/callbackFixture.js";
import { WebhookInboxService } from "../src/modules/webhook-inbox/webhookInboxService.js";
import { CallbacksService } from "../src/modules/outbound-automation/callbacksService.js";
import { WorkflowsRepository } from "../src/modules/workflows/workflowsRepository.js";

function inputFor(f, action, execution, overrides = {}) {
  return { organization_id: action.organization_id, action_id: action.id,
    action_execution_id: execution.id, revision_id: execution.action_revision_id,
    provider: execution.provider, provider_event_id: "replay-" + execution.id, status: "COMPLETED", ...overrides };
}
async function pauseEffects(f, input) {
  await f.db.exec("CREATE TRIGGER fail_callback_followup BEFORE INSERT ON follow_up_tasks BEGIN SELECT RAISE(ABORT, 'synthetic private storage failure'); END");
  await assert.rejects(f.callbacksService.receiveExecutionCallback(input), { statusCode: 503, code: "EVENT_PROCESSING_FAILED" });
  await f.db.exec("DROP TRIGGER fail_callback_followup");
  assert.equal((await f.db.get("SELECT * FROM callbacks")).effects_status, "PENDING");
}
async function count(f, table, where = "", params = []) {
  return Number((await f.db.get("SELECT COUNT(*) AS count FROM " + table + (where ? " WHERE " + where : ""), params)).count);
}
async function replay(f) {
  f.advance(5000);
  return f.webhookInbox.processDue({ organization_id: f.organization.id });
}

test("message, follow-up and effects cursor roll back together while delivery remains durable", async (t) => {
  const f = await callbackFixture(t);
  const action = await f.createAction(), execution = await f.createAttempt(action);
  await pauseEffects(f, inputFor(f, action, execution));
  assert.equal((await f.executionsRepository.getExecution(execution.id)).outcome_class, "DELIVERED");
  assert.equal((await f.actionsRepository.getAction(action.id)).status, "COMPLETED");
  assert.equal(await count(f, "channel_messages"), 0);
  assert.equal(await count(f, "follow_up_tasks"), 0);
  assert.equal(await count(f, "domain_events", "type = 'ActionCompleted'"), 1);
  const receipt = await f.db.get("SELECT * FROM webhook_receipts");
  assert.equal(receipt.processing_state, "RETRY_PENDING");
  assert.equal(receipt.mandatory_policy_status, "DONE");
  assert.doesNotMatch(JSON.stringify(receipt), /synthetic private storage failure/);
  await replay(f);
  assert.equal((await f.db.get("SELECT * FROM callbacks")).effects_status, "DONE");
  assert.equal((await f.db.get("SELECT * FROM webhook_receipts")).processing_state, "PROCESSED");
  assert.equal(await count(f, "channel_messages"), 1);
  assert.equal(await count(f, "follow_up_tasks"), 1);
  assert.equal(await count(f, "action_executions"), 1);
});

test("restarted processor uses original reviewed copy and original completion plus 48 hours", async (t) => {
  const f = await callbackFixture(t);
  const action = await f.createAction(), execution = await f.createAttempt(action);
  const revision = await f.db.get("SELECT * FROM action_revisions WHERE id = ?", [execution.action_revision_id]);
  const envelope = JSON.parse(revision.envelope_json);
  const input = inputFor(f, action, execution);
  await pauseEffects(f, input);
  const completed = await f.executionsRepository.getExecution(execution.id);
  await f.actionsRepository.mergePayload(action.id, { subject: "Changed subject", body: "Changed body" });
  await f.db.run("UPDATE leads SET email = 'changed@example.com' WHERE id = ?", [f.lead.id]);
  f.webhookInbox.stopAccepting();
  await f.webhookInbox.drain();
  const callbacks = new CallbacksService({ ...f, now: f.now });
  const restarted = new WebhookInboxService({ db: f.db, contactPolicyService: f.contactPolicyService,
    now: f.now, random: () => 1, handlers: { EXECUTION_CALLBACK: (value, context) => callbacks.applyExecutionCallback(value, context) } });
  callbacks.webhookInbox = restarted;
  f.advance(3 * 60 * 60 * 1000);
  await restarted.processDue();
  const message = await f.db.get("SELECT * FROM channel_messages");
  const followup = await f.db.get("SELECT * FROM follow_up_tasks");
  assert.equal(message.body, envelope.body);
  assert.equal(message.subject, envelope.subject);
  assert.equal(JSON.parse(message.payload_json).recipient, envelope.recipient);
  assert.equal(followup.due_at, new Date(Date.parse(completed.completed_at) + 48 * 3600000).toISOString());
  assert.notEqual(followup.due_at, new Date(f.now() + 48 * 3600000).toISOString());
  assert.equal((await callbacks.receiveExecutionCallback(input)).duplicate, true);
  assert.equal(await count(f, "domain_events", "type = 'ActionCompleted'"), 1);
  assert.equal(await count(f, "channel_messages"), 1);
  assert.equal(await count(f, "follow_up_tasks"), 1);
});

for (const eventType of ["POSITIVE_REPLY", "NEGATIVE_REPLY", "QUESTION", "UNKNOWN", "OPT_OUT"]) {
  test("a " + eventType + " between delivery and replay prevents a reconstructed no-response task", async (t) => {
    const f = await callbackFixture(t);
    const action = await f.createAction(), execution = await f.createAttempt(action);
    await pauseEffects(f, inputFor(f, action, execution));
    f.advance(1000);
    await f.inbound({ provider_event_id: "later-" + eventType, event_type: eventType,
      payload: { text: eventType === "OPT_OUT" ? "Please stop contacting me." : eventType === "QUESTION" ? "What is the price?" : "Thank you, I am interested." } });
    await replay(f);
    assert.equal(await count(f, "follow_up_tasks", "action_id = ?", [action.id]), 0);
    assert.equal(await count(f, "channel_messages", "action_id = ? AND direction = 'OUTBOUND'", [action.id]), 1);
    assert.equal((await f.db.get("SELECT * FROM callbacks")).effects_status, "DONE");
    assert.equal((await f.actionsRepository.getAction(action.id)).status, "COMPLETED");
    if (eventType === "QUESTION") assert.equal(await count(f, "follow_up_tasks", "inbound_event_id IS NOT NULL"), 1);
  });
}

test("a stopped linked workflow prevents obsolete follow-up reconstruction", async (t) => {
  const f = await callbackFixture(t);
  const action = await f.createAction();
  const workflows = new WorkflowsRepository(f.db);
  const campaign = await workflows.createCampaign({ organization_id: f.organization.id, name: "Synthetic campaign" });
  const sequence = await workflows.createSequence({ organization_id: f.organization.id, campaign_id: campaign.id,
    name: "Synthetic sequence", steps: [] });
  const run = await workflows.enrollLead({ organization_id: f.organization.id, lead_id: f.lead.id,
    campaign_id: campaign.id, sequence_id: sequence.id, idempotency_key: "replay-run" });
  await f.actionsRepository.mergePayload(action.id, { workflow_run_id: run.id });
  const execution = await f.createAttempt(action);
  await pauseEffects(f, inputFor(f, action, execution));
  await workflows.stopOpenForLead(f.organization.id, f.lead.id, "Stopped while callback effects awaited repair.");
  await replay(f);
  assert.equal(await count(f, "follow_up_tasks"), 0);
  assert.equal((await f.db.get("SELECT * FROM callbacks")).effects_status, "DONE");
  assert.equal(JSON.parse((await f.db.get("SELECT * FROM callbacks")).payload_json).effect_reason, "WORKFLOW_STOPPED");
});

test("a receipt whose effects become stale is skipped without modifying a newer execution", async (t) => {
  const f = await callbackFixture(t);
  const action = await f.createAction(), old = await f.createAttempt(action);
  await pauseEffects(f, inputFor(f, action, old));
  const newer = await f.createAttempt(action, { newRevision: true });
  await replay(f);
  assert.equal((await f.db.get("SELECT * FROM callbacks")).effects_status, "SKIPPED");
  assert.equal((await f.executionsRepository.getExecution(newer.id)).outcome_class, "ACCEPTED");
  assert.equal((await f.actionsRepository.getAction(action.id)).active_execution_id, newer.id);
  assert.equal(await count(f, "channel_messages"), 0);
  assert.equal(await count(f, "follow_up_tasks"), 0);
});

test("closed unresolved attempts preserve callback evidence and skip all conversation effects", async (t) => {
  const f = await callbackFixture(t);
  const action = await f.createAction(), execution = await f.createAttempt(action, { outcome_class: "CLOSED_UNRESOLVED" });
  await f.db.run("UPDATE actions SET status = 'BLOCKED', execution_hold_reason = 'CLOSED_WITHOUT_RETRY' WHERE id = ?", [action.id]);
  const result = await f.callbacksService.receiveExecutionCallback(inputFor(f, action, execution));
  assert.equal(result.callback.effects_status, "SKIPPED");
  assert.equal(result.callback.core_applied, 0);
  assert.equal(result.webhook_receipt.processing_state, "PROCESSED");
  assert.equal(await count(f, "channel_messages"), 0);
  assert.equal(await count(f, "follow_up_tasks"), 0);
  assert.equal((await f.actionsRepository.getAction(action.id)).status, "BLOCKED");
});

test("missing human-task snapshot is quarantined without reconstructing mutable payload", async (t) => {
  const f = await callbackFixture(t);
  const action = await f.createAction(f.lead, "CREATE_HUMAN_TASK");
  const execution = await f.executionsRepository.createExecution({
    action_id: action.id, status: "STARTED", attempt: 1, provider: "mock-task",
    idempotency_key: "human-task-missing-copy", fence_token: 1, outcome_class: "ACCEPTED",
    started_at: new Date(f.now()).toISOString()
  });
  await f.db.run("UPDATE actions SET status = 'EXECUTING', active_execution_id = ?, execution_fence = 1 WHERE id = ?", [execution.id, action.id]);
  await f.actionsRepository.mergePayload(action.id, { message: "Current mutable task must not be invented as old copy." });
  await assert.rejects(f.callbacksService.receiveExecutionCallback(inputFor(f, action, execution)),
    { statusCode: 409, code: "MISSING_IMMUTABLE_TASK_COPY" });
  const receipt = await f.db.get("SELECT * FROM webhook_receipts");
  assert.equal(receipt.processing_state, "QUARANTINED");
  assert.equal(receipt.quarantined_reason, "MISSING_IMMUTABLE_TASK_COPY");
  assert.equal(receipt.mandatory_policy_status, "DONE");
  assert.equal((await f.db.get("SELECT * FROM callbacks")).effects_status, "PENDING");
  assert.equal((await f.executionsRepository.getExecution(execution.id)).outcome_class, "DELIVERED");
  assert.equal(await count(f, "channel_messages"), 0);
  assert.equal(await count(f, "follow_up_tasks"), 0);
});

test("unlinked legacy callback is quarantined without guessing old effects or replacing history", async (t) => {
  const f = await callbackFixture(t);
  const action = await f.createAction(), execution = await f.createAttempt(action);
  const input = inputFor(f, action, execution);
  await f.callbacksRepository.record({ organization_id: f.organization.id, lead_id: f.lead.id, action_id: action.id,
    action_execution_id: execution.id, provider_event_id: input.provider_event_id, status: input.status,
    payload: { historical: "Unknown effects" } });
  const before = await f.db.get("SELECT * FROM callbacks");
  await assert.rejects(f.callbacksService.receiveExecutionCallback(input), { statusCode: 409, code: "LEGACY_REVIEW_REQUIRED" });
  assert.deepEqual(await f.db.get("SELECT * FROM callbacks"), before);
  assert.equal((await f.db.get("SELECT * FROM webhook_receipts")).quarantined_reason, "LEGACY_REVIEW_REQUIRED");
  assert.equal((await f.executionsRepository.getExecution(execution.id)).outcome_class, "ACCEPTED");
  assert.equal(await count(f, "channel_messages"), 0);
});

test("same raw provider event ID in separate workspaces gets separate linked callback projections", async (t) => {
  const f = await callbackFixture(t);
  const localAction = await f.createAction(), localExecution = await f.createAttempt(localAction);
  const otherLead = await f.createLead("foreign@example.com", f.otherOrganization.id);
  const foreignAction = await f.createAction(otherLead), foreignExecution = await f.createAttempt(foreignAction);
  const results = await Promise.all([
    f.callbacksService.receiveExecutionCallback(inputFor(f, localAction, localExecution, { provider_event_id: "same-provider-id" })),
    f.callbacksService.receiveExecutionCallback(inputFor(f, foreignAction, foreignExecution, { provider_event_id: "same-provider-id" }))
  ]);
  assert.equal(results.filter((result) => result.applied).length, 2);
  assert.notEqual(results[0].callback.storage_provider_event_id, results[1].callback.storage_provider_event_id);
  assert.equal(results[0].callback.provider_event_id, "same-provider-id");
  assert.equal(results[1].callback.provider_event_id, "same-provider-id");
  for (const result of results) assert.equal(result.callback.storage_provider_event_id, "receipt:" + result.webhook_receipt.id);
  assert.equal(await count(f, "callbacks"), 2);
  assert.equal(await count(f, "follow_up_tasks"), 2);
});

test("forged or expired receipt context cannot commit callback effects", async (t) => {
  const f = await callbackFixture(t);
  const action = await f.createAction(), execution = await f.createAttempt(action);
  const input = inputFor(f, action, execution);
  await assert.rejects(f.callbacksService.applyExecutionCallback(input, { receipt: { id: "forged", organization_id: f.organization.id } }),
    { statusCode: 503, code: "INBOX_CLAIM_LOST" });
  assert.equal(await count(f, "callbacks"), 0);
  const original = f.channelWorkflowService.recordExecutionCallbackInTransaction.bind(f.channelWorkflowService);
  let expire = true;
  f.channelWorkflowService.recordExecutionCallbackInTransaction = async (tx, value) => {
    const result = await original(tx, value);
    if (expire) { expire = false; f.advance(60001); }
    return result;
  };
  await assert.rejects(f.callbacksService.receiveExecutionCallback(input), { statusCode: 503, code: "INBOX_CLAIM_LOST" });
  assert.equal((await f.db.get("SELECT * FROM callbacks")).effects_status, "PENDING");
  assert.equal(await count(f, "channel_messages"), 0);
  assert.equal(await count(f, "follow_up_tasks"), 0);
  await replay(f);
  assert.equal((await f.db.get("SELECT * FROM callbacks")).effects_status, "DONE");
  assert.equal(await count(f, "follow_up_tasks"), 1);
});

test("concurrent replay repairs one conversation, follow-up and cursor without repeating completion audit", async (t) => {
  const f = await callbackFixture(t);
  const action = await f.createAction(), execution = await f.createAttempt(action);
  const input = inputFor(f, action, execution);
  await pauseEffects(f, input);
  f.advance(5000);
  await Promise.all([f.callbacksService.receiveExecutionCallback(input), f.webhookInbox.processDue()]);
  assert.equal(await count(f, "callbacks"), 1);
  assert.equal(await count(f, "channel_messages"), 1);
  assert.equal(await count(f, "follow_up_tasks"), 1);
  assert.equal(await count(f, "domain_events", "type = 'ActionCompleted'"), 1);
  assert.equal(await count(f, "audit_logs", "event_type = 'ActionCompleted'"), 1);
  const before = await f.db.get("SELECT * FROM callbacks");
  f.advance(10000);
  await f.callbacksService.receiveExecutionCallback(input);
  assert.deepEqual(await f.db.get("SELECT * FROM callbacks"), before);
});

test("a previously cancelled no-response task is never reopened by repaired callback effects", async (t) => {
  const f = await callbackFixture(t);
  const action = await f.createAction(), execution = await f.createAttempt(action);
  await pauseEffects(f, inputFor(f, action, execution));
  const prior = await f.followUpsRepository.create({ organization_id: f.organization.id, lead_id: f.lead.id,
    action_id: action.id, channel: "EMAIL", status: "CANCELLED", due_at: "2020-01-01T00:00:00.000Z",
    reason: "Explicitly cancelled.", idempotency_key: "action:" + action.id + ":no-response-follow-up:v1" });
  await replay(f);
  assert.deepEqual({ ...await f.followUpsRepository.getForOrganization(prior.id, f.organization.id) }, prior);
  assert.equal(await count(f, "follow_up_tasks"), 1);
});

test("restriction on the originally contacted address survives later lead-address edits during replay", async (t) => {
  const f = await callbackFixture(t);
  const action = await f.createAction(), execution = await f.createAttempt(action);
  await pauseEffects(f, inputFor(f, action, execution));
  await f.db.run("UPDATE leads SET email = 'new-safe@example.com', normalized_email = 'new-safe@example.com' WHERE id = ?", [f.lead.id]);
  await f.contactPolicyService.restrictContact({ organization_id: f.organization.id,
    contact: { kind: "EMAIL", value: f.lead.email }, channel: "EMAIL", reason: "UNSUBSCRIBE",
    source: "PROVIDER_EVENT", source_event_id: "original-address-optout" });
  assert.equal((await f.inspect()).restricted, false);
  await replay(f);
  assert.equal(await count(f, "follow_up_tasks"), 0);
  const message = await f.db.get("SELECT * FROM channel_messages");
  assert.equal(JSON.parse(message.payload_json).recipient, f.lead.email);
  assert.equal(JSON.parse((await f.db.get("SELECT * FROM callbacks")).payload_json).effect_reason, "CONTACT_RESTRICTED");
});

test("unprocessed mandatory contact policy defers callback effects and resolved reply completes repair", async (t) => {
  const f = await callbackFixture(t);
  const action = await f.createAction(), execution = await f.createAttempt(action);
  const incoming = { organization_id: f.organization.id, lead_id: f.lead.id, contact: null,
    channel: "EMAIL", provider: "fixture-provider", provider_event_id: "pending-question",
    event_type: "QUESTION", payload: { text: "What is the price?" } };
  const pending = await f.webhookInbox.receive({ organization_id: f.organization.id, provider: incoming.provider,
    connection_key: "internal", event_kind: "INBOUND_MESSAGE", provider_event_id: incoming.provider_event_id,
    verification_kind: "TRUSTED_INTERNAL", input: incoming });
  await assert.rejects(f.callbacksService.receiveExecutionCallback(inputFor(f, action, execution)),
    { statusCode: 503, code: "POLICY_EFFECT_PENDING" });
  assert.equal((await f.db.get("SELECT * FROM callbacks")).effects_status, "PENDING");
  assert.equal((await f.executionsRepository.getExecution(execution.id)).outcome_class, "DELIVERED");
  assert.equal(await count(f, "channel_messages"), 0);
  assert.equal(await count(f, "follow_up_tasks"), 0);
  const resolved = await f.webhookInbox.processReceipt({ organization_id: f.organization.id, receipt_id: pending.row.id });
  assert.equal(resolved.receipt.mandatory_policy_status, "DONE");
  await replay(f);
  assert.equal((await f.db.get("SELECT * FROM callbacks")).effects_status, "DONE");
  assert.equal(await count(f, "channel_messages", "action_id = ? AND direction = 'OUTBOUND'", [action.id]), 1);
  assert.equal(await count(f, "follow_up_tasks", "action_id = ?", [action.id]), 0);
  assert.equal(await count(f, "follow_up_tasks", "inbound_event_id IS NOT NULL"), 1);
});
