import { applySendgridEvent } from "../src/modules/channels/sendgridEvents.js";
import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";
import { LeadDataService } from "../src/modules/data-foundation/leadDataService.js";
import { BusinessContextService } from "../src/modules/business-context/businessContextService.js";
import { PreparedActionService } from "../src/modules/outbound-automation/preparedActionService.js";
import { WorkflowsRepository } from "../src/modules/workflows/workflowsRepository.js";
import { FollowUpsRepository } from "../src/modules/channels/followUpsRepository.js";
import { applyLeadDataSafetyInTransaction } from "../src/modules/data-foundation/leadDataSafety.js";
import { loadLeadDataContext } from "../src/modules/data-foundation/leadDataContext.js";

async function fixture(t, source = "MANUAL") {
  const client = await startClient(t), registered = await client.register("Synthetic data safety");
  const lead = await client.services.leadsRepository.createLead({ organization_id: registered.organization.id, name: "Synthetic person", email: "old@example.test", company: "Example", source });
  const manager = new LeadDataService(client.db), actor = { id: registered.user.id, role: "OWNER" };
  return { client, lead, original: { ...lead }, manager, actor, db: client.db, services: client.services };
}
async function change(f, values) {
  const lead = await f.services.leadsRepository.getLead(f.lead.id);
  const command = { organization_id: lead.organization_id, lead_id: lead.id, actor: f.actor, expected_revision: Number(lead.data_revision),
    values: { name: lead.name, email: lead.email, phone: lead.phone, company: lead.company, ...values }, default_phone_region: "INTERNATIONAL_ONLY" };
  const preview = await f.manager.preview(command);
  const result = await f.manager.update({ ...command, review_token: preview.review_token, reason: "Verified synthetic contact correction" });
  f.lead = await f.services.leadsRepository.getLead(lead.id); return result;
}
async function archive(f, archived = true) {
  const lead = await f.services.leadsRepository.getLead(f.lead.id);
  const result = await f.manager.setArchived({ organization_id: lead.organization_id, lead_id: lead.id, actor: f.actor, expected_revision: Number(lead.data_revision), archived, reason: archived ? "Pause this enquiry" : "Resume intentional review" });
  f.lead = await f.services.leadsRepository.getLead(lead.id); return result;
}
async function action(f) {
  const action = await f.services.actionsRepository.createAction({ organization_id: f.lead.organization_id, lead_id: f.lead.id, type: "SEND_EMAIL", status: "AWAITING_APPROVAL", approval_requirement: "REQUIRED", idempotency_key: "data-test:" + Math.random(), payload: { subject: "Synthetic question", message: "Would this be useful?", mock_behavior: "SUCCESS" } });
  const input = { organization_id: f.lead.organization_id, action_id: action.id, reviewer_user_id: f.actor.id };
  const preview = await f.services.approvalsService.currentForAction(input);
  await f.services.approvalsService.approveAction({ ...input, expected_revision_id: preview.prepared_revision.id });
  return { action, input, revision: preview.prepared_revision };
}
async function pipeline(f) {
  const s = f.services; await s.intelligenceService.runForLead(f.lead); await s.synthesisService.runForLead(f.lead);
  await s.intelligenceRecommendationService.runForLead(f.lead); return s.nextBestActionService.planForLead(f.lead);
}
const get = (f, table, id) => f.db.get("SELECT * FROM " + table + " WHERE id=?", [id]);
const count = async (f, table) => Number((await f.db.get("SELECT COUNT(*) n FROM " + table)).n);
function barrier() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
async function work(f) {
  const repo = new WorkflowsRepository(f.db), organization_id = f.lead.organization_id;
  const campaign = await repo.createCampaign({ organization_id, name: "Synthetic campaign" });
  const sequence = await repo.createSequence({ organization_id, campaign_id: campaign.id, name: "Synthetic sequence", steps: [{ type: "SEND_EMAIL", channel: "EMAIL", requires_approval: true }] });
  const run = await repo.enrollLead({ organization_id, campaign_id: campaign.id, sequence_id: sequence.id, lead_id: f.lead.id, idempotency_key: "data-work:" + f.lead.id });
  const planned = await action(f), tasks = new FollowUpsRepository(f.db);
  const automatic = await tasks.create({ organization_id, lead_id: f.lead.id, action_id: planned.action.id, channel: "EMAIL", status: "PLANNED", due_at: new Date().toISOString(), reason: "Automatic no response", idempotency_key: "action:" + planned.action.id + ":no-response-follow-up:v1" });
  const human = await tasks.create({ organization_id, lead_id: f.lead.id, channel: "HUMAN_TASK", status: "DUE", due_at: new Date().toISOString(), reason: "Owner review", idempotency_key: "human:" + f.lead.id });
  return { run, sequence, planned, automatic, human };
}

test("edit-back and archive-restore cannot resurrect old analysis or approval", async t => {
  const f = await fixture(t); const plan = await pipeline(f), reviewed = await action(f);
  await change(f, { email: "new@example.test" }); await change(f, { email: f.original.email });
  assert.equal((await f.services.intelligenceService.assessLead(f.original)).snapshot, null, "stale caller reloads current revision");
  assert.equal((await f.services.nextBestActionService.currentForLead(f.original)).next_best_action_plan, null);
  await assert.rejects(f.services.approvalsService.approveAction({ ...reviewed.input, expected_revision_id: reviewed.revision.id }), { code: "APPROVAL_REVISION_STALE" });
  assert.equal((await get(f, "actions", reviewed.action.id)).status, "BLOCKED");
  const current = await pipeline(f); assert.notEqual(current.id, plan.id);
  await archive(f); await archive(f, false);
  assert.equal((await f.services.intelligenceService.assessLead(f.lead)).snapshot, null);
  assert.equal((await get(f, "actions", reviewed.action.id)).status, "BLOCKED");
});

test("manual contact correction retains exact CSV source and marks only changed field evidence manual", async t => {
  const f = await fixture(t, "CSV"); await change(f, { email: "corrected@example.test" });
  const snapshot = await f.services.intelligenceService.runForLead(f.lead);
  const email = snapshot.evidence.find(item => item.claim_field === "CONTACT_EMAIL"), name = snapshot.evidence.find(item => item.claim_field === "LEAD_NAME");
  assert.equal(email.source_type, "MANUAL"); assert.match(email.source_reference, /^lead-data-change:/); assert.equal(email.title, "Owner-corrected email");
  assert.equal(name.source_type, "CSV"); assert.equal(f.lead.source, "CSV");
  await pipeline(f);
});

for (const [property, agent, method, run] of [["synthesisService", "synthesisAgent", "synthesize", "runForLead"], ["intelligenceRecommendationService", "recommendationAgent", "recommend", "runForLead"], ["nextBestActionService", "actionPlanner", "plan", "planForLead"]]) {
  test(property + " rejects old caller before capture and a correction during model generation", { timeout: 15000 }, async t => {
    const f = await fixture(t); await pipeline(f);
    await change(f, { company: "Corrected company" });
    await assert.rejects(f.services[property][run](f.original), { code: "INTELLIGENCE_CONTEXT_CHANGED" });
    await f.services.intelligenceService.runForLead(f.lead);
    if (property !== "synthesisService") await f.services.synthesisService.runForLead(f.lead);
    if (property === "nextBestActionService") await f.services.intelligenceRecommendationService.runForLead(f.lead);
    const service = f.services[property], original = service[agent], entered = barrier(), release = barrier();
    service[agent] = { async [method](input) { entered.release(); await release.promise; return original[method](input); } };
    const running = service[run](f.lead), rejected = assert.rejects(running, { code: "INTELLIGENCE_CONTEXT_CHANGED" });
    await entered.promise; try { await change(f, { company: "Changed during model" }); } finally { release.release(); }
    await rejected;
  });
}

test("restriction carry preserves shared old identity and scope without spreading to new-address neighbors", async t => {
  const f = await fixture(t), old = f.lead.email;
  const neighbor = await f.services.leadsRepository.createLead({ organization_id: f.lead.organization_id, name: "Separate enquiry", email: "corrected@example.test" });
  await f.services.contactPolicyService.withWorkspacePolicyTransaction(f.lead.organization_id, tx => f.services.contactPolicyService.restrictContactInTransaction(tx, { organization_id: f.lead.organization_id, channel: "EMAIL", reason: "HARD_BOUNCE", source: "PROVIDER_EVENT", source_event_id: "original-bounce", contact: { kind: "EMAIL", value: old } }));
  const original = await f.db.get("SELECT * FROM contact_restrictions");
  await change(f, { email: neighbor.email });
  assert.deepEqual(await get(f, "contact_restrictions", original.id), original);
  const inherited = await f.db.get("SELECT * FROM contact_restrictions WHERE contact_kind='LEAD' AND contact_value=?", [f.lead.id]);
  assert.equal(inherited.reason, "HARD_BOUNCE"); assert.equal(inherited.channel, "EMAIL"); assert.ok(inherited.source_event_id.endsWith(original.id));
  assert.equal((await f.services.contactPolicyService.inspectLead({ organization_id: f.lead.organization_id, lead_id: f.lead.id, channel: "EMAIL" })).restricted, true);
  assert.equal((await f.services.contactPolicyService.inspectLead({ organization_id: f.lead.organization_id, lead_id: neighbor.id, channel: "EMAIL" })).restricted, false);
});

test("correction preserves human tasks while archive cancels all open work and restore never restarts it", async t => {
  const f = await fixture(t), w = await work(f);
  await change(f, { name: "Corrected name" });
  assert.equal((await get(f, "follow_up_tasks", w.automatic.id)).status, "CANCELLED");
  assert.equal((await get(f, "follow_up_tasks", w.human.id)).status, "DUE");
  assert.equal((await get(f, "workflow_runs", w.run.id)).status, "STOPPED");
  await archive(f); assert.equal((await get(f, "follow_up_tasks", w.human.id)).status, "CANCELLED");
  await assert.rejects(f.services.workflowsService.enrollLeads({ organization_id: f.lead.organization_id, sequence_id: w.sequence.id, lead_ids: [f.lead.id] }), { code: "LEAD_ARCHIVED" });
  assert.equal((await f.services.followUpDueService.processDue({ organization_id: f.lead.organization_id })).due_follow_ups.length, 0);
  await archive(f, false); assert.equal((await get(f, "workflow_runs", w.run.id)).status, "STOPPED");
  assert.equal((await get(f, "actions", w.planned.action.id)).status, "BLOCKED");
});

test("safety changes roll back together when later correction work fails", async t => {
  const f = await fixture(t), w = await work(f), before = await loadLeadDataContext(f.db, { organization_id: f.lead.organization_id, lead_id: f.lead.id });
  await assert.rejects(f.services.contactPolicyService.withWorkspacePolicyTransaction(f.lead.organization_id, async tx => {
    await applyLeadDataSafetyInTransaction(tx, { organization_id: f.lead.organization_id, lead_id: f.lead.id, before, after: { ...before, data_revision: 1 }, change_id: "synthetic-failed-change", kind: "ARCHIVE", actor: f.actor, reason: "Synthetic rollback" });
    throw new Error("Later write failed");
  }), /Later write failed/);
  assert.equal((await get(f, "actions", w.planned.action.id)).status, "APPROVED");
  assert.equal((await get(f, "workflow_runs", w.run.id)).status, "ACTIVE");
  assert.equal((await get(f, "follow_up_tasks", w.automatic.id)).status, "PLANNED");
});

for (const mutation of ["archive", "correction"]) test(mutation + " after authorization preserves actual provider failure but prevents a new retry", { timeout: 15000 }, async t => {
  const f = await fixture(t), reviewed = await action(f), entered = barrier(), release = barrier();
  let sent;
  f.services.actionExecutor.channelWorkflowService = null;
  f.services.actionExecutor.adapter = { async invoke(_a, _p, _n, metadata) { sent = metadata.approvedDispatch; entered.release(); await release.promise; return { ok: false, retryable: true, uncertain: false, error: "Synthetic confirmed nonacceptance" }; } };
  const running = f.services.actionExecutor.execute(reviewed.action); await entered.promise;
  try { if (mutation === "archive") await archive(f); else await change(f, { email: "corrected@example.test" }); } finally { release.release(); }
  const result = await running; assert.equal(result.status, "BLOCKED");
  assert.equal(sent.envelope.recipient, f.original.email);
  assert.equal((await f.services.executionsRepository.latestForAction(reviewed.action.id)).outcome_class, "RETRYABLE_FAILURE");
  assert.equal((await f.services.actionExecutor.execute(reviewed.action)).dispatched, undefined);
  assert.equal(await count(f, "action_executions"), 1);
});

for (const mutation of ["correction", "archive_restore"]) test("late callback after " + mutation + " keeps original message but cannot create new follow-up", async t => {
  const f = await fixture(t), reviewed = await action(f), result = await f.services.actionExecutor.execute(reviewed.action);
  const execution = result.execution;
  if (mutation === "correction") await change(f, { email: "corrected@example.test" }); else { await archive(f); await archive(f, false); }
  await f.client.post("/api/actions/" + reviewed.action.id + "/callback", { action_execution_id: execution.id, provider_event_id: "late-data-callback", status: "COMPLETED" });
  const message = await f.db.get("SELECT * FROM channel_messages WHERE action_id=?", [reviewed.action.id]);
  assert.equal(message.status, "DELIVERED"); assert.equal(JSON.parse(message.payload_json).recipient, f.original.email);
  assert.equal(await count(f, "follow_up_tasks"), 0);
  assert.equal((await get(f, "action_executions", execution.id)).outcome_class, "DELIVERED");
});

test("archived contact-only reply remains associated and recorded without tasks, lifecycle resurrection or intelligence work", async t => {
  const f = await fixture(t); await archive(f); const archivedStatus = f.lead.status;
  await f.client.post("/api/inbound-events/mock", { contact: { email: f.lead.email }, channel: "EMAIL", provider_event_id: "archived-reply", event_type: "QUESTION", payload: { text: "Can you explain?" } });
  assert.equal(await count(f, "leads"), 1); assert.equal(await count(f, "inbound_events"), 1); assert.equal(await count(f, "follow_up_tasks"), 0);
  assert.equal((await get(f, "leads", f.lead.id)).status, archivedStatus);
  await f.services.domainEventProcessor.processDue({ organization_id: f.lead.organization_id });
  assert.equal(await count(f, "intelligence_snapshots"), 0);
  assert.equal((await f.db.get("SELECT * FROM domain_events WHERE type='LeadReplyReceived'")).status, "PROCESSED");
  assert.equal((await f.db.get("SELECT * FROM webhook_receipts")).mandatory_policy_status, "DONE");
});

test("archived enquiry cannot receive analysis, manual action, research or typed context edits", async t => {
  const f = await fixture(t); await archive(f);
  for (const op of [() => f.services.intelligenceService.runForLead(f.lead), () => f.services.actionsService.createManualAction(f.lead),
    () => f.services.researchEvidenceService.ingestForLead({ lead: f.lead, provider_key: "APPROVED_MANUAL_RESEARCH", idempotency_key: "archived-research", evidence_items: [{}] }),
    () => new BusinessContextService(f.db).updateEnquiry({ organization_id: f.lead.organization_id, lead_id: f.lead.id, actor: f.actor, expected_revision: 0, reason: "Archived edit", enquiry: Object.fromEntries(["interest", "location", "budget", "timeline", "enquiry_date", "last_interaction"].map(field => [field, { state: "UNKNOWN", value: null, provenance: null }])) })]) {
    await assert.rejects(op(), { code: "LEAD_ARCHIVED" });
  }
});


test("archive preflight rejects excessive work atomically before cancelling any item", async t => {
  const f = await fixture(t), w = await work(f), stamp = new Date().toISOString();
  await f.db.run("WITH RECURSIVE items(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM items WHERE n<10000) INSERT INTO follow_up_tasks(id,organization_id,lead_id,channel,status,due_at,reason,idempotency_key,created_at,updated_at) SELECT 'cap:'||n,?,?,'HUMAN_TASK','PLANNED',?,'Synthetic capacity task','cap:'||n,?,? FROM items", [f.lead.organization_id, f.lead.id, stamp, stamp, stamp]);
  await assert.rejects(archive(f), { code: "LEAD_DATA_WORK_LIMIT" });
  assert.equal((await get(f, "leads", f.lead.id)).archived_at, null);
  assert.equal((await get(f, "actions", w.planned.action.id)).status, "APPROVED");
  assert.equal((await get(f, "workflow_runs", w.run.id)).status, "ACTIVE");
  assert.equal(await count(f, "lead_data_changes"), 0);
});

test("archive preserves ambiguous legacy attempts before applying a new dispatch block", async t => {
  const f = await fixture(t), reviewed = await action(f);
  const execution = await f.services.executionsRepository.createExecution({ action_id: reviewed.action.id, status: "STARTED", attempt: 1, provider: "sendgrid", idempotency_key: "unknown:" + reviewed.action.id, outcome_class: "LEGACY_UNKNOWN" });
  await archive(f);
  assert.equal((await get(f, "actions", reviewed.action.id)).status, "APPROVED", "coarse status is not rewritten over possible send evidence");
  assert.deepEqual({ ...await get(f, "action_executions", execution.id) }, execution);
  assert.equal((await f.services.approvalsService.currentForAction(reviewed.input)).prepared_revision.id, reviewed.revision.id, "archived review history remains readable");
  const held = await f.services.actionExecutor.execute(reviewed.action);
  assert.equal(held.status, "EXECUTING"); assert.equal((await get(f, "actions", reviewed.action.id)).execution_hold_reason, "OUTCOME_REVIEW_REQUIRED");
  assert.equal(await count(f, "action_executions"), 1);
});

test("archive during a model call prevents final output and archived current reads stay available", { timeout: 15000 }, async t => {
  const f = await fixture(t); await f.services.intelligenceService.runForLead(f.lead);
  const service = f.services.synthesisService, original = service.synthesisAgent, entered = barrier(), release = barrier();
  service.synthesisAgent = { async synthesize(input) { entered.release(); await release.promise; return original.synthesize(input); } };
  const running = service.runForLead(f.lead), rejected = assert.rejects(running, { code: "INTELLIGENCE_CONTEXT_CHANGED" });
  await entered.promise; try { await archive(f); } finally { release.release(); }
  await rejected;
  assert.equal((await f.services.intelligenceService.assessLead(f.original)).snapshot, null);
  assert.equal((await service.currentForLead(f.original)).synthesis, null);
  assert.equal((await service.historyForLead(f.lead)).length, 1);
});

test("scheduler selectors and authoritative processing cannot revive archived work", async t => {
  const f = await fixture(t), w = await work(f); await archive(f);
  await f.db.run("UPDATE actions SET status='APPROVED',execution_hold_reason=NULL WHERE id=?", [w.planned.action.id]);
  await f.db.run("UPDATE workflow_runs SET status='ACTIVE' WHERE id=?", [w.run.id]);
  await f.db.run("UPDATE follow_up_tasks SET status='PLANNED' WHERE id=?", [w.automatic.id]);
  const at = new Date().toISOString();
  assert.deepEqual(await f.services.actionsRepository.nextExecutable(25, f.lead.organization_id, at), []);
  assert.deepEqual(await new WorkflowsRepository(f.db).dueRuns(f.lead.organization_id, at), []);
  assert.equal((await f.services.followUpDueService.processDue({ organization_id: f.lead.organization_id })).due_follow_ups.length, 0);
  assert.equal((await f.services.workflowsService.processRun(w.run, at)).status, "STOPPED");
  const held = await f.services.actionExecutor.execute(w.planned.action);
  assert.equal(held.status, "BLOCKED"); assert.equal((await get(f, "actions", w.planned.action.id)).execution_hold_reason, "LEAD_ARCHIVED");
  assert.equal(await count(f, "action_executions"), 0);
});

async function originalSendgridAttempt(f) {
  await f.services.settingsRepository.setBulk(f.lead.organization_id, "channel_email", { provider: "sendgrid", from_email: "sender@example.test", api_key: "synthetic-not-a-credential" });
  const reviewed = await action(f), revision = await get(f, "action_revisions", reviewed.revision.id);
  const execution = await f.services.executionsRepository.createExecution({ action_id: reviewed.action.id, status: "STARTED", attempt: 1, provider: "sendgrid", idempotency_key: "original:" + reviewed.action.id,
    action_revision_id: revision.id, envelope_hash: revision.content_hash, dispatch_authorized_at: new Date().toISOString(), outcome_class: "ACCEPTED" });
  await f.db.run("UPDATE actions SET status='EXECUTING',active_execution_id=?,execution_fence=1 WHERE id=?", [execution.id, reviewed.action.id]);
  const event = { event: "unsubscribe", sg_event_id: "late-original-send", email: f.original.email, relay_action_id: reviewed.action.id, relay_execution_id: execution.id, relay_revision_id: revision.id };
  return { reviewed, execution, event };
}

test("exact old SendGrid send anchors a late unsubscribe to corrected archived enquiry without affecting new-address neighbor", async t => {
  const f = await fixture(t), send = await originalSendgridAttempt(f);
  await change(f, { email: "corrected@example.test" });
  const neighbor = await f.services.leadsRepository.createLead({ organization_id: f.lead.organization_id, name: "Independent enquiry", email: f.lead.email });
  await archive(f);
  await f.db.run("UPDATE actions SET active_execution_id=NULL,execution_fence=9 WHERE id=?", [send.reviewed.action.id]);
  await applySendgridEvent(f.services, f.lead.organization_id, send.event);
  const first = await f.db.all("SELECT * FROM contact_restrictions ORDER BY id");
  await applySendgridEvent(f.services, f.lead.organization_id, send.event);
  assert.deepEqual(await f.db.all("SELECT * FROM contact_restrictions ORDER BY id"), first);
  assert.equal(first.length, 2); assert.ok(first.some(r => r.contact_kind === "EMAIL" && r.contact_value === f.original.email));
  assert.ok(first.some(r => r.contact_kind === "LEAD" && r.contact_value === f.lead.id && r.channel === "EMAIL" && r.reason === "UNSUBSCRIBE"));
  assert.equal((await f.services.contactPolicyService.inspectLead({ organization_id: f.lead.organization_id, lead_id: neighbor.id, channel: "EMAIL" })).restricted, false);
  const anchorAudit = await f.db.get("SELECT metadata_json FROM audit_logs WHERE event_type='ContactRestricted' AND lead_id=?", [f.lead.id]);
  assert.equal(JSON.parse(anchorAudit.metadata_json).execution_id, send.execution.id);
});

for (const variant of ["wrong_recipient", "wrong_execution", "wrong_revision", "missing_refs", "conflicting_refs", "wrong_hash"]) test("late SendGrid " + variant + " preserves only actual-contact restriction", async t => {
  const f = await fixture(t), send = await originalSendgridAttempt(f); await change(f, { email: "corrected@example.test" });
  const event = { ...send.event, sg_event_id: "late-unproved:" + variant };
  if (variant === "wrong_recipient") event.email = "other-recipient@example.test";
  if (variant === "wrong_execution") event.relay_execution_id = "missing-execution";
  if (variant === "wrong_revision") event.relay_revision_id = "missing-revision";
  if (variant === "missing_refs") { delete event.relay_execution_id; delete event.relay_revision_id; }
  if (variant === "conflicting_refs") event.custom_args = { relay_execution_id: "conflicting-execution" };
  if (variant === "wrong_hash") await f.db.run("UPDATE action_executions SET envelope_hash=? WHERE id=?", ["0".repeat(64), send.execution.id]);
  try { await applySendgridEvent(f.services, f.lead.organization_id, event); } catch (error) { assert.ok(error.statusCode >= 400); }
  const restrictions = await f.db.all("SELECT * FROM contact_restrictions");
  assert.equal(restrictions.length, 1); assert.equal(restrictions[0].contact_kind, "EMAIL"); assert.equal(restrictions[0].contact_value, event.email);
  assert.equal((await f.services.contactPolicyService.inspectLead({ organization_id: f.lead.organization_id, lead_id: f.lead.id, channel: "EMAIL" })).restricted, false);
});


test("new reviewed intent after a correction can complete and create its own no-response task", async t => {
  const f = await fixture(t); await change(f, { email: "corrected@example.test" }); await pipeline(f);
  const reviewed = await action(f), result = await f.services.actionExecutor.execute(reviewed.action);
  await f.client.post("/api/actions/" + reviewed.action.id + "/callback", { action_execution_id: result.execution.id, provider_event_id: "new-current-intent", status: "COMPLETED" });
  const message = await f.db.get("SELECT * FROM channel_messages WHERE action_id=?", [reviewed.action.id]);
  assert.equal(JSON.parse(message.payload_json).recipient, f.lead.email);
  assert.equal((await f.db.get("SELECT * FROM follow_up_tasks WHERE action_id=?", [reviewed.action.id])).status, "PLANNED");
});

test("archived inbound opt-out still records independent restriction without restoring enquiry", async t => {
  const f = await fixture(t); await archive(f); const archivedAt = f.lead.archived_at;
  await f.client.post("/api/inbound-events/mock", { contact: { email: f.lead.email }, channel: "EMAIL", provider_event_id: "archived-stop", payload: { text: "Please unsubscribe and stop contacting me." } });
  const lead = await get(f, "leads", f.lead.id);
  assert.equal(lead.archived_at, archivedAt); assert.equal(lead.status, "OPTED_OUT");
  assert.equal(await count(f, "leads"), 1); assert.equal(await count(f, "channel_messages"), 1); assert.equal(await count(f, "follow_up_tasks"), 0);
  assert.equal((await f.services.contactPolicyService.inspectLead({ organization_id: lead.organization_id, lead_id: lead.id, channel: "EMAIL" })).restricted, true);
});

test("late exact provider restriction rolls back recipient and enquiry effects together and holds dispatch pending on failure", async t => {
  const f = await fixture(t), send = await originalSendgridAttempt(f); await change(f, { email: "corrected@example.test" });
  if (f.db.kind !== "sqlite") return t.skip("SQLite fault-injection trigger; shared behavior covered in PostgreSQL gated suites");
  await f.db.exec("CREATE TRIGGER fail_late_anchor BEFORE INSERT ON contact_restrictions WHEN NEW.contact_kind='LEAD' BEGIN SELECT RAISE(ABORT,'synthetic anchor failure'); END");
  await assert.rejects(applySendgridEvent(f.services, f.lead.organization_id, send.event));
  assert.equal(await count(f, "contact_restrictions"), 0);
  assert.equal((await f.db.get("SELECT * FROM webhook_receipts")).mandatory_policy_status, "PENDING");
  await f.db.exec("DROP TRIGGER fail_late_anchor");
  await f.db.run("UPDATE webhook_receipts SET next_attempt_at=NULL WHERE mandatory_policy_status='PENDING'");
  await f.services.webhookInbox.processDue({ organization_id: f.lead.organization_id });
  assert.equal(await count(f, "contact_restrictions"), 2);
  assert.equal((await f.db.get("SELECT * FROM webhook_receipts")).mandatory_policy_status, "DONE");
});
