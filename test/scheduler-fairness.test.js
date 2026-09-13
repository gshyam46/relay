import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDatabase, openDatabaseClient } from "../src/database/database.js";
import { SchedulerService, SCHEDULER_PHASES } from "../src/modules/events/schedulerService.js";
import { ExecutionsRepository } from "../src/modules/outbound-automation/executionsRepository.js";
import { PreparedActionService } from "../src/modules/outbound-automation/preparedActionService.js";
import { ContactPolicyService } from "../src/modules/contact-policy/contactPolicyService.js";
import { EventsRepository } from "../src/modules/events/eventsRepository.js";
import { LeadsRepository } from "../src/modules/data-foundation/leadsRepository.js";
import { ActionsRepository } from "../src/modules/outbound-automation/actionsRepository.js";
import { WorkflowsRepository } from "../src/modules/workflows/workflowsRepository.js";
import { FollowUpDueService } from "../src/modules/channels/followUpDueService.js";
import { FollowUpsRepository } from "../src/modules/channels/followUpsRepository.js";
import { WebhookInboxService } from "../src/modules/webhook-inbox/webhookInboxService.js";
import { connectTestAdmin, postgresTestContext, schemaDatabaseConfig, schemaFor } from "../scripts/helpers/testSafety.js";

const cleanups = new WeakMap();
function cleanup(t, fn) {
  if (!cleanups.has(t)) { const stack = []; cleanups.set(t, stack); t.after(async () => { for (const release of stack) await release(); }); }
  cleanups.get(t).unshift(fn);
}
const NOW = Date.parse("2026-09-11T12:00:00.000Z"), STAMP = new Date(NOW).toISOString();
const FUTURE = new Date(NOW + 3600000).toISOString();
async function fixture(t, db = null) {
  db ||= await createDatabase(":memory:"); cleanup(t, () => db.close());
  return { db, events: new EventsRepository(db), leads: new LeadsRepository(db), actions: new ActionsRepository(db),
    workflows: new WorkflowsRepository(db), followups: new FollowUpsRepository(db), inbox: new WebhookInboxService({ db, now: () => NOW }) };
}
async function org(f, id) { await f.db.run("INSERT INTO organizations (id,name,created_at) VALUES (?,?,?)", [id, id, STAMP]); return id; }
async function event(f, id) { return f.events.publish({ organization_id: id, type: "LeadCreated", payload: {} }); }
async function lead(f, id) { return f.leads.createLead({ organization_id: id, name: "Synthetic lead", email: id + "@example.test" }); }
function scheduler(f, overrides = {}) {
  return new SchedulerService({ db: f.db, now: () => NOW, monotonicNow: () => 0,
    handlers: Object.fromEntries(SCHEDULER_PHASES.map(({ phase }) => [phase, async () => ({})])), ...overrides });
}
const organizations = (tick) => tick.visits.map((visit) => visit.organization_id);
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
async function localFile(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lead-scheduler-fairness-"));
  cleanup(t, () => rm(directory, { recursive: true, force: true }));
  return path.join(directory, "disposable.sqlite");
}
async function receipt(f, organizationId) {
  return (await f.inbox.receive({ organization_id: organizationId, provider: "local", connection_key: "fixture", provider_event_id: organizationId,
    event_kind: "INBOUND_MESSAGE", verification_kind: "LOCAL_TEST", input: { text: "Synthetic reply" } })).row;
}
async function workflow(f, organizationId) {
  const l = await lead(f, organizationId);
  const campaign = await f.workflows.createCampaign({ organization_id: organizationId, name: "Synthetic campaign" });
  const sequence = await f.workflows.createSequence({ organization_id: organizationId, campaign_id: campaign.id, name: "Synthetic sequence",
    steps: [{ type: "SEND_EMAIL", channel: "EMAIL", title: "Review email", requires_approval: true }] });
  const run = await f.workflows.enrollLead({ organization_id: organizationId, campaign_id: campaign.id, sequence_id: sequence.id, lead_id: l.id,
    idempotency_key: organizationId, next_run_at: STAMP });
  return { l, campaign, sequence, run };
}

test("noisy tenant cannot hide others; cursor and distinct capped visits survive reopening the database", async (t) => {
  const file = await localFile(t), f = await fixture(t, await createDatabase(file));
  for (const id of ["a", "b", "c", "d", "e", "f"]) { await org(f, id); await event(f, id); }
  for (let index = 0; index < 60; index++) await event(f, "a");
  const first = await scheduler(f).runOnce();
  assert.deepEqual(organizations(first), ["a", "b", "c", "d"]);
  assert.equal(first.visits.every((visit) => visit.phases.length === 6), true);
  await f.db.close();
  const reopened = await fixture(t, await openDatabaseClient(file));
  assert.deepEqual(organizations(await scheduler(reopened).runOnce()), ["e", "f", "a", "b"]);
  assert.deepEqual(organizations(await scheduler(reopened).runOnce({ organization_id: "e" })), ["e"]);
});

test("each typed queue admits its workspace and dispatch expiry is not hidden by action status", async (t) => {
  const f = await fixture(t);
  for (const id of ["receipts", "events", "workflows", "followups", "dispatch", "expiry"]) await org(f, id);
  await receipt(f, "receipts"); await event(f, "events"); await workflow(f, "workflows");
  const fl = await lead(f, "followups");
  await f.followups.create({ organization_id: "followups", lead_id: fl.id, channel: "EMAIL", status: "PLANNED", due_at: STAMP, reason: "Review", idempotency_key: "due" });
  for (const id of ["dispatch", "expiry"]) {
    const l = await lead(f, id);
    const action = await f.actions.createAction({ organization_id: id, lead_id: l.id, type: "SEND_EMAIL", status: id === "expiry" ? "EXECUTING" : "APPROVED", idempotency_key: id });
    if (id === "expiry") await f.db.run("INSERT INTO action_executions (id,action_id,status,attempt,provider,idempotency_key,started_at,outcome_class,lease_expires_at) VALUES ('expired',?,'EXECUTING',1,'email-sandbox','expired',?,'DISPATCHING',?)", [action.id, STAMP, STAMP]);
  }
  const s = scheduler(f);
  for (const id of ["receipts", "events", "workflows", "followups", "dispatch", "expiry"]) {
    assert.deepEqual(organizations(await s.runOnce({ organization_id: id })), [id], id);
  }
  assert.deepEqual(organizations(await s.runOnce({ organization_id: "missing" })), []);
});

test("future queues, historical events and policy-held action-only work do not consume turns", async (t) => {
  const f = await fixture(t); await org(f, "quiet");
  const e = await event(f, "quiet"); await f.db.run("UPDATE domain_events SET next_attempt_at=? WHERE id=?", [FUTURE, e.id]);
  const w = await workflow(f, "quiet"); await f.db.run("UPDATE workflow_runs SET next_run_at=? WHERE id=?", [FUTURE, w.run.id]);
  const action = await f.actions.createAction({ organization_id: "quiet", lead_id: w.l.id, type: "SEND_EMAIL", idempotency_key: "future", scheduled_at: FUTURE });
  await f.followups.create({ organization_id: "quiet", lead_id: w.l.id, channel: "EMAIL", status: "PLANNED", due_at: FUTURE, reason: "Future", idempotency_key: "future" });
  const r = await receipt(f, "quiet");
  await f.db.run("UPDATE webhook_receipts SET processing_state='QUARANTINED',quarantined_reason='UNMATCHED_IDENTITY' WHERE id=?", [r.id]);
  assert.deepEqual(organizations(await scheduler(f).runOnce()), []);
  await f.db.run("UPDATE actions SET scheduled_at=NULL WHERE id=?", [action.id]);
  assert.deepEqual(organizations(await scheduler(f).runOnce()), [], "mandatory policy excludes action-only workspace");
  await f.db.run("UPDATE domain_events SET next_attempt_at=NULL,processing_version=0,processing_hold_reason='LEGACY_EVENT_REVIEW_REQUIRED' WHERE id=?", [e.id]);
  assert.deepEqual(organizations(await scheduler(f).runOnce()), [], "legacy event cannot introduce automatic work");
  await f.db.run("UPDATE webhook_receipts SET mandatory_policy_status='DONE' WHERE id=?", [r.id]);
  assert.deepEqual(organizations(await scheduler(f).runOnce()), ["quiet"]);
});

test("malformed event retry times are admitted for visible quarantine instead of disappearing", async (t) => {
  const f = await fixture(t); await org(f, "invalid"); const e = await event(f, "invalid");
  await f.db.run("UPDATE domain_events SET next_attempt_at='not-a-time' WHERE id=?", [e.id]);
  assert.deepEqual(organizations(await scheduler(f).runOnce()), ["invalid"]);
});

test("unchanged approval, accepted and uncertain waits are excluded; due workflow changes remain eligible", async (t) => {
  const f = await fixture(t); await org(f, "waiting"); const w = await workflow(f, "waiting");
  const action = await f.actions.createAction({ organization_id: "waiting", lead_id: w.l.id, type: "SEND_EMAIL", status: "AWAITING_APPROVAL",
    idempotency_key: "waiting", workflow_run_id: w.run.id, sequence_step_id: w.sequence.steps[0].id });
  await f.db.run("UPDATE workflow_runs SET status='WAITING_APPROVAL',last_action_id=?,next_run_at=NULL WHERE id=?", [action.id, w.run.id]);
  assert.deepEqual(organizations(await scheduler(f).runOnce()), []);
  const revision = await new ContactPolicyService(f.db).withWorkspacePolicyTransaction("waiting", tx => new PreparedActionService(tx).prepare(action));
  await f.db.run("UPDATE workflow_runs SET status='WAITING_EXECUTION' WHERE id=?", [w.run.id]);
  await f.db.run("UPDATE actions SET status='EXECUTING' WHERE id=?", [action.id]);
  assert.deepEqual(organizations(await scheduler(f).runOnce()), ["waiting"], "missing active execution is eligible for repair");
  const execution = await new ExecutionsRepository(f.db).createExecution({ action_id: action.id, status: "STARTED", attempt: 1,
    provider: "email-sandbox", provider_reference: "synthetic-accepted-message", idempotency_key: "waiting:attempt:1", started_at: STAMP,
    action_revision_id: revision.id, envelope_hash: revision.content_hash, provider_intent_key: "relay-action-" + action.id + "-revision-" + revision.id,
    fence_token: 1, lease_owner: "synthetic-dispatch", lease_expires_at: FUTURE, dispatch_authorized_at: STAMP, outcome_class: "ACCEPTED", outcome_at: STAMP });
  await f.db.run("UPDATE actions SET active_execution_id=?,execution_fence=1 WHERE id=?", [execution.id, action.id]);
  for (const outcome of ["ACCEPTED", "UNCERTAIN"]) {
    await f.db.run("UPDATE action_executions SET outcome_class=? WHERE id=?", [outcome, execution.id]);
    await f.db.run("UPDATE actions SET execution_hold_reason=? WHERE id=?", [outcome === "UNCERTAIN" ? "PROVIDER_OUTCOME_UNCERTAIN" : null, action.id]);
    assert.deepEqual(organizations(await scheduler(f).runOnce()), [], outcome);
  }
  await f.db.run("UPDATE action_executions SET status='COMPLETED',outcome_class='DELIVERED',completed_at=? WHERE id=?", [STAMP, execution.id]);
  await f.db.run("UPDATE actions SET status='COMPLETED',execution_hold_reason=NULL WHERE id=?", [action.id]);
  assert.deepEqual(organizations(await scheduler(f).runOnce()), ["waiting"]);
  await f.db.run("UPDATE actions SET status='APPROVED' WHERE id=?", [action.id]);
  await f.db.run("UPDATE workflow_runs SET paused_at=? WHERE id=?", [STAMP, w.run.id]);
  assert.deepEqual(organizations(await scheduler(f).runOnce()), [], "paused linked action and workflow excluded together");
});

test("phase caps, scope and compatibility result arrays are fixed and handlers run outside transactions", async (t) => {
  const f = await fixture(t); await org(f, "bounded"); await event(f, "bounded");
  const calls = [];
  const handlers = Object.fromEntries(SCHEDULER_PHASES.map(({ phase }) => [phase, async (input) => {
    assert.notEqual(f.db.transactionBound, true); calls.push([phase, input]);
    assert.ok((await f.db.get("SELECT next_phase FROM scheduler_workspaces WHERE organization_id='bounded'")).next_phase >= 0);
    return phase === "EVENTS" ? { processed_events: [{ id: "event" }] } : phase === "DISPATCH" ? { executed_actions: [{ id: "action" }] } : {};
  }]));
  const result = await scheduler(f, { handlers }).runOnce();
  assert.deepEqual(calls.map(([phase, input]) => [phase, input.limit]), SCHEDULER_PHASES.map(({ phase, limit }) => [phase, limit]));
  assert.equal(calls.every(([, input]) => input.organization_id === "bounded" && input.due_at === STAMP), true);
  assert.deepEqual(result.processed_events, [{ id: "event" }]); assert.deepEqual(result.executed_actions, [{ id: "action" }]);
});

test("slow phase stops admission and its persisted successor starts the next visit after restart", async (t) => {
  const f = await fixture(t); await org(f, "slow"); await event(f, "slow");
  let elapsed = 0;
  const s = scheduler(f, { monotonicNow: () => elapsed });
  s.handlers.RECEIPTS = async () => { elapsed = 10001; return {}; };
  assert.deepEqual((await s.runOnce()).visits[0].phases.map((p) => p.phase), ["RECEIPTS"]);
  assert.equal((await f.db.get("SELECT next_phase FROM scheduler_workspaces WHERE organization_id='slow'")).next_phase, 1);
  const restarted = scheduler(f);
  assert.equal((await restarted.runOnce()).visits[0].phases[0].phase, "EVENTS");
});

test("admission deadline reached while acquiring the cursor does not advance it", async (t) => {
  const f = await fixture(t); await org(f, "late"); await event(f, "late");
  let elapsed = 0;
  const db = { kind: f.db.kind, transaction: (work, options) => f.db.transaction(async (tx) => {
    elapsed = 10001; return work(tx);
  }, options) };
  const result = await scheduler(f, { db, monotonicNow: () => elapsed }).runOnce();
  assert.deepEqual(result.visits, []);
  assert.equal((await f.db.get("SELECT last_organization_id FROM scheduler_state")).last_organization_id, null);
  assert.equal((await f.db.get("SELECT COUNT(*) AS n FROM scheduler_workspaces")).n, 0);
});

test("two connections reserve different live workspaces and shutdown drains only admitted work", async (t) => {
  const file = await localFile(t), f = await fixture(t, await createDatabase(file));
  const second = await fixture(t, await openDatabaseClient(file));
  for (const id of ["a", "b"]) { await org(f, id); await event(f, id); }
  const entered = deferred(), finish = deferred();
  const first = scheduler(f, { policy: { maxVisits: 1 } });
  first.handlers.RECEIPTS = async () => { entered.resolve(); await finish.promise; return {}; };
  const running = first.runOnce(); await entered.promise;
  assert.deepEqual(organizations(await scheduler(second, { policy: { maxVisits: 1 } }).runOnce()), ["b"]);
  first.stopAccepting(); let drained = false; const draining = first.drain().then(() => { drained = true; });
  await Promise.resolve(); assert.equal(drained, false); finish.resolve();
  const result = await running; await draining;
  assert.equal(result.visits[0].phases.length, 1); assert.equal(result.draining, true);
  assert.deepEqual((await first.runOnce()).visits, []);
  assert.equal((await f.db.get("SELECT lease_owner FROM scheduler_workspaces WHERE organization_id='a'")).lease_owner, null);
});

test("expired old visit cannot start another phase or clear the newer visit lease", async (t) => {
  const f = await fixture(t); await org(f, "a"); await event(f, "a");
  let clock = NOW;
  const oldEntered = deferred(), oldFinish = deferred(), newEntered = deferred(), newFinish = deferred();
  const first = scheduler(f, { now: () => clock });
  first.handlers.RECEIPTS = async () => { oldEntered.resolve(); await oldFinish.promise; return {}; };
  const oldRunning = first.runOnce(); await oldEntered.promise;
  clock += 120001;
  const newer = scheduler(f, { now: () => clock });
  newer.handlers.EVENTS = async () => { newEntered.resolve(); await newFinish.promise; return {}; };
  const newRunning = newer.runOnce(); await newEntered.promise;
  const live = await f.db.get("SELECT * FROM scheduler_workspaces WHERE organization_id='a'"); assert.equal(live.visit_fence, 2);
  oldFinish.resolve(); const oldResult = await oldRunning;
  assert.equal(oldResult.visits[0].phases.length, 1);
  assert.equal((await f.db.get("SELECT lease_owner FROM scheduler_workspaces WHERE organization_id='a'")).lease_owner, live.lease_owner);
  newFinish.resolve(); await newRunning;
});

test("deleted cursor and newly added lower IDs wrap without enumerating organizations", async (t) => {
  const f = await fixture(t); await org(f, "z"); await event(f, "z");
  await scheduler(f).runOnce();
  await f.db.run("DELETE FROM domain_events WHERE organization_id='z'");
  await f.db.run("DELETE FROM scheduler_workspaces WHERE organization_id='z'");
  await f.db.run("DELETE FROM organizations WHERE id='z'");
  await org(f, "a"); await event(f, "a");
  assert.deepEqual(organizations(await scheduler(f).runOnce()), ["a"]);
});

test("phase failure is sanitized and later bounded phases remain available", async (t) => {
  const f = await fixture(t); await org(f, "safe"); await event(f, "safe");
  const s = scheduler(f); s.handlers.EVENTS = async () => { throw Object.assign(new Error("secret-provider-url"), { code: "secret-db-text" }); };
  const result = await s.runOnce();
  assert.equal(result.visits[0].phases.length, 6);
  assert.equal(result.visits[0].phases[1].error_code, "SCHEDULER_PHASE_FAILED");
  assert.equal(JSON.stringify(result).includes("secret"), false);
});


test("malformed follow-up dates get one visible blocked outcome and stop consuming visits", async (t) => {
  const f = await fixture(t); await org(f, "invalid-followup"); const l = await lead(f, "invalid-followup");
  const task = await f.followups.create({ organization_id: "invalid-followup", lead_id: l.id, channel: "EMAIL", status: "PLANNED", due_at: "z-invalid-date", reason: "Synthetic follow-up", idempotency_key: "invalid-date" });
  const s = scheduler(f); const due = new FollowUpDueService({ db: f.db, now: () => NOW });
  s.handlers.FOLLOW_UPS = (command) => due.processDue(command);
  const result = await s.runOnce(); assert.deepEqual(organizations(result), ["invalid-followup"]);
  assert.equal(result.due_follow_ups[0].status, "BLOCKED");
  assert.equal((await f.db.get("SELECT status FROM follow_up_tasks WHERE id=?", [task.id])).status, "BLOCKED");
  assert.deepEqual(organizations(await s.runOnce()), []);
});

test("expired and conflicting receipts remain recoverable without admitting foreign or future queues", async (t) => {
  const f = await fixture(t);
  for (const id of ["expired", "conflict", "foreign"]) { await org(f, id); await receipt(f, id); }
  await f.db.run("UPDATE webhook_receipts SET processing_state='PROCESSING',lease_expires_at=? WHERE organization_id='expired'", [FUTURE]);
  await f.db.run("UPDATE webhook_receipts SET processing_state='QUARANTINED',quarantined_reason='RECEIPT_IDENTITY_CONFLICT',next_attempt_at=? WHERE organization_id='conflict'", [FUTURE]);
  assert.deepEqual(organizations(await scheduler(f).runOnce({ organization_id: "expired" })), []);
  assert.deepEqual(organizations(await scheduler(f).runOnce({ organization_id: "conflict" })), []);
  await f.db.run("UPDATE webhook_receipts SET lease_expires_at=? WHERE organization_id='expired'", [STAMP]);
  await f.db.run("UPDATE webhook_receipts SET next_attempt_at=? WHERE organization_id='conflict'", [STAMP]);
  assert.deepEqual(organizations(await scheduler(f).runOnce({ organization_id: "expired" })), ["expired"]);
  assert.deepEqual(organizations(await scheduler(f).runOnce({ organization_id: "conflict" })), ["conflict"]);
});

const context = postgresTestContext();
test("postgres scheduler preserves cross-connection visit exclusion and cursor wrap", { skip: context ? false : "Requires explicit disposable PostgreSQL runner" }, async (t) => {
  const schema = schemaFor(context.runId, "adapter");
  const admin = await connectTestAdmin(context);
  try { await admin.exec('CREATE SCHEMA "' + schema + '"'); } finally { await admin.close(); }
  cleanup(t, async () => { const cleanup = await connectTestAdmin(context); try { await cleanup.exec('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'); } finally { await cleanup.close(); } });
  const config = schemaDatabaseConfig(context, schema), f = await fixture(t, await createDatabase(config));
  const second = await fixture(t, await openDatabaseClient(config));
  for (const id of ["a", "b"]) { await org(f, id); await event(f, id); }
  const entered = deferred(), finish = deferred(), first = scheduler(f, { policy: { maxVisits: 1 } });
  first.handlers.RECEIPTS = async () => { entered.resolve(); await finish.promise; return {}; };
  const running = first.runOnce(); await entered.promise;
  try { assert.deepEqual(organizations(await scheduler(second, { policy: { maxVisits: 1 } }).runOnce()), ["b"]); }
  finally { finish.resolve(); await running; }
  assert.deepEqual(organizations(await scheduler(second, { policy: { maxVisits: 1 } }).runOnce()), ["a"]);
});
