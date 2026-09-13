import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { startClient } from "./helpers/testClient.js";
import { approveStoredAction } from "./helpers/review.js";
import { resolveDispatchPolicy } from "../src/modules/outbound-automation/dispatchPolicy.js";
import { AuditRepository } from "../src/modules/events/auditRepository.js";

const START = Date.parse("2026-09-11T10:00:00.000Z");
const accepted = { ok: true, provider: "email-sandbox", provider_reference: "synthetic-accepted" };
const rejected = { ok: false, retryable: true, uncertain: false, error: "Synthetic confirmed rejection." };
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
async function fixture(t, { scheduled_at = null, policy = {} } = {}) {
  const client = await startClient(t);
  const registered = await client.register("Bounded execution");
  const lead = await client.services.leadsRepository.createLead({
    organization_id: registered.organization.id, name: "Synthetic recipient", email: "recipient@example.test"
  });
  const action = await client.services.actionsRepository.createAction({
    organization_id: registered.organization.id, lead_id: lead.id, type: "SEND_EMAIL",
    idempotency_key: "bounded:" + lead.id, scheduled_at,
    payload: { subject: "Synthetic question", message: "The exact reviewed message." }
  });
  const clock = { value: START };
  const executor = client.services.actionExecutor;
  executor.now = () => clock.value;
  executor.random = () => 0;
  executor.policy = resolveDispatchPolicy(policy);
  // Ancillary message/callback behavior has separate integration coverage.
  executor.channelWorkflowService = null;
  await approveStoredAction(client.services, action);
  const recovery = client.services.dispatchRecoveryService;
  const scope = { organization_id: action.organization_id, action_id: action.id };
  return { client, action, lead, clock, executor, recovery, scope, actor: registered.user.id };
}
async function uncertainty(f) {
  f.executor.adapter = { async invoke() { throw new Error("Synthetic transport lost after possible acceptance"); } };
  return f.executor.execute(f.action);
}
function resolution(f, result, extra = {}) {
  return { ...f.scope, expected_execution_id: result.execution.id, expected_fence: result.execution.fence_token,
    decision: "CLOSE_WITHOUT_RETRY", evidence_note: "Operator reviewed the synthetic provider record.",
    reviewer_user_id: f.actor, ...extra };
}

test("API and worker defer future actions without a provider invocation or an attempt", async (t) => {
  const f = await fixture(t, { scheduled_at: new Date(START + 60000).toISOString() });
  let calls = 0;
  f.executor.adapter = { async invoke() { calls++; return accepted; } };
  const early = await f.client.post("/api/actions/" + f.action.id + "/execute", {});
  assert.equal(early.execution_result.deferred, true);
  assert.notEqual(early.execution_result.dispatched, true);
  assert.equal((await f.client.services.worker.runOnce({ organization_id: f.action.organization_id })).executed_actions.length, 0);
  assert.equal(calls, 0);
  assert.equal(await f.client.services.executionsRepository.countForAction(f.action.id), 0);
  f.clock.value += 60000;
  assert.equal((await f.executor.execute(f.action)).outcome_class, "ACCEPTED");
  assert.equal(calls, 1);
});

test("invalid stored due times fail closed without a provider request", async (t) => {
  const f = await fixture(t, { scheduled_at: "2026-02-30T10:00:00.000Z" });
  f.executor.adapter = { async invoke() { assert.fail("Invalid date must not send"); } };
  const result = await f.executor.execute(f.action);
  assert.equal(result.hold_reason, "INVALID_SCHEDULE_TIME");
  assert.equal(result.status, "BLOCKED");
  assert.equal(await f.client.services.executionsRepository.countForAction(f.action.id), 0);
});

test("known rejections use durable exponential backoff and stop at the action attempt budget", async (t) => {
  const f = await fixture(t);
  const keys = [];
  f.executor.adapter = { async invoke(_action, _payload, _attempt, context) { keys.push(context.provider_intent_key); return rejected; } };
  const first = await f.executor.execute(f.action);
  assert.equal(first.status, "RETRYING");
  assert.equal(first.dispatched, true);
  assert.equal(first.next_attempt_at, new Date(START + 15000).toISOString());
  assert.equal(first.attempts_remaining, 2);
  assert.equal((await f.executor.execute(f.action)).deferred, true);
  assert.equal(keys.length, 1);
  f.clock.value = Date.parse(first.next_attempt_at);
  const second = await f.executor.execute(f.action);
  assert.equal(second.next_attempt_at, new Date(f.clock.value + 30000).toISOString());
  f.clock.value = Date.parse(second.next_attempt_at);
  const third = await f.executor.execute(f.action);
  assert.equal(third.status, "FAILED");
  assert.equal(third.hold_reason, "RETRY_BUDGET_EXHAUSTED");
  assert.equal(third.attempts_remaining, 0);
  assert.equal(new Set(keys).size, 1);
  assert.equal((await f.executor.execute(f.action)).executable, false);
  assert.equal(keys.length, 3);
});

test("edited review preserves the total attempt budget and elapsed deadline", async (t) => {
  const f = await fixture(t, { policy: { maxAttempts: 2 } });
  f.executor.adapter = { async invoke() { return rejected; } };
  const first = await f.executor.execute(f.action);
  await f.client.approve(f.action.id, { body: "A newly reviewed exact message." });
  f.clock.value = Date.parse(first.next_attempt_at);
  const second = await f.executor.execute(f.action);
  assert.notEqual(second.execution.action_revision_id, first.execution.action_revision_id);
  assert.equal(second.retry_deadline_at, first.retry_deadline_at);
  assert.equal(second.first_dispatch_at, first.first_dispatch_at);
  assert.equal(second.status, "FAILED");
  assert.equal(second.attempts_remaining, 0);
});

test("Retry-After wins over jitter and a hint beyond the deadline exhausts without shortening it", async (t) => {
  const f = await fixture(t);
  f.executor.adapter = { async invoke() { return { ...rejected, retry_after_ms: 120000 }; } };
  const first = await f.executor.execute(f.action);
  assert.equal(first.next_attempt_at, new Date(START + 120000).toISOString());
  f.clock.value = Date.parse(first.next_attempt_at);
  f.executor.adapter = { async invoke() { return { ...rejected, retry_after_ms: 2 * 60 * 60 * 1000 }; } };
  const second = await f.executor.execute(f.action);
  assert.equal(second.status, "FAILED");
  assert.equal(second.next_attempt_at, null);
  assert.equal(second.hold_reason, "RETRY_BUDGET_EXHAUSTED");
});

test("elapsed deadline is checked again before authorization", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  f.executor.adapter = { async invoke() { calls++; return rejected; } };
  const first = await f.executor.execute(f.action);
  f.clock.value = Date.parse(first.retry_deadline_at);
  const exhausted = await f.executor.execute(f.action);
  assert.equal(exhausted.hold_reason, "RETRY_BUDGET_EXHAUSTED");
  assert.equal(calls, 1);
});

test("Resend retry key and its original expiry remain fixed across attempts", async (t) => {
  const f = await fixture(t, { policy: { providerKeyWindowMs: 50000 } });
  await f.client.services.settingsRepository.setBulk(f.action.organization_id, "channel_email",
    { provider: "resend", from_email: "sender@example.test", api_key: "synthetic-key" });
  await approveStoredAction(f.client.services, f.action);
  let calls = 0;
  f.executor.adapter = { async invoke() { calls++; return calls === 1 ? rejected : { ...rejected, retry_after_ms: 60000 }; } };
  const first = await f.executor.execute(f.action);
  f.clock.value = Date.parse(first.next_attempt_at);
  const second = await f.executor.execute(f.action);
  assert.equal(second.execution.provider_intent_key, first.execution.provider_intent_key);
  assert.equal(second.execution.provider_key_expires_at, first.execution.provider_key_expires_at);
  assert.equal(second.hold_reason, "PROVIDER_KEY_EXPIRED");
  assert.equal(second.status, "FAILED");
});

test("expired dispatch is held; recovery and a late owner result cannot cause a resend", async (t) => {
  const f = await fixture(t);
  const entered = deferred(), finish = deferred();
  let calls = 0;
  f.executor.adapter = { async invoke() { calls++; entered.resolve(); return finish.promise; } };
  const operation = f.executor.execute(f.action);
  await entered.promise;
  f.clock.value += 61000;
  const inspected = await f.recovery.inspectAction(f.scope);
  assert.equal(inspected.execution.outcome_class, "DISPATCHING"); // Inspection is read-only.
  assert.equal(inspected.can_resolve, true);
  assert.equal((await f.recovery.expireLeases({ organization_id: f.action.organization_id })).expired, 1);
  const expired = await f.recovery.inspectAction(f.scope);
  assert.equal(expired.outcome_class, "UNCERTAIN");
  assert.equal((await f.executor.execute(f.action)).executable, false);
  const resolved = await f.recovery.resolve(resolution(f, expired, {
    decision: "ACCEPTED", provider_reference: "dashboard-reference"
  }));
  assert.equal(resolved.outcome_class, "ACCEPTED");
  assert.equal(resolved.status, "EXECUTING");
  finish.resolve(accepted);
  const late = await operation;
  assert.equal(late.stale_result, true);
  assert.equal(late.dispatched, true);
  assert.equal(late.execution.provider_reference, "dashboard-reference");
  assert.equal(late.hold_reason, "OPERATOR_REPORTED_ACCEPTED");
  assert.equal(calls, 1);
});

test("a lease that expires before the HTTP outcome write becomes uncertain even before the sweep", async (t) => {
  const f = await fixture(t);
  f.executor.adapter = { async invoke() { f.clock.value += 60000; return accepted; } };
  const result = await f.executor.execute(f.action);
  assert.equal(result.stale_result, true);
  assert.equal(result.outcome_class, "UNCERTAIN");
  assert.equal(result.hold_reason, "LEASE_EXPIRED");
  assert.equal(result.execution.provider_reference, null);
});

test("a stale fence cannot overwrite superseding ownership", async (t) => {
  const f = await fixture(t);
  const entered = deferred(), finish = deferred();
  f.executor.adapter = { async invoke() { entered.resolve(); return finish.promise; } };
  const operation = f.executor.execute(f.action);
  await entered.promise;
  await f.client.services.contactPolicyService.withWorkspacePolicyTransaction(f.action.organization_id, async (tx) => {
    await tx.run("UPDATE actions SET execution_fence = execution_fence + 1, execution_hold_reason = 'SYNTHETIC_NEW_OWNER' WHERE id = ?", [f.action.id]);
  });
  finish.resolve(accepted);
  const result = await operation;
  assert.equal(result.stale_result, true);
  assert.equal(result.hold_reason, "SYNTHETIC_NEW_OWNER");
  assert.equal(result.execution.outcome_class, "DISPATCHING");
  assert.equal(result.execution.provider_reference, null);
});

test("confirmed acceptance is never expired or retried because delivery is still pending", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  f.executor.adapter = { async invoke() { calls++; return accepted; } };
  const first = await f.executor.execute(f.action);
  assert.equal(first.execution.status, "STARTED");
  assert.equal(first.outcome_class, "ACCEPTED");
  f.clock.value += 2 * 24 * 60 * 60 * 1000;
  assert.equal((await f.recovery.expireLeases({ organization_id: f.action.organization_id })).expired, 0);
  assert.equal((await f.executor.execute(f.action)).executable, false);
  assert.equal(calls, 1);
});

test("stopAccepting prevents new claims and drain waits for the existing provider operation", async (t) => {
  const f = await fixture(t);
  const entered = deferred(), finish = deferred();
  f.executor.adapter = { async invoke() { entered.resolve(); return finish.promise; } };
  const operation = f.executor.execute(f.action);
  await entered.promise;
  f.executor.stopAccepting();
  await assert.rejects(f.executor.execute(f.action), { code: "DISPATCH_DRAINING", statusCode: 503 });
  let drained = false;
  const drain = f.executor.drain().then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(drained, false);
  finish.resolve(accepted);
  assert.equal((await operation).outcome_class, "ACCEPTED");
  await drain;
  assert.equal(drained, true);
});

test("recovery validates actor, evidence, scope and exact fence, and conflicting decisions cannot replace history", async (t) => {
  const f = await fixture(t);
  const result = await uncertainty(f);
  const input = resolution(f, result);
  await assert.rejects(f.recovery.resolve({ ...input, evidence_note: " " }), { code: "INVALID_RECOVERY_INPUT" });
  await assert.rejects(f.recovery.resolve({ ...input, reviewer_user_id: "" }), { code: "INVALID_RECOVERY_INPUT" });
  await assert.rejects(f.recovery.resolve({ ...input, expected_fence: input.expected_fence + 1 }), { code: "STALE_RECOVERY_TARGET" });
  await assert.rejects(f.recovery.resolve({ ...input, decision: "ACCEPTED" }), { code: "RECOVERY_REFERENCE_REQUIRED" });
  const other = await f.client.register("Foreign recovery owner");
  await assert.rejects(f.recovery.resolve({ ...input, organization_id: other.organization.id }), { code: "ACTION_NOT_FOUND" });
  const closed = await f.recovery.resolve(input);
  assert.equal(closed.status, "BLOCKED");
  assert.equal(closed.outcome_class, "CLOSED_UNRESOLVED");
  assert.equal((await f.recovery.resolve(input)).duplicate, true);
  await assert.rejects(f.recovery.resolve({ ...input, decision: "ACCEPTED", provider_reference: "different" }), { code: "RECOVERY_ALREADY_DECIDED" });
  assert.equal((await f.executor.execute(f.action)).executable, false);
  assert.equal((await f.client.db.all("SELECT * FROM dispatch_resolutions")).length, 1);
});

test("recovery refuses a still-live lease and leaves its ownership untouched", async (t) => {
  const f = await fixture(t);
  const entered = deferred(), finish = deferred();
  f.executor.adapter = { async invoke() { entered.resolve(); return finish.promise; } };
  const operation = f.executor.execute(f.action);
  await entered.promise;
  const live = await f.recovery.inspectAction(f.scope);
  assert.equal(live.can_resolve, false);
  await assert.rejects(f.recovery.resolve(resolution(f, live)), { code: "EXECUTION_STILL_IN_FLIGHT" });
  finish.resolve(accepted);
  assert.equal((await operation).outcome_class, "ACCEPTED");
});

test("failed resolution audit rolls back decision, execution and action together", async (t) => {
  const f = await fixture(t);
  const result = await uncertainty(f);
  const record = AuditRepository.prototype.record;
  AuditRepository.prototype.record = async function (input) {
    if (input.event_type === "DispatchRecoveryResolved") throw new Error("Synthetic resolution audit storage failure");
    return record.call(this, input);
  };
  try { await assert.rejects(f.recovery.resolve(resolution(f, result)), /Synthetic resolution audit storage failure/); }
  finally { AuditRepository.prototype.record = record; }
  const current = await f.recovery.inspectAction(f.scope);
  assert.equal(current.outcome_class, "UNCERTAIN");
  assert.equal(current.status, "EXECUTING");
  assert.equal(current.resolutions.length, 0);
  assert.equal((await f.recovery.resolve(resolution(f, result))).outcome_class, "CLOSED_UNRESOLVED");
});

test("durable holds remain authoritative after coarse status or review changes", async (t) => {
  const f = await fixture(t);
  await uncertainty(f);
  await f.client.services.actionsRepository.updateStatus(f.action.id, "APPROVED");
  await approveStoredAction(f.client.services, f.action);
  f.executor.adapter = { async invoke() { assert.fail("Review cannot release an uncertain execution hold"); } };
  const result = await f.executor.execute(f.action);
  assert.equal(result.hold_reason, "PROVIDER_OUTCOME_UNCERTAIN");
  assert.equal(result.executable, false);
});

test("ambiguous legacy attempts remain inspectable without choosing the latest as active", async (t) => {
  const f = await fixture(t);
  for (const attempt of [1, 2]) {
    await f.client.services.executionsRepository.createExecution({
      action_id: f.action.id, attempt, status: "STARTED", provider: "legacy-provider",
      idempotency_key: "legacy:" + f.action.id + ":" + attempt
    });
  }
  await f.client.db.run("UPDATE actions SET execution_hold_reason = 'LEGACY_OUTCOME_REVIEW_REQUIRED' WHERE id = ?", [f.action.id]);
  const view = await f.recovery.inspectAction(f.scope);
  assert.equal(view.execution, null);
  assert.equal(view.executions.length, 2);
  assert.equal(view.can_resolve, false);
  assert.equal((await f.recovery.listForOrganization({ organization_id: f.action.organization_id })).items.length, 1);
  await assert.rejects(f.recovery.resolve({ ...f.scope, expected_execution_id: view.executions[1].id,
    expected_fence: null, decision: "CLOSE_WITHOUT_RETRY", evidence_note: "Inspected history", reviewer_user_id: f.actor }),
    { code: "STALE_RECOVERY_TARGET" });
});

test("retry deadline, next due time and stable key survive a database restart", async (t) => {
  const databaseFile = join(tmpdir(), "relay-dispatch-restart-" + randomUUID() + ".sqlite");
  const firstClient = await startClient(t, databaseFile, { autoCleanup: false });
  let secondClient;
  t.after(async () => { await firstClient.stop(); await secondClient?.stop(); await rm(databaseFile, { force: true }); });
  const { organization } = await firstClient.register("Restarted retry");
  const lead = await firstClient.services.leadsRepository.createLead({ organization_id: organization.id, name: "Restart recipient", email: "restart@example.test" });
  const action = await firstClient.services.actionsRepository.createAction({
    organization_id: organization.id, lead_id: lead.id, type: "SEND_EMAIL",
    idempotency_key: "restart:" + lead.id, payload: { subject: "Synthetic", message: "Reviewed once." }
  });
  await approveStoredAction(firstClient.services, action);
  firstClient.services.actionExecutor.now = () => START;
  firstClient.services.actionExecutor.random = () => 0;
  firstClient.services.actionExecutor.channelWorkflowService = null;
  firstClient.services.actionExecutor.adapter = { async invoke() { return rejected; } };
  const first = await firstClient.services.actionExecutor.execute(action);
  await firstClient.stop();
  secondClient = await startClient(t, databaseFile, { autoCleanup: false });
  let now = START;
  secondClient.services.actionExecutor.now = () => now;
  secondClient.services.actionExecutor.random = () => 0;
  secondClient.services.actionExecutor.channelWorkflowService = null;
  let calls = 0;
  secondClient.services.actionExecutor.adapter = { async invoke() { calls++; return accepted; } };
  assert.equal((await secondClient.services.actionExecutor.execute(action)).deferred, true);
  assert.equal(calls, 0);
  now = Date.parse(first.next_attempt_at);
  const second = await secondClient.services.actionExecutor.execute(action);
  assert.equal(second.execution.attempt, 2);
  assert.equal(second.execution.provider_intent_key, first.execution.provider_intent_key);
  assert.equal(second.retry_deadline_at, first.retry_deadline_at);
  assert.equal(second.first_dispatch_at, first.first_dispatch_at);
});

test("an exact callback before HTTP completion still records the captured delivered message", async (t) => {
  const f = await fixture(t);
  f.executor.channelWorkflowService = f.client.services.channelWorkflowService;
  f.executor.adapter = { async invoke(action, _payload, _attempt, context) {
    await f.client.services.callbacksService.receiveExecutionCallback({
      organization_id: action.organization_id, action_id: action.id,
      action_execution_id: context.execution_id, revision_id: context.approvedDispatch.revision_id,
      provider_event_id: "synthetic-early-delivery", status: "COMPLETED"
    });
    return accepted;
  } };
  const result = await f.executor.execute(f.action);
  assert.equal(result.callbackAlreadyApplied, true);
  assert.equal(result.status, "COMPLETED");
  const message = await f.client.services.channelMessagesRepository.latestOutboundForAction(f.action.id, f.action.organization_id);
  assert.equal(message.status, "DELIVERED");
  assert.equal(message.body, "The exact reviewed message.");
  assert.equal(message.payload.execution_id, result.execution.id);
});

for (const scenario of [
  { action: "COMPLETED", execution: "COMPLETED", hold: null },
  { action: "EXECUTING", execution: "COMPLETED", hold: "LEGACY_OUTCOME_REVIEW_REQUIRED" },
  { action: "FAILED", execution: "FAILED", hold: "LEGACY_OUTCOME_REVIEW_REQUIRED" },
]) {
  test("recovery preserves historical terminal work: action " + scenario.action + " / attempt " + scenario.execution, async (t) => {
    const f = await fixture(t);
    const execution = await f.client.services.executionsRepository.createExecution({
      action_id: f.action.id, status: scenario.execution, attempt: 1, provider: "historical",
      provider_reference: "historical-reference", idempotency_key: "historical:" + f.action.id
    });
    await f.client.db.run("UPDATE actions SET status = ?, execution_hold_reason = ? WHERE id = ?", [scenario.action, scenario.hold, f.action.id]);
    const before = await f.client.services.actionsRepository.getAction(f.action.id);
    const view = await f.recovery.inspectAction(f.scope);
    assert.equal(view.can_resolve, false);
    await assert.rejects(f.recovery.resolve({ ...f.scope, expected_execution_id: execution.id, expected_fence: null,
      decision: "ACCEPTED", provider_reference: "replacement", evidence_note: "Synthetic historical evidence",
      reviewer_user_id: f.actor }), { code: "EXECUTION_NOT_RECOVERABLE" });
    assert.deepEqual(await f.client.services.actionsRepository.getAction(f.action.id), before);
    assert.deepEqual({ ...await f.client.services.executionsRepository.getExecution(execution.id) }, execution);
    assert.equal((await f.client.db.all("SELECT * FROM dispatch_resolutions")).length, 0);
  });
}

test("concurrent bounded expiry sweeps record one uncertainty transition", async (t) => {
  const f = await fixture(t);
  const entered = deferred(), finish = deferred();
  f.executor.adapter = { async invoke() { entered.resolve(); return finish.promise; } };
  const operation = f.executor.execute(f.action);
  await entered.promise;
  f.clock.value += 60000;
  const sweeps = await Promise.all([
    f.recovery.expireLeases({ organization_id: f.action.organization_id }),
    f.recovery.expireLeases({ organization_id: f.action.organization_id })
  ]);
  assert.equal(sweeps.reduce((sum, result) => sum + result.expired, 0), 1);
  assert.equal((await f.client.db.get("SELECT COUNT(*) AS count FROM audit_logs WHERE event_type = 'DispatchLeaseExpired'")).count, 1);
  finish.resolve(accepted);
  assert.equal((await operation).outcome_class, "UNCERTAIN");
});

test("a stricter per-action limit freezes before dispatch and review changes cannot replenish it", async (t) => {
  const f = await fixture(t);
  await f.client.db.run("UPDATE actions SET max_attempts = 1 WHERE id = ?", [f.action.id]);
  let calls = 0;
  f.executor.adapter = { async invoke() { calls++; return rejected; } };
  const first = await f.executor.execute(f.action);
  assert.equal(first.max_attempts, 1);
  assert.equal(first.hold_reason, "RETRY_BUDGET_EXHAUSTED");
  // Simulate an older repair path changing coarse status; the durable hold and
  // frozen budget must remain authoritative even after a new exact review.
  await f.client.services.actionsRepository.updateStatus(f.action.id, "APPROVED");
  await f.client.approve(f.action.id, { body: "A replacement reviewed revision." });
  const next = await f.executor.execute(f.action);
  assert.equal(next.max_attempts, 1);
  assert.equal(next.hold_reason, "RETRY_BUDGET_EXHAUSTED");
  assert.equal(next.attempts_remaining, 0);
  assert.equal(calls, 1);
});

for (const decision of ["CLOSE_WITHOUT_RETRY", "ACCEPTED"]) {
  test("resolved " + decision + " history cannot hide a new uncertain action from the bounded active queue", async (t) => {
    const f = await fixture(t);
    const old = await uncertainty(f);
    await f.recovery.resolve(resolution(f, old, {
      decision, ...(decision === "ACCEPTED" ? { provider_reference: "synthetic-provider-evidence" } : {})
    }));
    const next = await f.client.services.actionsRepository.createAction({
      organization_id: f.action.organization_id, lead_id: f.lead.id, type: "SEND_EMAIL",
      idempotency_key: "new-uncertainty:" + f.action.id,
      payload: { subject: "New intent", message: "A separately reviewed new action." }
    });
    await approveStoredAction(f.client.services, next);
    await f.executor.execute(next);
    const queue = await f.recovery.listForOrganization({ organization_id: f.action.organization_id, limit: 1 });
    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0].action_id, next.id);
    assert.equal(queue.items[0].can_resolve, true);
    const history = await f.recovery.inspectAction(f.scope);
    assert.equal(history.resolutions.length, 1);
    assert.equal(history.resolutions[0].decision, decision);
  });
}
