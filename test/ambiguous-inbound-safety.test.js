import test from "node:test";
import assert from "node:assert/strict";
import { WebhookInboxService } from "../src/modules/webhook-inbox/webhookInboxService.js";
import { InboundMessageService } from "../src/modules/channels/inboundMessageService.js";
import { callbackFixture } from "./helpers/callbackFixture.js";
import { WorkflowsRepository } from "../src/modules/workflows/workflowsRepository.js";
import { ActionsRepository } from "../src/modules/outbound-automation/actionsRepository.js";
import { FollowUpsRepository } from "../src/modules/channels/followUpsRepository.js";
import { AMBIGUOUS_REPLY_LIMIT } from "../src/modules/channels/ambiguousInboundSafety.js";

let next = 0;
async function work(f, lead = f.lead) {
  const repo = new WorkflowsRepository(f.db), org = lead.organization_id, key = "ambiguity-" + (++next);
  const campaign = await repo.createCampaign({ organization_id: org, name: key });
  const sequence = await repo.createSequence({ organization_id: org, campaign_id: campaign.id, name: key,
    steps: [{ type: "SEND_EMAIL", channel: "EMAIL", requires_approval: true }] });
  const run = await repo.enrollLead({ organization_id: org, campaign_id: campaign.id, sequence_id: sequence.id, lead_id: lead.id, idempotency_key: key });
  const action = await new ActionsRepository(f.db).createAction({ organization_id: org, lead_id: lead.id, type: "SEND_EMAIL", status: "APPROVED", idempotency_key: key,
    workflow_run_id: run.id, sequence_step_id: sequence.steps[0].id, payload: { subject: "Synthetic question", body: "Would this be useful?", workflow_run_id: run.id } });
  await f.db.run("UPDATE workflow_runs SET status='WAITING_EXECUTION',last_action_id=? WHERE id=?", [action.id, run.id]);
  const tasks = new FollowUpsRepository(f.db);
  const automatic = await tasks.create({ organization_id: org, lead_id: lead.id, action_id: action.id, channel: "EMAIL", status: "PLANNED", due_at: new Date(f.now() + 3600000).toISOString(), reason: "Follow up if no response is received.", idempotency_key: "action:" + action.id + ":no-response-follow-up:v1" });
  const human = await tasks.create({ organization_id: org, lead_id: lead.id, channel: "HUMAN_TASK", status: "DUE", due_at: new Date(f.now()).toISOString(), reason: "Explicit operator task", idempotency_key: key + ":human" });
  return { run, action, automatic, human };
}
const row = (f, table, id) => f.db.get("SELECT * FROM " + table + " WHERE id=?", [id]);
const count = async (f, table, where = "") => Number((await f.db.get("SELECT count(*) n FROM " + table + (where ? " WHERE " + where : ""))).n);
const receive = (f, text = "Can you explain the options?") => f.inbound({ lead_id: null, contact: { email: f.lead.email }, payload: { text } });
const callback = (f, action, execution) => f.callbacksService.receiveExecutionCallback({ organization_id: action.organization_id, action_id: action.id,
  action_execution_id: execution.id, revision_id: execution.action_revision_id, provider: execution.provider, provider_event_id: "ambiguous-callback-" + execution.id, status: "COMPLETED" });
async function ownerRetry(f, receipt) {
  await f.db.run("INSERT INTO users(id,organization_id,name,email,role,created_at) VALUES (?,?,?,?,'OWNER',?) ON CONFLICT(id) DO NOTHING", ["ambiguity-owner", f.organization.id, "Synthetic owner", "owner@example.test", new Date(f.now()).toISOString()]);
  await f.webhookInbox.review({ organization_id: f.organization.id, receipt_id: receipt.id, expected_fence: receipt.processing_fence, decision: "RETRY", evidence_note: "Inspected ambiguous source", reviewer_user_id: "ambiguity-owner" });
  return f.webhookInbox.processDue({ organization_id: f.organization.id });
}

test("ambiguous ordinary reply stops directly matching automation while preserving human, unrelated and in-flight work", async t => {
  const f = await callbackFixture(t), duplicate = await f.createLead(f.lead.email);
  const a = await work(f), b = await work(f, duplicate), unrelated = await work(f, await f.createLead("unrelated@example.test"));
  const foreign = await work(f, await f.createLead(f.lead.email, f.otherOrganization.id));
  const flight = await f.createAction(), attempt = await f.createAttempt(flight);
  await assert.rejects(receive(f), { statusCode: 409 });
  for (const item of [a, b]) {
    assert.equal((await row(f, "workflow_runs", item.run.id)).status, "STOPPED");
    assert.equal((await row(f, "actions", item.action.id)).status, "BLOCKED");
    assert.equal((await row(f, "follow_up_tasks", item.automatic.id)).status, "CANCELLED");
    assert.equal((await row(f, "follow_up_tasks", item.human.id)).status, "DUE");
  }
  for (const item of [unrelated, foreign]) assert.equal((await row(f, "workflow_runs", item.run.id)).status, "WAITING_EXECUTION");
  assert.equal((await row(f, "actions", flight.id)).status, "EXECUTING");
  assert.deepEqual({ ...await row(f, "action_executions", attempt.id) }, attempt);
  const receipt = await f.db.get("SELECT * FROM webhook_receipts");
  assert.equal(receipt.processing_state, "QUARANTINED"); assert.equal(receipt.mandatory_policy_status, "DONE");
  for (const table of ["inbound_events", "channel_messages", "domain_events", "contact_restrictions"]) assert.equal(await count(f, table), 0, table);
  assert.equal(await count(f, "audit_logs", "event_type='AmbiguousInboundWorkStopped'"), 1);
});

for (const [table, operation, condition] of [["workflow_runs", "UPDATE", "WHEN NEW.status='STOPPED'"], ["follow_up_tasks", "UPDATE", "WHEN NEW.status='CANCELLED'"], ["audit_logs", "INSERT", "WHEN NEW.event_type='AmbiguousInboundWorkStopped'"]]) test("ambiguous stop failure at " + table + " rolls back all work and keeps dispatch pending until retry", async t => {
  const f = await callbackFixture(t); await f.createLead(f.lead.email); const item = await work(f);
  await f.db.exec("CREATE TRIGGER fail_ambiguity BEFORE " + operation + " ON " + table + " " + condition + " BEGIN SELECT RAISE(ABORT,'synthetic private stop failure'); END");
  await assert.rejects(receive(f), { statusCode: 503 });
  assert.equal((await row(f, "workflow_runs", item.run.id)).status, "WAITING_EXECUTION");
  assert.equal((await row(f, "actions", item.action.id)).status, "APPROVED");
  assert.equal((await row(f, "follow_up_tasks", item.automatic.id)).status, "PLANNED");
  assert.equal(await count(f, "audit_logs", "event_type='AmbiguousInboundWorkStopped'"), 0);
  assert.equal((await f.inspect()).policy_pending, true);
  await f.db.exec("DROP TRIGGER fail_ambiguity"); f.advance(5000);
  await f.webhookInbox.processDue({ organization_id: f.organization.id });
  assert.equal((await row(f, "workflow_runs", item.run.id)).status, "STOPPED");
  assert.equal((await f.inspect()).policy_pending, false);
  assert.equal(await count(f, "audit_logs", "event_type='AmbiguousInboundWorkStopped'"), 1);
});

test("receipt marker prevents owner replay from stopping newer intentional workflows or assigning a changed unique contact", async t => {
  const f = await callbackFixture(t), duplicate = await f.createLead(f.lead.email), original = await work(f);
  await assert.rejects(receive(f), { statusCode: 409 });
  const saved = await row(f, "workflow_runs", original.run.id), newer = await work(f);
  await f.db.run("UPDATE leads SET email='changed@example.test',normalized_email='changed@example.test' WHERE id=?", [duplicate.id]);
  const receipt = await f.db.get("SELECT * FROM webhook_receipts");
  f.webhookInbox.stopAccepting();
  let restarted;
  f.webhookInbox = new WebhookInboxService({ db: f.db, contactPolicyService: f.contactPolicyService, now: f.now, random: () => 1,
    handlers: { INBOUND_MESSAGE: (input, context) => restarted.applyInboundMessage(input, context) } });
  restarted = new InboundMessageService({ db: f.db, contactPolicyService: f.contactPolicyService, replyClassifier: f.channelWorkflowService.replyClassifier, webhookInbox: f.webhookInbox });
  await ownerRetry(f, receipt);
  assert.deepEqual(await row(f, "workflow_runs", original.run.id), saved);
  assert.equal((await row(f, "workflow_runs", newer.run.id)).status, "WAITING_EXECUTION");
  assert.equal(await count(f, "audit_logs", "event_type='AmbiguousInboundWorkStopped'"), 1);
  assert.equal(await count(f, "inbound_events"), 0);
  assert.equal((await f.db.get("SELECT * FROM webhook_receipts")).processing_state, "QUARANTINED");
});

test("old DONE receipt with no marker re-establishes a durable dispatch hold before failing stop replay", async t => {
  const f = await callbackFixture(t); await f.createLead(f.lead.email); const item = await work(f);
  await f.db.exec("CREATE TRIGGER fail_ambiguity BEFORE INSERT ON audit_logs WHEN NEW.event_type='AmbiguousInboundWorkStopped' BEGIN SELECT RAISE(ABORT,'synthetic stop failure'); END");
  await assert.rejects(receive(f), { statusCode: 503 });
  await f.db.run("UPDATE webhook_receipts SET processing_state='QUARANTINED',mandatory_policy_status='DONE',quarantined_reason='INBOUND_IDENTITY_AMBIGUOUS',next_attempt_at=NULL");
  const historical = await f.db.get("SELECT * FROM webhook_receipts");
  await ownerRetry(f, historical);
  assert.equal((await f.inspect()).policy_pending, true);
  assert.equal((await row(f, "workflow_runs", item.run.id)).status, "WAITING_EXECUTION");
  assert.equal(await count(f, "audit_logs", "event_type='AmbiguousInboundWorkStopped'"), 0);
});

test("direct-match safety cap leaves all existing work unchanged and receipt policy pending", async t => {
  const f = await callbackFixture(t), item = await work(f);
  for (let i = 0; i < AMBIGUOUS_REPLY_LIMIT; i++) await f.createLead(f.lead.email);
  await assert.rejects(receive(f), { statusCode: 503 });
  assert.equal((await row(f, "workflow_runs", item.run.id)).status, "WAITING_EXECUTION");
  assert.equal((await f.inspect()).policy_pending, true);
  assert.equal(await count(f, "audit_logs", "event_type='AmbiguousInboundWorkStopped'"), 0);
});

test("ambiguous opt-out still restricts all direct contacts before quarantine", async t => {
  const f = await callbackFixture(t), duplicate = await f.createLead(f.lead.email); await work(f);
  await assert.rejects(receive(f, "Stop contacting me."), { statusCode: 409 });
  assert.equal((await f.inspect()).restricted, true); assert.equal((await f.inspect(duplicate)).restricted, true);
  assert.equal((await f.inspect()).policy_pending, false);
  assert.equal(await count(f, "inbound_events"), 0);
});

test("delayed standalone callback records delivery but no no-response task after an ambiguous reply; a newer intentional send is independent", async t => {
  const f = await callbackFixture(t); await f.createLead(f.lead.email);
  const action = await f.createAction(), execution = await f.createAttempt(action); f.advance(1000);
  await assert.rejects(receive(f), { statusCode: 409 });
  await callback(f, action, execution);
  assert.equal((await row(f, "action_executions", execution.id)).outcome_class, "DELIVERED");
  assert.equal(await count(f, "channel_messages"), 1); assert.equal(await count(f, "follow_up_tasks"), 0);
  f.advance(1000); const newer = await f.createAction(), newerExecution = await f.createAttempt(newer);
  await callback(f, newer, newerExecution);
  assert.equal(await count(f, "follow_up_tasks"), 1);
  assert.equal((await f.db.get("SELECT action_id FROM follow_up_tasks")).action_id, newer.id);
});

test("delayed callback ambiguity guard checks the actual recipient even after the lead's contact changes", async t => {
  const f = await callbackFixture(t), action = await f.createAction(), execution = await f.createAttempt(action);
  await f.db.run("UPDATE leads SET email='changed@example.test',normalized_email='changed@example.test' WHERE id=?", [f.lead.id]);
  await f.createLead(f.lead.email); await f.createLead(f.lead.email); f.advance(1000);
  await assert.rejects(receive(f), { statusCode: 409 });
  await callback(f, action, execution);
  assert.equal(await count(f, "follow_up_tasks"), 0);
  assert.equal((await row(f, "action_executions", execution.id)).outcome_class, "DELIVERED");
});

for (const boundary of ["workflows", "tasks"]) test("ambiguous " + boundary + " cap rejects before stopping any selected work", async t => {
  const f = await callbackFixture(t); await f.createLead(f.lead.email); const item = await work(f);
  for (let i = 0; i < AMBIGUOUS_REPLY_LIMIT; i++) {
    if (boundary === "workflows") await new WorkflowsRepository(f.db).enrollLead({ organization_id: f.organization.id, campaign_id: item.run.campaign_id,
      sequence_id: item.run.sequence_id, lead_id: f.lead.id, idempotency_key: "overflow-run-" + i });
    else {
      const action = await f.createAction();
      await new FollowUpsRepository(f.db).create({ organization_id: f.organization.id, lead_id: f.lead.id, action_id: action.id, channel: "EMAIL", status: "PLANNED", due_at: new Date(f.now()).toISOString(), reason: "Synthetic automatic task", idempotency_key: "action:" + action.id + ":no-response-follow-up:v1" });
    }
  }
  await assert.rejects(receive(f), { statusCode: 503 });
  assert.equal((await row(f, "workflow_runs", item.run.id)).status, "WAITING_EXECUTION");
  assert.equal((await row(f, "follow_up_tasks", item.automatic.id)).status, "PLANNED");
  assert.equal((await f.inspect()).policy_pending, true);
});

test("bounded delayed-callback ambiguity scan defers unknown safety without losing confirmed delivery", async t => {
  const f = await callbackFixture(t), action = await f.createAction(), execution = await f.createAttempt(action);
  await f.createLead("shared-other@example.test"); await f.createLead("shared-other@example.test"); f.advance(1000);
  for (let i = 0; i <= AMBIGUOUS_REPLY_LIMIT; i++) await assert.rejects(f.inbound({ lead_id: null, contact: { email: "shared-other@example.test" }, provider_event_id: "bounded-ambiguity-" + i, payload: { text: "Can you explain the options?" } }), { statusCode: 409 });
  await assert.rejects(callback(f, action, execution), { statusCode: 503 });
  assert.equal((await row(f, "action_executions", execution.id)).outcome_class, "DELIVERED");
  assert.equal(await count(f, "follow_up_tasks"), 0);
  assert.equal((await f.db.get("SELECT effects_status FROM callbacks")).effects_status, "PENDING");
});
