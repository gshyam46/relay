import test from "node:test";
import assert from "node:assert/strict";
import { callbackFixture as fixture } from "./helpers/callbackFixture.js";
import { applySendgridEvent, normalizeSendgridEvent } from "../src/modules/channels/sendgridEvents.js";


async function recordMessage(f, action, execution) {
  const revision = await f.db.get("SELECT * FROM action_revisions WHERE id = ?", [execution.action_revision_id]);
  return f.channelWorkflowService.recordOutboundExecutionAttempt({
    action, execution, attempt: execution.attempt, payload: {}, result: { ok: true, provider: execution.provider },
    approvedDispatch: { revision_id: revision.id, envelope_hash: revision.content_hash,
      envelope: JSON.parse(revision.envelope_json), provider_config: {} }
  });
}
function callbackFor(f, action, execution, patch = {}) {
  return { organization_id: f.organization.id, action_id: action.id, action_execution_id: execution.id,
    revision_id: execution.action_revision_id, provider: "sendgrid",
    provider_event_id: "event-" + execution.id, status: "COMPLETED", ...patch };
}

test("callback service requires explicit same-workspace attempt, revision and provider identity", async (t) => {
  const f = await fixture(t);
  const action = await f.createAction();
  const execution = await f.createAttempt(action);
  const input = callbackFor(f, action, execution);
  await assert.rejects(f.callbacksService.receiveExecutionCallback({ ...input, provider_event_id: "missing-execution", action_execution_id: undefined }), { statusCode: 400 });
  await assert.rejects(f.callbacksService.receiveExecutionCallback({ ...input, provider_event_id: "wrong-revision", revision_id: "wrong-revision" }), { statusCode: 409 });
  await assert.rejects(f.callbacksService.receiveExecutionCallback({ ...input, provider_event_id: "wrong-provider", provider: "resend" }), { statusCode: 409 });
  const foreignLead = await f.createLead("foreign@example.com", f.otherOrganization.id);
  const foreignAction = await f.createAction(foreignLead);
  const foreignExecution = await f.createAttempt(foreignAction);
  await assert.rejects(f.callbacksService.receiveExecutionCallback({ ...input, provider_event_id: "foreign-execution", action_execution_id: foreignExecution.id }), { statusCode: 404 });
  assert.equal((await f.db.get("SELECT COUNT(*) AS count FROM callbacks")).count, 0);
  assert.equal((await f.actionsRepository.getAction(action.id)).status, "EXECUTING");
});

test("expired uncertain attempt is resolved by its exact callback without a new provider invocation", async (t) => {
  const f = await fixture(t);
  const action = await f.createAction();
  const execution = await f.createAttempt(action, { outcome_class: "UNCERTAIN" });
  await f.db.run("UPDATE actions SET execution_hold_reason = 'PROVIDER_OUTCOME_UNCERTAIN' WHERE id = ?", [action.id]);
  const result = await f.callbacksService.receiveExecutionCallback(callbackFor(f, action, execution, { provider_reference: "sg-webhook-message" }));
  assert.equal(result.applied, true);
  assert.equal(result.action.status, "COMPLETED");
  assert.equal(result.action.execution_hold_reason, null);
  assert.equal(result.execution.outcome_class, "DELIVERED");
  assert.equal((await f.executionsRepository.listForAction(action.id)).length, 1);
});

test("historical callback cannot mutate recovered execution, newer revision, message or follow-up", async (t) => {
  const f = await fixture(t);
  const action = await f.createAction();
  const old = await f.createAttempt(action, { outcome_class: "UNCERTAIN" });
  const oldMessage = await recordMessage(f, action, old);
  const current = await f.createAttempt(action, { newRevision: true });
  const currentMessage = await recordMessage(f, action, current);
  assert.notEqual(old.action_revision_id, current.action_revision_id);
  const result = await f.callbacksService.receiveExecutionCallback(callbackFor(f, action, old));
  assert.equal(result.applied, false);
  assert.equal(result.reason, "STALE_EXECUTION");
  assert.equal(result.callback.action_execution_id, old.id);
  assert.equal((await f.actionsRepository.getAction(action.id)).active_execution_id, current.id);
  assert.equal((await f.executionsRepository.getExecution(current.id)).outcome_class, "ACCEPTED");
  assert.equal((await f.executionsRepository.getExecution(old.id)).outcome_class, "UNCERTAIN");
  assert.equal((await f.db.get("SELECT status FROM channel_messages WHERE id = ?", [currentMessage.id])).status, "SENT");
  assert.equal((await f.db.get("SELECT status FROM channel_messages WHERE id = ?", [oldMessage.id])).status, "SENT");
  assert.equal((await f.followUpsRepository.listForLead(f.organization.id, f.lead.id)).length, 0);
  const completed = await f.callbacksService.receiveExecutionCallback(callbackFor(f, action, current));
  assert.equal(completed.applied, true);
  assert.equal((await f.db.get("SELECT status FROM channel_messages WHERE id = ?", [currentMessage.id])).status, "DELIVERED");
  assert.equal((await f.db.get("SELECT status FROM channel_messages WHERE id = ?", [oldMessage.id])).status, "SENT");
});

test("same-execution fence mismatch preserves ownership and callback evidence only", async (t) => {
  const f = await fixture(t);
  const action = await f.createAction();
  const execution = await f.createAttempt(action);
  await f.db.run("UPDATE actions SET execution_fence = execution_fence + 1 WHERE id = ?", [action.id]);
  const result = await f.callbacksService.receiveExecutionCallback(callbackFor(f, action, execution));
  assert.equal(result.applied, false);
  assert.equal(result.reason, "STALE_EXECUTION");
  assert.equal((await f.executionsRepository.getExecution(execution.id)).status, "STARTED");
});

test("closed unresolved attempt stays blocked when delayed delivery arrives", async (t) => {
  const f = await fixture(t);
  const action = await f.createAction();
  const execution = await f.createAttempt(action, { outcome_class: "CLOSED_UNRESOLVED" });
  await f.db.run("UPDATE actions SET status = 'BLOCKED', execution_hold_reason = 'CLOSED_WITHOUT_RETRY' WHERE id = ?", [action.id]);
  const result = await f.callbacksService.receiveExecutionCallback(callbackFor(f, action, execution));
  assert.equal(result.applied, false);
  assert.equal(result.reason, "CLOSED_UNRESOLVED");
  assert.equal(result.action.status, "BLOCKED");
  assert.equal(result.execution.outcome_class, "CLOSED_UNRESOLVED");
  assert.equal((await f.followUpsRepository.listForLead(f.organization.id, f.lead.id)).length, 0);
});

test("confirmed delivery cannot regress on a later failure and duplicate identity cannot change its attempt", async (t) => {
  const f = await fixture(t);
  const action = await f.createAction();
  const execution = await f.createAttempt(action);
  const first = await f.callbacksService.receiveExecutionCallback(callbackFor(f, action, execution));
  const duplicate = await f.callbacksService.receiveExecutionCallback(callbackFor(f, action, execution));
  assert.equal(first.applied, true);
  assert.equal(duplicate.duplicate, true);
  await assert.rejects(f.callbacksService.receiveExecutionCallback(callbackFor(f, action, execution, { status: "FAILED" })), { statusCode: 409 });
  const failure = await f.callbacksService.receiveExecutionCallback(callbackFor(f, action, execution, { status: "FAILED", provider_event_id: "late-failure" }));
  assert.equal(failure.applied, false);
  assert.equal(failure.action.status, "COMPLETED");
  assert.equal(failure.execution.outcome_class, "DELIVERED");
  assert.equal((await f.db.get("SELECT COUNT(*) AS count FROM domain_events WHERE type = 'ActionCompleted'")).count, 1);
  const later = await f.createAttempt(action);
  await assert.rejects(f.callbacksService.receiveExecutionCallback(callbackFor(f, action, later, { provider_event_id: "event-" + execution.id })), { statusCode: 409 });
});

test("core callback receipt, exact outcome, action and audit roll back together and retry succeeds", async (t) => {
  const f = await fixture(t);
  const action = await f.createAction();
  const execution = await f.createAttempt(action);
  await f.db.exec("CREATE TRIGGER fail_callback_audit BEFORE INSERT ON audit_logs WHEN NEW.event_type = 'ActionCompleted' BEGIN SELECT RAISE(ABORT, 'synthetic callback audit failure'); END");
  await assert.rejects(f.callbacksService.receiveExecutionCallback(callbackFor(f, action, execution)), { statusCode: 503, code: "EVENT_PROCESSING_FAILED" });
  assert.equal((await f.db.get("SELECT COUNT(*) AS count FROM callbacks")).count, 0);
  assert.equal((await f.db.get("SELECT COUNT(*) AS count FROM domain_events WHERE type = 'ActionCompleted'")).count, 0);
  assert.equal((await f.actionsRepository.getAction(action.id)).status, "EXECUTING");
  assert.equal((await f.executionsRepository.getExecution(execution.id)).outcome_class, "ACCEPTED");
  await f.db.exec("DROP TRIGGER fail_callback_audit");
  f.advance(5000);
  assert.equal((await f.callbacksService.receiveExecutionCallback(callbackFor(f, action, execution))).applied, true);
});

test("SendGrid restrictions survive missing, conflicting or wrong terminal execution correlation", async (t) => {
  for (const variant of ["missing", "conflicting", "wrong"]) {
    const f = await fixture(t);
    const action = await f.createAction();
    const execution = await f.createAttempt(action);
    const event = { event: "spamreport", sg_event_id: "correlation-" + variant, email: f.lead.email, relay_action_id: action.id };
    if (variant !== "missing") Object.assign(event, {
      relay_execution_id: variant === "wrong" ? "unknown-execution" : execution.id,
      relay_revision_id: execution.action_revision_id,
      ...(variant === "conflicting" ? { custom_args: { relay_execution_id: "other-execution" } } : {})
    });
    await assert.rejects(applySendgridEvent(f, f.organization.id, event), { statusCode: variant === "wrong" ? 404 : 400 });
    assert.equal((await f.inspect()).restricted, true, variant);
    assert.equal((await f.executionsRepository.getExecution(execution.id)).outcome_class, "ACCEPTED");
  }
});

test("long SendGrid event identities are bounded, hashed for policy storage and replay-safe", async (t) => {
  const f = await fixture(t);
  const longId = "provider-event-" + "x".repeat(1500);
  const event = { event: "unsubscribe", sg_event_id: longId, email: f.lead.email };
  assert.equal((await applySendgridEvent(f, f.organization.id, event)).applied, true);
  assert.equal((await applySendgridEvent(f, f.organization.id, event)).applied, false);
  const restriction = await f.db.get("SELECT * FROM contact_restrictions");
  assert.match(restriction.source_event_id, /^sendgrid:sha256:[0-9a-f]{64}$/);
  await applySendgridEvent(f, f.organization.id, { ...event, sg_event_id: "short-existing-format" });
  assert.ok(await f.db.get("SELECT id FROM contact_restrictions WHERE source_event_id = ?", ["sendgrid:short-existing-format"]));
  assert.throws(() => normalizeSendgridEvent({ ...event, sg_event_id: "x".repeat(2049) }), { statusCode: 400 });
});

test("SendGrid webhook message identity does not replace its distinct HTTP acceptance reference", async (t) => {
  const f = await fixture(t);
  const action = await f.createAction();
  const execution = await f.createAttempt(action);
  await f.db.run("UPDATE action_executions SET provider_reference = 'http-reference' WHERE id = ?", [execution.id]);
  const event = { event: "delivered", sg_event_id: "distinct-message-reference", sg_message_id: "webhook-reference",
    relay_action_id: action.id, relay_execution_id: execution.id, relay_revision_id: execution.action_revision_id };
  assert.equal((await applySendgridEvent(f, f.organization.id, event)).applied, true);
  assert.equal((await f.executionsRepository.getExecution(execution.id)).provider_reference, "http-reference");
  assert.equal((await f.db.get("SELECT * FROM callbacks")).provider_reference, "webhook-reference");
  const detail = (await f.callbacksRepository.listForAction(action.id))[0];
  assert.equal(detail.provider_event_id, "distinct-message-reference");
  assert.match(detail.storage_provider_event_id, /^receipt:/);
});

test("message side effects recheck ownership when a newer attempt appears after core callback commit", async (t) => {
  const f = await fixture(t);
  const action = await f.createAction();
  const first = await f.createAttempt(action);
  await recordMessage(f, action, first);
  const effect = f.channelWorkflowService.recordExecutionCallbackInTransaction.bind(f.channelWorkflowService);
  let failOnce = true;
  f.channelWorkflowService.recordExecutionCallbackInTransaction = async (tx, input) => {
    if (failOnce) { failOnce = false; throw new Error("Synthetic effects crash"); }
    return effect(tx, input);
  };
  const input = callbackFor(f, action, first);
  await assert.rejects(f.callbacksService.receiveExecutionCallback(input), { statusCode: 503 });
  const newer = await f.createAttempt(action, { newRevision: true });
  await recordMessage(f, action, newer);
  f.advance(5000);
  const result = await f.callbacksService.receiveExecutionCallback(callbackFor(f, action, first));
  assert.equal(result.channel_result.message, null);
  assert.equal(result.channel_result.follow_up, null);
  assert.equal((await f.actionsRepository.getAction(action.id)).active_execution_id, newer.id);
  assert.equal((await f.executionsRepository.getExecution(newer.id)).outcome_class, "ACCEPTED");
});

test("competing duplicate callbacks commit one receipt, completion event and follow-up", async (t) => {
  const f = await fixture(t);
  const action = await f.createAction();
  const execution = await f.createAttempt(action);
  const input = callbackFor(f, action, execution);
  const results = await Promise.all([
    f.callbacksService.receiveExecutionCallback(input), f.callbacksService.receiveExecutionCallback(input)
  ]);
  assert.equal(results.filter((row) => row.applied).length, 1);
  assert.equal(results.filter((row) => row.duplicate).length, 1);
  assert.equal((await f.db.get("SELECT COUNT(*) AS count FROM callbacks")).count, 1);
  assert.equal((await f.db.get("SELECT COUNT(*) AS count FROM domain_events WHERE type = 'ActionCompleted'")).count, 1);
  assert.equal((await f.followUpsRepository.listForLead(f.organization.id, f.lead.id)).length, 1);
});

test("ancillary failure leaves a pending cursor and duplicate replay repairs local effects once", async (t) => {
  const f = await fixture(t);
  const action = await f.createAction();
  const execution = await f.createAttempt(action);
  const original = f.channelWorkflowService.recordExecutionCallbackInTransaction.bind(f.channelWorkflowService);
  f.channelWorkflowService.recordExecutionCallbackInTransaction = async () => { throw new Error("synthetic ancillary storage failure"); };
  const input = callbackFor(f, action, execution);
  await assert.rejects(f.callbacksService.receiveExecutionCallback(input), { statusCode: 503, code: "EVENT_PROCESSING_FAILED" });
  assert.equal((await f.executionsRepository.getExecution(execution.id)).outcome_class, "DELIVERED");
  assert.equal((await f.actionsRepository.getAction(action.id)).status, "COMPLETED");
  assert.equal((await f.db.get("SELECT * FROM callbacks")).effects_status, "PENDING");
  const failure = await f.db.get("SELECT * FROM audit_logs WHERE event_type = 'WebhookProcessingDeferred'");
  assert.ok(failure);
  assert.doesNotMatch(JSON.stringify(failure), /synthetic ancillary storage failure/);
  assert.equal((await f.callbacksService.receiveExecutionCallback(input)).duplicate, true);
  assert.equal((await f.followUpsRepository.listForLead(f.organization.id, f.lead.id)).length, 0);
  f.channelWorkflowService.recordExecutionCallbackInTransaction = original;
  f.advance(5000);
  await f.webhookInbox.processDue();
  assert.equal((await f.db.get("SELECT * FROM callbacks")).effects_status, "DONE");
  assert.equal((await f.followUpsRepository.listForLead(f.organization.id, f.lead.id)).length, 1);
  assert.equal((await f.db.get("SELECT COUNT(*) AS count FROM domain_events WHERE type = 'ActionCompleted'")).count, 1);
});

test("uncertain send with no conversation is recovered from its exact immutable revision after later delivery", async (t) => {
  const f = await fixture(t);
  const action = await f.createAction();
  const execution = await f.createAttempt(action, { outcome_class: "UNCERTAIN" });
  const revision = await f.db.get("SELECT * FROM action_revisions WHERE id = ?", [execution.action_revision_id]);
  const envelope = JSON.parse(revision.envelope_json);
  assert.equal((await f.db.get("SELECT COUNT(*) AS count FROM channel_messages")).count, 0);
  await f.db.run("UPDATE leads SET email = 'changed-recipient@example.com' WHERE id = ?", [f.lead.id]);
  await f.actionsRepository.mergePayload(action.id, { subject: "MUTATED SUBJECT", body: "MUTATED BODY" });
  await f.db.run("UPDATE actions SET execution_hold_reason = 'PROVIDER_OUTCOME_UNCERTAIN' WHERE id = ?", [action.id]);
  const event = { event: "delivered", sg_event_id: "late-uncertain-delivery", sg_message_id: "provider-webhook-reference",
    relay_action_id: action.id, relay_execution_id: execution.id, relay_revision_id: execution.action_revision_id };
  assert.equal((await applySendgridEvent(f, f.organization.id, event)).applied, true);
  assert.equal((await applySendgridEvent(f, f.organization.id, event)).applied, false);
  const messages = await f.channelMessagesRepository.listForLead(f.organization.id, f.lead.id);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].status, "DELIVERED");
  assert.equal(messages[0].subject, envelope.subject);
  assert.equal(messages[0].body, envelope.body);
  assert.equal(messages[0].payload.recipient, envelope.recipient);
  assert.deepEqual(messages[0].payload.sender, envelope.sender);
  assert.equal(messages[0].payload.execution_id, execution.id);
  assert.equal(messages[0].payload.prepared_revision_id, revision.id);
  assert.doesNotMatch(JSON.stringify(messages[0]), /MUTATED|changed-recipient|provider_config/);
  assert.equal((await f.executionsRepository.listForAction(action.id)).length, 1);
  assert.equal((await f.followUpsRepository.listForLead(f.organization.id, f.lead.id)).length, 1);
});
