import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { DispatchControlsService } from "../src/modules/outbound-automation/dispatchControlsService.js";
import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";
import { approveStoredAction } from "./helpers/review.js";
import { AuditRepository } from "../src/modules/events/auditRepository.js";
const START = Date.parse("2026-09-11T10:00:00.000Z");
const ACCEPTED = { ok: true, provider: "synthetic", provider_reference: "accepted-reference" };
const REJECTED = { ok: false, retryable: true, uncertain: false, error: "Confirmed synthetic rejection." };
async function fixture(t, databaseFile = ":memory:") {
 const client = await startClient(t, databaseFile); const registered = await client.register("Dispatch controls");
 const org = registered.organization.id, actor = registered.user.id, clock = { value: START };
 const lead = await client.services.leadsRepository.createLead({ organization_id: org, name: "Synthetic recipient", email: "recipient@example.test", phone: "+14155550123" });
 const executor = client.services.actionExecutor; executor.now = () => clock.value; executor.random = () => 0; executor.channelWorkflowService = null;
 const controls = client.services.dispatchControlsService; let calls = 0;
 executor.adapter = { async invoke() { calls++; return ACCEPTED; } };
 async function action(type = "SEND_EMAIL") {
  const row = await client.services.actionsRepository.createAction({ organization_id: org, lead_id: lead.id, type,
   idempotency_key: "controls:" + crypto.randomUUID(), payload: { subject: "Reviewed question", message: "Exact synthetic content." } });
  if (type.startsWith("SEND_")) await approveStoredAction(client.services, row);
  return row;
 }
 async function update(extra = {}) {
  const before = await controls.inspect({ organization_id: org });
  return controls.update({ organization_id: org, actor, expected_revision: before.controls.revision,
   paused: false, daily_attempt_limit: 100, unresolved_limit: 2, reason: "Synthetic operator decision.", ...extra });
 }
 return { client, org, actor, clock, lead, executor, controls, action, update, calls: () => calls };
}
async function state(f, action) { return f.client.services.actionsRepository.getAction(action.id); }
async function candidateIds(f) {
 const at = new Date(f.clock.value).toISOString();
 return (await f.client.services.actionsRepository.nextExecutable(100, f.org, at, f.controls.candidatePredicate({ actionAlias: "actions", kind: f.client.db.kind, at }))).map(a => a.id);
}
test("missing controls have explicit safe defaults and revision zero", async t => {
 const f = await fixture(t), result = await f.controls.inspect({ organization_id: f.org });
 assert.equal(result.controls.revision, 0); assert.equal(result.controls.daily_attempt_limit, 100); assert.equal(result.controls.unresolved_limit, 2);
 assert.equal(result.global_enabled, true); assert.equal(result.can_dispatch, true); assert.equal(result.usage.resets_at, "2026-09-12T00:00:00.000Z");
 assert.equal((await f.client.db.get("SELECT COUNT(*) AS n FROM workspace_dispatch_controls")).n, 0);
});
test("owner controls use exact revision, derived scope, bounded values and one atomic audit", async t => {
 const f = await fixture(t); const saved = await f.update({ paused: true }); assert.equal(saved.controls.revision, 1);
 await assert.rejects(f.update({ expected_revision: 0 }), { code: "DISPATCH_CONTROLS_STALE" });
 await assert.rejects(f.update({ actor: "foreign-user" }), { statusCode: 403 });
 for (const invalid of [{ daily_attempt_limit: 0 }, { daily_attempt_limit: 1001 }, { unresolved_limit: 11 }, { paused: "false" }, { reason: " " }]) await assert.rejects(f.update(invalid), { statusCode: 400 });
 assert.equal((await f.client.db.get("SELECT COUNT(*) AS n FROM audit_logs WHERE event_type = 'DispatchControlsUpdated'")).n, 1);
 const original = AuditRepository.prototype.record; t.after(() => { AuditRepository.prototype.record = original; });
 AuditRepository.prototype.record = async function(input) { if (input.event_type === "DispatchControlsUpdated") throw new Error("Synthetic audit failure"); return original.call(this, input); };
 await assert.rejects(f.update({ paused: false }), /Synthetic audit failure/);
 assert.equal((await f.controls.inspect({ organization_id: f.org })).controls.paused, true);
 assert.equal((await f.controls.inspect({ organization_id: f.org })).controls.revision, 1);
});
for (const type of ["SEND_EMAIL", "SEND_SMS", "SEND_WHATSAPP", "SEND_VOICE_CALL"]) test(type + " pause preserves exact approval and consumes no attempt", async t => {
 const f = await fixture(t), action = await f.action(type), before = await state(f, action);
 await f.update({ paused: true }); const held = await f.executor.execute(action);
 assert.equal(held.operations_hold, "WORKSPACE_DISPATCH_PAUSED"); assert.notEqual(held.dispatched, true);
 assert.equal(f.calls(), 0); assert.deepEqual(await state(f, action), before); assert.equal((await candidateIds(f)).includes(action.id), false);
 assert.equal(await f.client.services.executionsRepository.countForAction(action.id), 0);
 await f.update(); assert.equal((await f.executor.execute(action)).dispatched, true); assert.equal(f.calls(), 1);
});
test("global hold cannot be overridden by workspace owner and leaves human task admission available", async t => {
 const f = await fixture(t), send = await f.action(), human = await f.action("CREATE_HUMAN_TASK");
 f.controls.globalEnabled = false; await f.update();
 assert.equal((await f.executor.execute(send)).operations_hold, "GLOBAL_DISPATCH_PAUSED");
 assert.deepEqual(await candidateIds(f), [human.id]);
 assert.equal((await f.executor.execute(human)).dispatched, true);
 assert.equal((await f.controls.inspect({ organization_id: f.org })).usage.attempts_used, 0);
});
test("concurrent callers cannot both authorize the last UTC-day attempt", async t => {
 const f = await fixture(t), first = await f.action(), second = await f.action(); await f.update({ daily_attempt_limit: 1 });
 const results = await Promise.all([f.executor.execute(first), f.executor.execute(second)]);
 assert.equal(results.filter(r => r.dispatched).length, 1); assert.equal(results.filter(r => r.operations_hold === "DAILY_DISPATCH_LIMIT").length, 1);
 assert.equal(f.calls(), 1); assert.equal((await f.controls.inspect({ organization_id: f.org })).usage.attempts_used, 1);
 assert.deepEqual(await candidateIds(f), []);
 // Changing the limit cannot reset usage.
 assert.equal((await f.update({ daily_attempt_limit: 2 })).usage.attempts_used, 1);
});
test("an unresolved claim consumes the last slot before transport and uncertainty retains it after expiry", async t => {
 const f = await fixture(t), first = await f.action(), second = await f.action(); await f.update({ unresolved_limit: 1 });
 let release, entered; const ready = new Promise(r => { entered = r; }); const pending = new Promise(r => { release = r; });
 f.executor.adapter = { async invoke() { entered(); return pending; } };
 const work = f.executor.execute(first); await ready;
 assert.equal((await f.executor.execute(second)).operations_hold, "UNRESOLVED_DISPATCH_LIMIT");
 f.clock.value += 61000; await f.client.services.dispatchRecoveryService.expireLeases({ organization_id: f.org });
 assert.equal((await f.executor.execute(second)).operations_hold, "UNRESOLVED_DISPATCH_LIMIT");
 release(ACCEPTED); const result = await work;
 assert.equal(result.uncertain, true);
 const recovery = await f.client.services.dispatchRecoveryService.inspectAction({ organization_id: f.org, action_id: first.id });
 await f.client.services.dispatchRecoveryService.resolve({ organization_id: f.org, action_id: first.id,
  expected_execution_id: recovery.execution.id, expected_fence: recovery.execution.fence_token, decision: "CLOSE_WITHOUT_RETRY",
  evidence_note: "Reviewed provider evidence; close without another send.", reviewer_user_id: f.actor });
 assert.equal((await f.controls.inspect({ organization_id: f.org })).usage.unresolved_used, 0);
 assert.equal((await candidateIds(f)).includes(second.id), true);
});
test("confirmed acceptance releases its slot while accepted history remains unchanged", async t => {
 const f = await fixture(t), first = await f.action(), second = await f.action(); await f.update({ unresolved_limit: 1 });
 const result = await f.executor.execute(first); assert.equal(result.execution.outcome_class, "ACCEPTED");
 assert.equal((await f.controls.inspect({ organization_id: f.org })).usage.unresolved_used, 0);
 assert.equal((await f.executor.execute(second)).dispatched, true);
 assert.equal((await state(f, first)).status, "EXECUTING");
});
test("sandbox and retries consume daily attempts and pause/day rollover never replenish the action budget", async t => {
 const f = await fixture(t), action = await f.action(); await f.update({ daily_attempt_limit: 1 });
 f.executor.adapter = { async invoke() { return REJECTED; } };
 const first = await f.executor.execute(action); f.clock.value = Date.parse(first.next_attempt_at);
 assert.equal((await f.executor.execute(action)).operations_hold, "DAILY_DISPATCH_LIMIT");
 await f.update({ paused: true }); await f.update();
 assert.equal((await state(f, action)).retry_deadline_at, first.retry_deadline_at);
 f.clock.value = Date.parse("2026-09-12T00:00:00.000Z");
 assert.equal((await f.controls.inspect({ organization_id: f.org })).usage.attempts_used, 0);
 assert.equal((await f.executor.execute(action)).hold_reason, "RETRY_BUDGET_EXHAUSTED");
 assert.equal(await f.client.services.executionsRepository.countForAction(action.id), 1);
});
test("malformed saved controls fail closed and candidate selection remains safe", async t => {
 const f = await fixture(t), action = await f.action(), human = await f.action("CREATE_HUMAN_TASK"); await f.update();
 await f.client.db.run("UPDATE workspace_dispatch_controls SET updated_at = '2026-02-30T00:00:00.000Z' WHERE organization_id = ?", [f.org]);
 assert.equal((await f.executor.execute(action)).operations_hold, "DISPATCH_CONTROLS_INVALID");
 assert.equal((await f.controls.inspect({ organization_id: f.org })).policy_valid, false);
 assert.deepEqual(await candidateIds(f), [human.id]);
 assert.equal((await f.update()).policy_valid, true);
});
test("unresolved legacy actions consume one slot but accepted current evidence is not charged twice", async t => {
 const f = await fixture(t), action = await f.action();
 await f.client.db.run("UPDATE actions SET status = 'EXECUTING', execution_hold_reason = 'LEGACY_OUTCOME_REVIEW_REQUIRED' WHERE id = ?", [action.id]);
 let result = await f.controls.inspect({ organization_id: f.org }); assert.equal(result.usage.legacy_unresolved, 1);
 await f.client.db.run("UPDATE actions SET status = 'APPROVED', execution_hold_reason = NULL WHERE id = ?", [action.id]);
 await f.executor.execute(action); result = await f.controls.inspect({ organization_id: f.org });
 assert.equal(result.usage.legacy_unresolved, 0); assert.equal(result.usage.unresolved_used, 0);
});

test("dispatch configuration cannot default an omitted or invalid global enablement to true", () => {
 for (const globalEnabled of [undefined, null, "false", 1]) assert.throws(() => new DispatchControlsService({ db: {}, globalEnabled }), TypeError);
});
test("independent database connections preserve pause and cannot spend the last attempt twice", async t => {
 const databaseFile = join(tmpdir(), "relay-controls-" + randomUUID() + ".sqlite");
 const f = await fixture(t, databaseFile); let second;
 t.after(async () => { await second?.stop(); await f.client.stop(); await rm(databaseFile, { force: true }); });
 const firstAction = await f.action(), secondAction = await f.action(); await f.update({ paused: true, daily_attempt_limit: 1 });
 second = await startClient(t, databaseFile); second.services.actionExecutor.now = () => f.clock.value;
 second.services.actionExecutor.channelWorkflowService = null;
 let calls = 0; second.services.actionExecutor.adapter = { async invoke() { calls++; return ACCEPTED; } };
 assert.equal((await second.services.actionExecutor.execute(secondAction)).operations_hold, "WORKSPACE_DISPATCH_PAUSED");
 await f.update({ daily_attempt_limit: 1 });
 const results = await Promise.all([f.executor.execute(firstAction), second.services.actionExecutor.execute(secondAction)]);
 assert.equal(results.filter(r => r.dispatched).length, 1); assert.equal(f.calls() + calls, 1);
 assert.equal((await second.services.dispatchControlsService.inspect({ organization_id: f.org })).usage.attempts_used, 1);
});
test("a new UTC day replenishes workspace admission for new work while preserving earlier history", async t => {
 const f = await fixture(t), first = await f.action(), second = await f.action(); await f.update({ daily_attempt_limit: 1 });
 await f.executor.execute(first); const before = await state(f, first);
 assert.equal((await f.executor.execute(second)).operations_hold, "DAILY_DISPATCH_LIMIT");
 f.clock.value = Date.parse("2026-09-12T00:00:00.000Z");
 assert.equal((await candidateIds(f)).includes(second.id), true); assert.equal((await f.executor.execute(second)).dispatched, true);
 assert.deepEqual(await state(f, first), before);
});
test("fixed provider response issue survives acceptance without leaking untrusted body or reference", async t => {
 const f = await fixture(t), action = await f.action();
 f.executor.adapter = { async invoke() { return { ...ACCEPTED, provider_reference: "invalid\nreference", response_issue: "RESPONSE_TOO_LARGE" }; } };
 const result = await f.executor.execute(action); assert.equal(result.outcome_class, "ACCEPTED");
 assert.equal(result.execution.provider_reference, null); assert.equal(result.response_issue, "RESPONSE_TOO_LARGE");
 const audit = await f.client.db.get("SELECT metadata_json FROM audit_logs WHERE action_id = ? AND event_type = 'ActionStarted'", [action.id]);
 assert.equal(JSON.parse(audit.metadata_json).response_issue, "RESPONSE_TOO_LARGE");
 assert.doesNotMatch(audit.metadata_json, /invalid/);
});

test("an exact callback releases uncertainty without an operator decision or a duplicate send", async t => {
 const f = await fixture(t), first = await f.action(), second = await f.action(); await f.update({ unresolved_limit: 1 });
 f.executor.adapter = { async invoke() { return { ok: false, uncertain: true, retryable: false }; } };
 const result = await f.executor.execute(first);
 assert.equal((await f.executor.execute(second)).operations_hold, "UNRESOLVED_DISPATCH_LIMIT");
 await f.client.services.callbacksService.receiveExecutionCallback({ organization_id: f.org, action_id: first.id,
  action_execution_id: result.execution.id, revision_id: result.execution.action_revision_id,
  provider_event_id: "synthetic-controls-delivery", status: "COMPLETED" });
 assert.equal((await f.controls.inspect({ organization_id: f.org })).usage.unresolved_used, 0);
 assert.equal((await candidateIds(f)).includes(second.id), true);
 assert.equal((await state(f, first)).status, "COMPLETED");
 assert.equal(await f.client.services.executionsRepository.countForAction(first.id), 1);
});
test("completed legacy execution history never creates an unreleasable unresolved slot", async t => {
 const f = await fixture(t), action = await f.action();
 await f.client.services.executionsRepository.createExecution({ action_id: action.id, status: "COMPLETED", attempt: 1,
  provider: "historical", idempotency_key: "completed-history:" + action.id });
 await f.client.db.run("UPDATE actions SET status = 'EXECUTING', execution_hold_reason = 'LEGACY_OUTCOME_REVIEW_REQUIRED' WHERE id = ?", [action.id]);
 const result = await f.controls.inspect({ organization_id: f.org });
 assert.equal(result.usage.unresolved_used, 0); assert.equal(result.usage.legacy_unresolved, 0);
});
