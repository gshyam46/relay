import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";
import { BusinessContextService } from "../src/modules/business-context/businessContextService.js";
import { PreparedActionService } from "../src/modules/outbound-automation/preparedActionService.js";
import { fingerprint, PREPARED_POLICY_VERSION } from "../src/modules/outbound-automation/preparedActionContract.js";

const profile = { business_name: "Synthetic workshop", offerings: ["Made-to-order furniture"], service_areas: [], target_customers: [], exclusions: [],
  required_criteria: [], preferred_criteria: [], preferred_next_step: null, timezone: null, language: null };
const source = { assertion: "CUSTOMER_STATED", source_type: "MANUAL", source_reference: "Synthetic conversation record", observed_at: null };
function enquiry(interest = null) {
  const result = Object.fromEntries(["interest", "location", "budget", "timeline", "enquiry_date", "last_interaction"].map((key) =>
    [key, { state: "UNKNOWN", value: null, provenance: null }]));
  if (interest) result.interest = { state: "KNOWN", value: interest, provenance: source };
  return result;
}
function barrier() { let release; const promise = new Promise((resolve) => { release = resolve; }); return { promise, release }; }
async function fixture(t) {
  const client = await startClient(t), registered = await client.register("Synthetic context review");
  const lead = await client.services.leadsRepository.createLead({ organization_id: registered.organization.id, name: "Synthetic person", email: "person@example.test", company: "Example" });
  const action = await client.services.actionsRepository.createAction({ organization_id: lead.organization_id, lead_id: lead.id, type: "SEND_EMAIL",
    idempotency_key: "context-review:" + lead.id, status: "AWAITING_APPROVAL", approval_requirement: "REQUIRED", payload: { subject: "A question", message: "Would this be useful?" } });
  const input = { organization_id: lead.organization_id, action_id: action.id, reviewer_user_id: registered.user.id };
  const context = new BusinessContextService(client.db), actor = { id: registered.user.id, role: "OWNER" };
  return { client, lead, action, input, context, actor, approvals: client.services.approvalsService };
}
async function saveProfile(f, expected_revision = 0, value = profile) {
  return f.context.updateProfile({ organization_id: f.lead.organization_id, actor: f.actor, expected_revision, reason: "Synthetic reviewed business context", profile: value });
}
async function saveEnquiry(f, lead = f.lead, value = enquiry("A dining table"), expected_revision = 0) {
  return f.context.updateEnquiry({ organization_id: lead.organization_id, lead_id: lead.id, actor: f.actor, expected_revision, reason: "Synthetic recorded enquiry", enquiry: value });
}
async function approve(f) {
  const preview = await f.approvals.currentForAction(f.input);
  return f.approvals.approveAction({ ...f.input, expected_revision_id: preview.prepared_revision.id });
}
async function dispatchSnapshot(f, extras = {}) {
  return f.client.services.contactPolicyService.withWorkspacePolicyTransaction(f.lead.organization_id, async (tx) => {
    const prepared = new PreparedActionService(tx), action = await tx.get("SELECT * FROM actions WHERE id=?", [f.action.id]);
    return prepared.validateForDispatch({ action, ...await prepared.inputs(action), ...extras });
  });
}

test("absent business context preserves the exact previous review fingerprint and decision", async (t) => {
  const f = await fixture(t), reviewed = await approve(f);
  const action = await f.client.services.actionsRepository.getAction(f.action.id);
  const { status: _status, updated_at: _updated, data_revision: _revision, archived_at: _archived, ...leadData } = await f.client.services.leadsRepository.getLead(f.lead.id);
  const legacy = fingerprint({ action_type: action.type, lead: leadData, payload: JSON.parse(action.payload_json), scheduled_at: action.scheduled_at || null, policy_version: PREPARED_POLICY_VERSION });
  const row = await f.client.db.get("SELECT * FROM action_revisions WHERE id=?", [reviewed.prepared_revision.id]);
  assert.equal(row.context_fingerprint, legacy);
  assert.equal((await dispatchSnapshot(f)).revision_id, row.id);
  assert.equal((await f.approvals.currentForAction(f.input)).prepared_revision.id, row.id);
});

test("first profile save invalidates approval before an attempt and renewed review preserves the edited copy", async (t) => {
  const f = await fixture(t), initial = await f.approvals.currentForAction(f.input);
  const edited = await f.approvals.previewAction({ ...f.input, expected_revision_id: initial.prepared_revision.id, edited_payload: { body: "Precisely reviewed wording." } });
  await f.approvals.approveAction({ ...f.input, expected_revision_id: edited.prepared_revision.id });
  const original = await f.client.db.get("SELECT * FROM action_revisions WHERE id=?", [edited.prepared_revision.id]);
  await saveProfile(f);
  await assert.rejects(f.approvals.approveAction({ ...f.input, expected_revision_id: edited.prepared_revision.id }), { code: "APPROVAL_REVISION_STALE" });
  let sends = 0;
  f.client.services.actionExecutor.adapter = { async invoke() { sends++; return { ok: true, provider: "synthetic", provider_reference: "accepted" }; } };
  const held = await f.client.services.actionExecutor.execute(f.action);
  assert.equal(held.status, "AWAITING_APPROVAL"); assert.equal(sends, 0);
  assert.equal((await f.client.db.get("SELECT COUNT(*) AS n FROM action_executions")).n, 0);
  assert.deepEqual(await f.client.db.get("SELECT * FROM action_revisions WHERE id=?", [original.id]), original);
  const next = await f.approvals.currentForAction(f.input);
  assert.notEqual(next.prepared_revision.id, original.id);
  assert.equal(next.prepared_revision.envelope.body, "Precisely reviewed wording.");
  await f.approvals.approveAction({ ...f.input, expected_revision_id: next.prepared_revision.id });
  assert.equal((await f.client.services.actionExecutor.execute(f.action)).dispatched, true); assert.equal(sends, 1);
  assert.equal((await f.client.db.get("SELECT COUNT(*) AS n FROM action_revision_decisions")).n, 2);
});

test("enquiry changes bind only their lead and supplied context tokens cannot bypass dispatch review", async (t) => {
  const f = await fixture(t), reviewed = await approve(f);
  const other = await f.client.services.leadsRepository.createLead({ organization_id: f.lead.organization_id, name: "Other enquiry", email: "other@example.test" });
  await saveEnquiry(f, other);
  assert.equal((await dispatchSnapshot(f)).revision_id, reviewed.prepared_revision.id);
  await saveEnquiry(f);
  await assert.rejects(dispatchSnapshot(f, { businessContextRevisions: { profile_revision: 0, enquiry_revision: 0 }, business_context: { profile_revision: 0, enquiry_revision: 0 } }), { code: "APPROVAL_REVISION_STALE" });
  const next = await approve(f);
  await saveEnquiry(f, f.lead, enquiry("An office desk"), 1);
  await assert.rejects(dispatchSnapshot(f), { code: "APPROVAL_REVISION_STALE" });
  assert.equal((await f.client.db.get("SELECT decision FROM action_revision_decisions WHERE action_revision_id=?", [next.prepared_revision.id])).decision, "APPROVED");
});

test("same-content profile save and a different workspace preserve the current exact review", async (t) => {
  const f = await fixture(t); await saveProfile(f); const reviewed = await approve(f);
  await saveProfile(f, 1);
  assert.equal((await dispatchSnapshot(f)).revision_id, reviewed.prepared_revision.id);
  const other = await f.client.register("Unrelated context workspace");
  await f.context.updateProfile({ organization_id: other.organization.id, actor: { id: other.user.id, role: "OWNER" }, expected_revision: 0, reason: "Unrelated offering", profile });
  assert.equal((await dispatchSnapshot(f)).revision_id, reviewed.prepared_revision.id);
});

test("context saved during an authorized provider call does not rewrite its frozen intent or outcome", async (t) => {
  const f = await fixture(t), reviewed = await approve(f), entered = barrier(), unblock = barrier();
  let captured;
  f.client.services.actionExecutor.channelWorkflowService = null;
  f.client.services.actionExecutor.adapter = { async invoke(_action, _payload, _attempt, metadata) { captured = metadata.approvedDispatch; entered.release(); await unblock.promise; return { ok: true, provider: "synthetic", provider_reference: "already-authorized" }; } };
  const sending = f.client.services.actionExecutor.execute(f.action); await entered.promise;
  try { await saveProfile(f); } finally { unblock.release(); }
  assert.equal((await sending).dispatched, true);
  assert.equal(captured.revision_id, reviewed.prepared_revision.id);
  const execution = await f.client.services.executionsRepository.latestForAction(f.action.id);
  assert.equal(execution.action_revision_id, reviewed.prepared_revision.id); assert.equal(execution.outcome_class, "ACCEPTED");
  assert.equal(execution.provider_reference, "already-authorized");
});

test("context re-review preserves the original retry budget and deadline", async (t) => {
  const f = await fixture(t); await approve(f);
  f.client.services.actionExecutor.adapter = { async invoke() { return { ok: false, retryable: true, uncertain: false, error: "Synthetic confirmed rejection" }; } };
  assert.equal((await f.client.services.actionExecutor.execute(f.action)).status, "RETRYING");
  const before = await f.client.services.actionsRepository.getAction(f.action.id);
  await saveProfile(f); f.client.services.actionExecutor.now = () => Date.parse(before.next_attempt_at);
  assert.equal((await f.client.services.actionExecutor.execute(f.action)).status, "AWAITING_APPROVAL");
  await approve(f);
  const after = await f.client.services.actionsRepository.getAction(f.action.id);
  for (const key of ["first_dispatch_at", "retry_deadline_at", "max_attempts"]) assert.equal(after[key], before[key]);
  assert.equal(await f.client.services.executionsRepository.countForAction(f.action.id), 1);
});

const stages = [
  { name: "synthesis", property: "synthesisService", agent: "synthesisAgent", method: "synthesize", run: "runForLead", table: "intelligence_synthesis_runs", ready: "READY", audit: "LeadIntelligenceSynthesized" },
  { name: "recommendation", property: "intelligenceRecommendationService", agent: "recommendationAgent", method: "recommend", run: "runForLead", table: "intelligence_recommendation_runs", ready: "READY", audit: "LeadIntelligenceRecommendationUpdated" },
  { name: "plan", property: "nextBestActionService", agent: "actionPlanner", method: "plan", run: "planForLead", table: "next_best_action_plans", ready: "PLANNED", audit: "NextBestActionPlanned" }
];
async function pipelineBefore(f, stage) {
  await f.client.services.intelligenceService.runForLead(f.lead);
  for (const item of stages) {
    if (item === stage) break;
    await f.client.services[item.property][item.run](f.lead);
  }
}
for (const stage of stages) {
  test("direct " + stage.name + " generation cannot publish or supersede newer context after a concurrent save", { timeout: 10000 }, async (t) => {
    const f = await fixture(t); await pipelineBefore(f, stage);
    const service = f.client.services[stage.property], original = service[stage.agent], entered = barrier(), unblock = barrier();
    service[stage.agent] = { async [stage.method](input) {
      assert.equal((await f.client.db.get("SELECT COUNT(*) AS n FROM organizations")).n, 1, "generation is outside every database transaction");
      entered.release(); await unblock.promise; return original[stage.method](input);
    } };
    const old = service[stage.run](f.lead), rejected = assert.rejects(old, { code: "INTELLIGENCE_CONTEXT_CHANGED" });
    await entered.promise;
    let current;
    try {
      await saveProfile(f); service[stage.agent] = original;
      await pipelineBefore(f, stage); current = await service[stage.run](f.lead);
    } finally { unblock.release(); }
    await rejected;
    assert.equal((await f.client.db.get("SELECT status FROM " + stage.table + " WHERE id=?", [current.id])).status, stage.ready);
    assert.equal((await f.client.db.get("SELECT COUNT(*) AS n FROM " + stage.table + " WHERE status='FAILED'")).n, 1);
    assert.equal((await f.client.db.get("SELECT COUNT(*) AS n FROM audit_logs WHERE event_type=?", [stage.audit])).n, 1);
    assert.equal((await f.client.db.get("SELECT COUNT(*) AS n FROM action_executions")).n, 0);
  });
  test("direct " + stage.name + " finalization rolls back ready state when its audit fails", async (t) => {
    const f = await fixture(t); await pipelineBefore(f, stage);
    await failAudit(f.client.db, stage.audit);
    await assert.rejects(f.client.services[stage.property][stage.run](f.lead), /synthetic finalization audit failure/);
    assert.equal((await f.client.db.get("SELECT COUNT(*) AS n FROM " + stage.table + " WHERE status IN ('READY','PLANNED','BLOCKED')")).n, 0);
    assert.equal((await f.client.db.get("SELECT COUNT(*) AS n FROM " + stage.table + " WHERE status='FAILED'")).n, 1);
  });
}

async function failAudit(db, eventType) {
  if (db.kind === "postgres") {
    await db.exec("CREATE FUNCTION fail_context_pipeline_audit() RETURNS TRIGGER AS $$ BEGIN RAISE EXCEPTION 'synthetic finalization audit failure'; END; $$ LANGUAGE plpgsql; " +
      "CREATE TRIGGER fail_context_pipeline_audit BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.event_type='" + eventType + "') EXECUTE FUNCTION fail_context_pipeline_audit()");
  } else {
    await db.exec("CREATE TRIGGER fail_context_pipeline_audit BEFORE INSERT ON audit_logs WHEN NEW.event_type='" + eventType + "' BEGIN SELECT RAISE(ABORT,'synthetic finalization audit failure'); END");
  }
}
