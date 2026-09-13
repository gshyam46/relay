import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";
import { WorkflowsService } from "../src/modules/workflows/workflowsService.js";
import { WorkflowsRepository } from "../src/modules/workflows/workflowsRepository.js";
import { scheduleInstant } from "../src/modules/workflows/workflowContract.js";

async function fixture(t, steps = [{ type: "SEND_EMAIL", title: "Introduction", body: "A specific message", requires_approval: false, delay_hours: 1 }]) {
  const client = await startClient(t);
  const { organization, user } = await client.register("Managed workflow");
  const { lead } = await client.post("/api/leads", { name: "Customer", email: "customer@example.com" });
  let clock = Date.now();
  client.services.actionExecutor.now = () => clock;
  client.services.callbacksService.now = () => clock;
  client.services.webhookInbox.now = () => clock;
  const workflows = client.services.workflowsService;
  const { campaign } = await workflows.createCampaign({ organization_id: organization.id, name: "Customer follow-up" });
  const { sequence } = await workflows.createSequence({ organization_id: organization.id, campaign_id: campaign.id, name: "Useful introduction", steps });
  const scope = { organization_id: organization.id };
  const enroll = async (patch = {}) => (await workflows.enrollLeads({ ...scope, sequence_id: sequence.id, lead_ids: [lead.id], ...patch })).workflow_runs[0];
  const due = (patch = {}) => workflows.runDue({ ...scope, ...patch });
  const storedRun = id => client.services.workflowsRepository.getRunForOrganization(id, organization.id);
  const actionFor = async run => client.services.actionsRepository.getAction((await storedRun(run.id)).last_action_id);
  const control = (run, command, patch = {}) => workflows.controlRun({ ...scope, run_id: run.id, expected_revision: Number(run.revision),
    command, reason: "Owner scheduling decision", actor: user.id, ...patch });
  const complete = async action => {
    const current = await client.services.actionsRepository.getAction(action.id);
    const execution = await client.services.executionsRepository.getExecution(current.active_execution_id);
    return client.services.callbacksService.receiveExecutionCallback({ ...scope, action_id: action.id, action_execution_id: execution.id,
      revision_id: execution.action_revision_id, provider: execution.provider, provider_event_id: "delivery:" + execution.id, status: "COMPLETED" });
  };
  return { ...client, organization, user, lead, campaign, sequence, workflows, scope, enroll, due, storedRun, actionFor, control, complete,
    time: () => clock, setTime: value => { clock = value; }, advance: ms => { clock += ms; } };
}

test("managed future enrollment and overdue WAIT use persisted anchor rather than tick time", async t => {
  const f = await fixture(t, [{ type: "WAIT", delay_hours: 1 }, { type: "CREATE_HUMAN_TASK", title: "Review customer" }]);
  const start = f.time() + 3600000;
  const run = await f.enroll({ scheduled_at: new Date(start).toISOString() });
  assert.equal(run.processing_version, 1);
  assert.equal((await f.due()).processed_runs.length, 0);
  f.setTime(start + 7200000);
  const first = (await f.due()).processed_runs[0];
  assert.equal(first.next_run_at, new Date(start + 3600000).toISOString());
  assert.equal(first.step_anchor_at, first.next_run_at);
  assert.equal((await f.due()).processed_runs[0].status, "WAITING_EXECUTION");
  assert.equal((await f.db.all("SELECT * FROM action_executions")).length, 0);
});

test("all sequence SEND steps require exact review and no workflow transition invokes a provider", async t => {
  const f = await fixture(t);
  let calls = 0;
  f.services.actionExecutor.adapter = { invoke: async () => { calls++; return { ok: true, provider: "mock" }; } };
  const run = await f.enroll();
  assert.equal((await f.due()).processed_runs[0].status, "WAITING_APPROVAL");
  const action = await f.actionFor(run);
  assert.equal(action.approval_requirement, "REQUIRED");
  assert.equal(action.workflow_run_id, run.id);
  assert.equal(action.sequence_step_id, f.sequence.steps[0].id);
  assert.equal((await f.db.all("SELECT * FROM action_approvals WHERE action_id = ?", [action.id])).length, 1);
  await f.approve(action.id);
  assert.equal((await f.due()).processed_runs[0].status, "WAITING_EXECUTION");
  assert.equal((await f.due()).processed_runs.length, 0);
  assert.equal(calls, 0);
  assert.equal((await f.db.all("SELECT * FROM action_executions")).length, 0);
});

test("accepted and uncertain execution cannot advance; exact delivery anchors post-step delay", async t => {
  const f = await fixture(t);
  const run = await f.enroll(); await f.due();
  const action = await f.actionFor(run); await f.approve(action.id); await f.due();
  await f.services.actionExecutor.execute(action);
  assert.equal((await f.due()).processed_runs.length, 0);
  const executing = await f.services.actionsRepository.getAction(action.id);
  await f.db.run("UPDATE action_executions SET outcome_class = 'UNCERTAIN' WHERE id = ?", [executing.active_execution_id]);
  await f.db.run("UPDATE actions SET execution_hold_reason = 'PROVIDER_OUTCOME_UNCERTAIN' WHERE id = ?", [action.id]);
  f.advance(30000); await f.complete(action);
  const completedAt = f.time(); f.advance(7200000);
  const advanced = (await f.due()).processed_runs[0];
  assert.equal(advanced.current_step_order, 2);
  assert.equal(advanced.next_run_at, new Date(completedAt + 3600000).toISOString());
  assert.equal((await f.due()).processed_runs[0].status, "COMPLETED");
  assert.equal((await f.db.all("SELECT * FROM action_executions WHERE action_id = ?", [action.id])).length, 1);
});

test("human task acceptance is not completion", async t => {
  const f = await fixture(t, [{ type: "CREATE_HUMAN_TASK", title: "Call customer personally" }]);
  const run = await f.enroll(); await f.due();
  const action = await f.actionFor(run);
  await f.services.actionExecutor.execute(action);
  assert.equal((await f.due()).processed_runs.length, 0);
  assert.equal((await f.storedRun(run.id)).status, "WAITING_EXECUTION");
  assert.equal((await f.storedRun(run.id)).current_step_order, 1);
});

test("pause preserves approved revision and schedule, defers dispatch without attempts, resume can send", async t => {
  const f = await fixture(t); const run = await f.enroll(); await f.due();
  const action = await f.actionFor(run); await f.approve(action.id);
  const approved = await f.services.actionsRepository.getAction(action.id);
  const paused = (await f.control(await f.storedRun(run.id), "PAUSE")).workflow_run;
  const result = await f.services.actionExecutor.execute(action);
  assert.equal(result.deferred, true); assert.equal(result.workflow_paused, true);
  assert.equal((await f.services.actionsRepository.nextExecutable(1, f.organization.id, new Date(f.time()).toISOString())).length, 0);
  assert.equal((await f.due()).processed_runs.length, 0);
  assert.equal((await f.db.all("SELECT * FROM action_executions")).length, 0);
  f.advance(3600000);
  const resumed = (await f.control(paused, "RESUME")).workflow_run;
  assert.equal(resumed.step_anchor_at, run.step_anchor_at);
  assert.equal((await f.services.actionsRepository.getAction(action.id)).current_revision_id, approved.current_revision_id);
  assert.equal((await f.services.actionExecutor.execute(action)).dispatched, true);
});

test("stale control, foreign tenant and terminal resume fail without changing state", async t => {
  const f = await fixture(t); const run = await f.enroll();
  const paused = (await f.control(run, "PAUSE")).workflow_run;
  await assert.rejects(f.control(run, "STOP"), { code: "WORKFLOW_REVISION_STALE" });
  const other = await f.register("Another workspace");
  await assert.rejects(f.control(paused, "STOP", { organization_id: other.organization.id }), { statusCode: 404 });
  const stopped = (await f.control(paused, "STOP")).workflow_run;
  await assert.rejects(f.control(stopped, "RESUME"), { code: "WORKFLOW_TERMINAL" });
  assert.equal((await f.storedRun(run.id)).status, "STOPPED");
});

test("STOP and canonical reply cancel queued reviewed actions but preserve started execution", async t => {
  const f = await fixture(t); const run = await f.enroll(); await f.due();
  const action = await f.actionFor(run); await f.approve(action.id);
  await f.services.workflowsService.stopOpenRunsForLead({ ...f.scope, lead_id: f.lead.id, reason: "Lead replied positively." });
  assert.equal((await f.services.actionsRepository.getAction(action.id)).status, "BLOCKED");
  assert.equal((await f.services.actionExecutor.execute(action)).dispatched, undefined);
  assert.equal((await f.storedRun(run.id)).status, "STOPPED");
  assert.equal((await f.db.all("SELECT * FROM action_executions")).length, 0);
});

test("pause or stop after dispatch authorization cannot erase the in-flight result", async t => {
  const f = await fixture(t); const run = await f.enroll(); await f.due();
  const action = await f.actionFor(run); await f.approve(action.id);
  let started, release;
  const admitted = new Promise(resolve => { started = resolve; });
  const finish = new Promise(resolve => { release = resolve; });
  f.services.actionExecutor.adapter = { invoke: async () => { started(); await finish; return { ok: true, provider: "mock" }; } };
  const sending = f.services.actionExecutor.execute(action); await admitted;
  await f.control(await f.storedRun(run.id), "STOP"); release(); await sending;
  await f.complete(action);
  assert.equal((await f.services.actionsRepository.getAction(action.id)).status, "COMPLETED");
  assert.equal((await f.storedRun(run.id)).status, "STOPPED");
  assert.equal((await f.due()).processed_runs.length, 0);
});

test("simultaneous runner calls materialize one linked action and one pending approval", async t => {
  const f = await fixture(t); const run = await f.enroll();
  const other = new WorkflowsService({ workflowsRepository: new WorkflowsRepository(f.db), now: f.time });
  await Promise.all([f.due(), other.runDue(f.scope)]);
  assert.equal((await f.db.all("SELECT * FROM actions WHERE workflow_run_id = ?", [run.id])).length, 1);
  assert.equal((await f.db.all("SELECT * FROM action_approvals")).length, 1);
  assert.equal((await f.storedRun(run.id)).revision, 1);
});

test("materialization audit failure rolls back action, approval and run cursor together", async t => {
  const f = await fixture(t); const run = await f.enroll();
  const policy = f.workflows.contactPolicyService;
  const originalTransaction = policy.withWorkspacePolicyTransaction.bind(policy);
  policy.withWorkspacePolicyTransaction = (org, work) => originalTransaction(org, async tx => {
    const originalRun = tx.run.bind(tx);
    tx.run = (sql, params = []) => {
      if (sql.includes("INSERT INTO audit_logs") && params.includes("WorkflowAdvanced")) throw new Error("injected");
      return originalRun(sql, params);
    };
    try { return await work(tx); } finally { tx.run = originalRun; }
  });
  await assert.rejects(f.due(), /injected/);
  assert.equal((await f.db.all("SELECT * FROM actions WHERE workflow_run_id = ?", [run.id])).length, 0);
  assert.equal((await f.db.all("SELECT * FROM action_approvals")).length, 0);
  assert.equal((await f.storedRun(run.id)).revision, 0);
  policy.withWorkspacePolicyTransaction = originalTransaction; await f.due();
  assert.equal((await f.storedRun(run.id)).revision, 1);
});

test("unchanged approval waits cannot hide later due runs at limit one", async t => {
  const f = await fixture(t); await f.enroll(); await f.due();
  const { lead } = await f.post("/api/leads", { name: "Second customer", email: "second@example.com" });
  const next = await f.enroll({ lead_ids: [lead.id] });
  const result = await f.due({ limit: 1 });
  assert.equal(result.processed_runs.length, 1);
  assert.equal(result.processed_runs[0].id, next.id);
});

test("legacy, missing and foreign workflow action links cannot authorize a send", async t => {
  const f = await fixture(t); const run = await f.enroll(); await f.due();
  const action = await f.actionFor(run); await f.approve(action.id);
  await f.db.run("UPDATE actions SET workflow_run_id = NULL, sequence_step_id = NULL WHERE id = ?", [action.id]);
  const result = await f.services.actionExecutor.execute(action);
  assert.equal(result.status, "BLOCKED");
  assert.equal((await f.services.actionsRepository.getAction(action.id)).execution_hold_reason, "LEGACY_WORKFLOW_REVIEW_REQUIRED");
  assert.equal((await f.db.all("SELECT * FROM action_executions")).length, 0);
  const changed = (await f.due()).processed_runs[0];
  assert.equal(changed.status, "BLOCKED");
  assert.equal(changed.stop_reason, "WORKFLOW_ACTION_LINK_INVALID");
});

test("coarse COMPLETED without exact delivered attempt blocks instead of skipping the step", async t => {
  const f = await fixture(t); const run = await f.enroll(); await f.due();
  const action = await f.actionFor(run);
  await f.db.run("UPDATE actions SET status = 'COMPLETED' WHERE id = ?", [action.id]);
  const result = (await f.due()).processed_runs[0];
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.current_step_order, 1);
  assert.equal(result.stop_reason, "WORKFLOW_COMPLETION_UNCONFIRMED");
});

test("invalid schedule inputs reject atomically, explicit offsets normalize and old held runs cannot resume", async t => {
  const f = await fixture(t);
  for (const scheduled_at of ["2026-09-11T09:30", "2026-02-30T09:30:00Z", "tomorrow"]) {
    await assert.rejects(f.enroll({ scheduled_at }), { code: "INVALID_SCHEDULE_TIME" });
  }
  assert.equal((await f.db.all("SELECT * FROM workflow_runs")).length, 0);
  assert.equal(scheduleInstant("2026-09-11T15:00:00+05:30"), "2026-09-11T09:30:00.000Z");
  const run = await f.enroll();
  await f.db.run("UPDATE workflow_runs SET processing_version = 0, scheduler_hold_reason = 'LEGACY_SCHEDULE_REVIEW_REQUIRED', paused_at = ? WHERE id = ?", [new Date(f.time()).toISOString(), run.id]);
  assert.equal((await f.due()).processed_runs.length, 0);
  await assert.rejects(f.control(await f.storedRun(run.id), "RESUME"), { code: "WORKFLOW_HELD" });
});


test("inactive parent dispatch is guarded, and paused actions cannot starve later ready work", async t => {
  const f = await fixture(t); const run = await f.enroll(); await f.due();
  const action = await f.actionFor(run); await f.approve(action.id);
  await f.db.run("UPDATE sequences SET status = 'PAUSED' WHERE id = ?", [f.sequence.id]);
  const ready = await f.services.actionsRepository.createAction({ ...f.scope, lead_id: f.lead.id, type: "CREATE_HUMAN_TASK",
    idempotency_key: "independent-human-task", payload: { title: "Review reply" } });
  const candidates = await f.services.actionsRepository.nextExecutable(1, f.organization.id, new Date(f.time()).toISOString());
  assert.equal(candidates[0].id, ready.id);
  assert.equal((await f.services.actionExecutor.execute(action)).deferred, true);
  await f.db.run("UPDATE sequences SET status = 'ARCHIVED' WHERE id = ?", [f.sequence.id]);
  assert.equal((await f.services.actionExecutor.execute(action)).status, "BLOCKED");
  assert.equal((await f.db.all("SELECT * FROM action_executions WHERE action_id = ?", [action.id])).length, 0);
});

test("foreign typed step cannot be created or dispatched even when its foreign key exists", async t => {
  const f = await fixture(t); const run = await f.enroll(); await f.due();
  const action = await f.actionFor(run); await f.approve(action.id);
  const other = await f.register("Other workflow owner");
  const { campaign } = await f.workflows.createCampaign({ organization_id: other.organization.id, name: "Other campaign" });
  const { sequence } = await f.workflows.createSequence({ organization_id: other.organization.id, campaign_id: campaign.id,
    name: "Other sequence", steps: [{ type: "SEND_EMAIL", title: "Other copy", body: "Different message" }] });
  await assert.rejects(f.services.actionsRepository.createAction({ ...f.scope, lead_id: f.lead.id, type: "SEND_EMAIL",
    workflow_run_id: run.id, sequence_step_id: sequence.steps[0].id, idempotency_key: "foreign-linked-work" }), /do not match/);
  await f.db.run("UPDATE actions SET sequence_step_id = ? WHERE id = ?", [sequence.steps[0].id, action.id]);
  assert.equal((await f.services.actionExecutor.execute(action)).status, "BLOCKED");
  assert.equal((await f.db.all("SELECT * FROM action_executions")).length, 0);
});

test("malformed execution and schedule links are visible blocked outcomes", async t => {
  const f = await fixture(t); const run = await f.enroll(); await f.due();
  const action = await f.actionFor(run);
  await f.db.run("UPDATE workflow_runs SET status = 'WAITING_EXECUTION' WHERE id = ?", [run.id]);
  await f.db.run("UPDATE actions SET status = 'EXECUTING' WHERE id = ?", [action.id]);
  assert.equal((await f.due()).processed_runs[0].stop_reason, "WORKFLOW_EXECUTION_LINK_INVALID");
  const { lead } = await f.post("/api/leads", { name: "Broken schedule", email: "broken-time@example.com" });
  const invalid = await f.enroll({ lead_ids: [lead.id] });
  await f.db.run("UPDATE workflow_runs SET next_run_at = '9999-99-99T00:00:00.000Z' WHERE id = ?", [invalid.id]);
  assert.equal((await f.due()).processed_runs[0].stop_reason, "INVALID_WORKFLOW_TIME");
});

test("new sequence definitions cannot bypass fixed reply stops or create unsupported steps", async t => {
  const f = await fixture(t);
  for (const patch of [{ stop_on_reply: false }, { steps: [{ type: "SEND_EMAIL", stop_on_reply: false }] },
    { steps: [null] }, { steps: [{ type: "UPDATE_CRM" }] }, { steps: [{ type: "WAIT", delay_hours: 8761 }] }]) {
    await assert.rejects(f.workflows.createSequence({ ...f.scope, campaign_id: f.campaign.id, name: "Invalid sequence",
      steps: [{ type: "SEND_EMAIL" }], ...patch }), { statusCode: 400 });
  }
  assert.equal((await f.db.all("SELECT * FROM sequences WHERE organization_id = ?", [f.organization.id])).length, 1);
});

test("normal owner APIs schedule and control runs with session scope and revision checks", async t => {
  const f = await fixture(t);
  const scheduled = new Date(f.time() + 3600000).toISOString();
  const { workflow_runs } = await f.post("/api/sequences/" + f.sequence.id + "/enroll", { lead_ids: [f.lead.id], scheduled_at: scheduled });
  const run = workflow_runs[0]; assert.equal(run.next_run_at, scheduled);
  const paused = await f.post("/api/workflow-runs/" + run.id + "/control", { expected_revision: run.revision,
    command: "PAUSE", reason: "Review tomorrow", actor: "forged-user" });
  assert.ok(paused.workflow_run.paused_at);
  const audit = await f.db.get("SELECT * FROM audit_logs WHERE event_type = 'WorkflowControlled' AND organization_id = ?", [f.organization.id]);
  assert.equal(JSON.parse(audit.metadata_json).actor, f.user.id);
  const stale = await f.rawFetch("/api/workflow-runs/" + run.id + "/control", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ expected_revision: run.revision, command: "STOP", reason: "Stale decision" }) });
  assert.equal(stale.status, 409);
  const resumed = await f.post("/api/workflow-runs/" + run.id + "/control", { expected_revision: paused.workflow_run.revision,
    command: "RESUME", reason: "Ready for scheduled time" });
  assert.equal(resumed.workflow_run.next_run_at, scheduled);
  assert.equal(resumed.workflow_run.paused_at, null);
});
