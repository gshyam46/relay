import { PreparedActionService } from "../src/modules/outbound-automation/preparedActionService.js";
import { BUSINESS_FIT_VERSION } from "../src/modules/lead-intelligence/businessFit.js";
import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";
import { BusinessContextService } from "../src/modules/business-context/businessContextService.js";
import { LlmRecommendationAgent } from "../src/modules/ai/llmRecommendationAgent.js";

const profile = { business_name: "Synthetic table workshop", offerings: ["Custom dining tables"], service_areas: ["Pune, India"], target_customers: [], exclusions: [], required_criteria: [], preferred_criteria: [], preferred_next_step: null, timezone: "Asia/Kolkata", language: "English" };
const rules = { version: 1, interest: { requirement: "REQUIRED", accepted_aliases: ["Custom dining table"], excluded_aliases: ["Chair repair"] }, location: null, budget: null, timeline: null };
const changedRules = { ...rules, interest: { requirement: "REQUIRED", accepted_aliases: ["Office desk"], excluded_aliases: ["Custom dining table"] } };
function barrier() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
async function fixture(t, { interest = "Custom dining table", contact = true, duplicate = false, criteria = null } = {}) {
  const client = await startClient(t), identity = await client.register("Synthetic fit runtime");
  const lead = await client.services.leadsRepository.createLead({ organization_id: identity.organization.id, name: "Recorded person", email: contact ? "fit@example.test" : null, company: "Recorded company", source: "MANUAL", source_metadata: duplicate ? { duplicate_candidate_count: 1 } : {} });
  const f = { client, db: client.db, services: client.services, lead, actor: { id: identity.user.id, role: "OWNER" }, revision: 0, context: new BusinessContextService(client.db) };
  const observed = new Date(Date.now() - 60000).toISOString(), fact = value => ({ state: "KNOWN", value, provenance: { assertion: "CUSTOMER_STATED", source_type: "MANUAL", source_reference: "Recorded synthetic enquiry", observed_at: observed } });
  f.enquiry = { interest: fact(interest), location: fact({ country_code: "IN", locality: "Pune" }), budget: fact({ currency: "INR", minimum: "40000", maximum: "50000" }), timeline: fact({ description: "Requested date", target_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) }), enquiry_date: fact(observed.slice(0, 10)), last_interaction: fact(observed) };
  await f.context.updateEnquiry({ organization_id: lead.organization_id, lead_id: lead.id, actor: f.actor, expected_revision: 0, reason: "Record synthetic sources", enquiry: f.enquiry });
  await configure(f, criteria); return f;
}
async function configure(f, fit_criteria) {
  const value = await f.context.updateProfile({ organization_id: f.lead.organization_id, actor: f.actor, expected_revision: f.revision, reason: "Review declared synthetic criteria", profile, fit_criteria });
  f.revision = value.revision; return value;
}
async function pipeline(f) {
  const snapshot = await f.services.intelligenceService.runForLead(f.lead);
  const synthesis = await f.services.synthesisService.runForLead(f.lead);
  const recommendation = await f.services.intelligenceRecommendationService.runForLead(f.lead);
  const plan = await f.services.nextBestActionService.planForLead(f.lead);
  return { snapshot, synthesis, recommendation, plan };
}
async function action(f, approve = true) {
  const action = await f.services.actionsRepository.createAction({ organization_id: f.lead.organization_id, lead_id: f.lead.id, type: "SEND_EMAIL", status: "AWAITING_APPROVAL", approval_requirement: "REQUIRED", idempotency_key: "fit:" + Math.random(), payload: { subject: "A reviewed question", message: "Would this be useful?", mock_behavior: "SUCCESS" } });
  const input = { organization_id: f.lead.organization_id, action_id: action.id, reviewer_user_id: f.actor.id };
  const view = await f.services.approvalsService.currentForAction(input);
  if (approve) await f.services.approvalsService.approveAction({ ...input, expected_revision_id: view.prepared_revision.id });
  return { action, input, revision: view.prepared_revision };
}
async function count(f, table) { return Number((await f.db.get("SELECT COUNT(*) n FROM " + table)).n); }

for (const [interest, status] of [["Chair repair", "DOES_NOT_MATCH"], ["A heritage dining solution", "NEEDS_REVIEW"]]) test(status + " constrains outreach preparation while preserving legacy score, exact evidence and history", async t => {
  const f = await fixture(t, { interest }), baseline = await pipeline(f);
  assert.equal(baseline.snapshot.business_fit.status, "NOT_CONFIGURED");
  assert.equal(baseline.recommendation.recommendation.step, "PREPARE_OUTBOUND_REVIEW");
  const before = await f.db.get("SELECT * FROM intelligence_recommendation_runs WHERE id=?", [baseline.recommendation.id]);
  await configure(f, rules); const result = await pipeline(f);
  assert.equal(result.snapshot.business_fit.status, status);
  assert.equal(result.recommendation.recommendation.step, "REVIEW_LEAD_INTELLIGENCE");
  assert.equal(result.recommendation.recommendation.reason, "Review the separately recorded business criteria assessment before preparing outreach.");
  assert.equal(result.recommendation.priority.score, baseline.recommendation.priority.score);
  assert.equal(result.plan.action_type, "REVIEW_LEAD_INTELLIGENCE");
  assert.ok(result.plan.decision_evidence_refs.every(ref => ref.startsWith("snapshot_evidence:")));
  assert.ok(!result.plan.decision_evidence_refs.includes("interest"));
  assert.equal(await count(f, "actions"), 0); assert.equal(await count(f, "action_executions"), 0);
  const historical = await f.db.get("SELECT * FROM intelligence_recommendation_runs WHERE id=?", [before.id]);
  for (const key of ["priority_json", "segment_json", "recommendation_json"]) assert.equal(historical[key], before[key]);
  const created = await f.services.outboundAutomationService.createActionFromPlan({ organization_id: f.lead.organization_id, plan_id: result.plan.id });
  assert.equal(created.type, "CREATE_HUMAN_TASK"); assert.equal(await count(f, "action_executions"), 0);
  let calls = 0; const configured = new LlmRecommendationAgent({ jsonCompletion() { calls++; throw new Error("No free-form grading"); } });
  assert.equal(configured.recommend({ lead: f.lead, snapshot: result.snapshot, synthesis: result.synthesis }).recommendation.step, "REVIEW_LEAD_INTELLIGENCE");
  assert.equal(calls, 0);
});

test("unchanged criteria reuse all artifacts, explicit disable and re-enable cannot resurrect earlier approval", async t => {
  const f = await fixture(t, { criteria: rules }), first = await pipeline(f), approved = await action(f);
  const original = await f.db.get("SELECT * FROM action_revisions WHERE id=?", [approved.revision.id]), beforeRevision = f.revision;
  const audits = await count(f, "audit_logs"); await configure(f, rules); assert.equal(f.revision, beforeRevision);
  const reuse = await pipeline(f); for (const key of Object.keys(first)) assert.equal(reuse[key].id, first[key].id);
  assert.equal(await count(f, "audit_logs"), audits);
  await configure(f, null); await configure(f, rules);
  assert.equal((await f.services.intelligenceService.assessLead(f.lead)).snapshot, null);
  await assert.rejects(f.services.approvalsService.approveAction({ ...approved.input, expected_revision_id: approved.revision.id }), { code: "APPROVAL_REVISION_STALE" });
  assert.deepEqual(await f.db.get("SELECT * FROM action_revisions WHERE id=?", [approved.revision.id]), original);
  assert.equal((await f.db.get("SELECT decision FROM action_revision_decisions WHERE action_revision_id=?", [original.id])).decision, "APPROVED");
  assert.notEqual((await pipeline(f)).snapshot.id, first.snapshot.id);
});

for (const [serviceName, agentName, method, run] of [["synthesisService", "synthesisAgent", "synthesize", "runForLead"], ["intelligenceRecommendationService", "recommendationAgent", "recommend", "runForLead"], ["nextBestActionService", "actionPlanner", "plan", "planForLead"]]) test(serviceName + " rejects a criteria edit while model work is in progress", async t => {
  const f = await fixture(t, { criteria: rules });
  await f.services.intelligenceService.runForLead(f.lead);
  if (serviceName !== "synthesisService") await f.services.synthesisService.runForLead(f.lead);
  if (serviceName === "nextBestActionService") await f.services.intelligenceRecommendationService.runForLead(f.lead);
  const service = f.services[serviceName], original = service[agentName], entered = barrier(), release = barrier();
  service[agentName] = { async [method](input) { entered.release(); await release.promise; return original[method](input); } };
  const running = service[run](f.lead), rejected = assert.rejects(running, { code: "INTELLIGENCE_CONTEXT_CHANGED" });
  await entered.promise; try { await configure(f, changedRules); } finally { release.release(); }
  await rejected; service[agentName] = original;
  const result = await pipeline(f); assert.equal(result.snapshot.business_fit.status, "DOES_NOT_MATCH"); assert.equal(result.plan.action_type, "REVIEW_LEAD_INTELLIGENCE");
});

for (const options of [{ contact: false, expected: "GATHER_MORE_DATA" }, { duplicate: true, expected: "REVIEW_DUPLICATE_CANDIDATE" }]) test("fit constraints preserve " + options.expected + " obligations", async t => {
  const f = await fixture(t, { ...options, interest: "Chair repair", criteria: rules }), result = await pipeline(f);
  assert.equal(result.snapshot.business_fit.status, "DOES_NOT_MATCH"); assert.equal(result.recommendation.recommendation.step, options.expected); assert.equal(result.plan.action_type, options.expected);
});

test("matching fit does not approve an action or bypass an independent contact restriction", async t => {
  const f = await fixture(t, { criteria: rules }), result = await pipeline(f), pending = await action(f, false);
  assert.equal(result.snapshot.business_fit.status, "MATCHES_CRITERIA"); let calls = 0;
  f.services.actionExecutor.adapter = { async invoke() { calls++; return { ok: true }; } };
  assert.equal((await f.services.actionExecutor.execute(pending.action)).status, "AWAITING_APPROVAL"); assert.equal(calls, 0);
  await f.services.approvalsService.approveAction({ ...pending.input, expected_revision_id: pending.revision.id });
  await f.services.contactPolicyService.restrictContact({ organization_id: f.lead.organization_id, channel: "EMAIL", contact: { kind: "EMAIL", value: f.lead.email }, reason: "OPT_OUT", source: "MANUAL", source_event_id: "synthetic-optout" });
  assert.equal((await f.services.actionExecutor.execute(pending.action)).status, "BLOCKED"); assert.equal(calls, 0); assert.equal(await count(f, "action_executions"), 0);
  assert.equal((await f.services.intelligenceService.assessLead(f.lead)).snapshot.business_fit.status, "MATCHES_CRITERIA");
});

test("contact completeness does not alter fit and criteria remain workspace scoped", async t => {
  const f = await fixture(t, { criteria: rules }), a = await pipeline(f);
  const sparse = await f.services.leadsRepository.createLead({ organization_id: f.lead.organization_id, name: "Different recorded identity", email: null, company: null, phone: "+919876543210", source: "CSV" });
  await f.context.updateEnquiry({ organization_id: sparse.organization_id, lead_id: sparse.id, actor: f.actor, expected_revision: 0, reason: "Same synthetic enquiry facts", enquiry: f.enquiry });
  const b = await pipeline({ ...f, lead: sparse });
  assert.notEqual(a.snapshot.readiness_score, b.snapshot.readiness_score);
  assert.equal(a.snapshot.business_fit.status, b.snapshot.business_fit.status);
  assert.deepEqual(a.snapshot.business_fit.attention_priority, b.snapshot.business_fit.attention_priority);
  const foreign = await f.client.register("Independent fit workspace"), actor = { id: foreign.user.id, role: "OWNER" };
  await f.context.updateProfile({ organization_id: foreign.organization.id, actor, expected_revision: 0, reason: "Other business criteria", profile, fit_criteria: changedRules });
  assert.equal((await f.services.intelligenceService.assessLead(f.lead)).snapshot.id, a.snapshot.id);
});

test("criteria changes after authorization preserve delivery without creating obsolete automatic work", async t => {
  const f = await fixture(t, { criteria: rules }), approved = await action(f), sent = await f.services.actionExecutor.execute(approved.action);
  assert.equal(sent.dispatched, true); await configure(f, changedRules);
  await f.client.post("/api/actions/" + approved.action.id + "/callback", { organization_id: f.lead.organization_id, action_execution_id: sent.execution.id, provider_event_id: "criteria-late-delivery", status: "COMPLETED" });
  assert.equal((await f.services.executionsRepository.latestForAction(approved.action.id)).outcome_class, "DELIVERED");
  assert.equal((await f.db.get("SELECT status FROM channel_messages WHERE action_id=?", [approved.action.id])).status, "DELIVERED");
  assert.equal(await count(f, "follow_up_tasks"), 0);
});

test("criteria setup and current reads create no analysis, reviews or provider work", async t => {
  const f = await fixture(t), before = await count(f, "audit_logs");
  await configure(f, rules); await f.services.intelligenceService.assessLead(f.lead); await f.services.intelligenceRecommendationService.currentForLead(f.lead);
  assert.equal(await count(f, "intelligence_snapshots"), 0); assert.equal(await count(f, "actions"), 0); assert.equal(await count(f, "action_revisions"), 0); assert.equal(await count(f, "action_executions"), 0);
  assert.equal(await count(f, "audit_logs"), before + 1, "Only the explicit criteria-save audit is added");
});

for (const variation of ["omitted", "different"]) test("prepared review rejects an " + variation + " business-fit evaluator version without reusing its old approval", async t => {
  const f = await fixture(t, { criteria: rules }), reviewed = await action(f);
  await f.services.contactPolicyService.withWorkspacePolicyTransaction(f.lead.organization_id, async tx => {
    const service = new PreparedActionService(tx), action = await tx.get("SELECT * FROM actions WHERE id=?", [reviewed.action.id]);
    const input = await service.inputs(action);
    assert.equal(input.businessContextRevisions.business_fit_version, BUSINESS_FIT_VERSION);
    assert.equal((await service.requireCurrent(action, reviewed.revision.id)).id, reviewed.revision.id);
    const revisions = { ...input.businessContextRevisions };
    if (variation === "omitted") delete revisions.business_fit_version; else revisions.business_fit_version = BUSINESS_FIT_VERSION + 1;
    const fingerprint = service.contextFingerprint(action, input.lead, revisions, input.freshness);
    await tx.run("UPDATE action_revisions SET context_fingerprint=? WHERE id=?", [fingerprint, reviewed.revision.id]);
  });
  await assert.rejects(f.services.approvalsService.approveAction({ ...reviewed.input, expected_revision_id: reviewed.revision.id }), { code: "APPROVAL_REVISION_STALE" });
  let calls = 0; f.services.actionExecutor.adapter = { async invoke() { calls++; return { ok: true }; } };
  assert.equal((await f.services.actionExecutor.execute(reviewed.action)).status, "AWAITING_APPROVAL"); assert.equal(calls, 0); assert.equal(await count(f, "action_executions"), 0);
  assert.equal((await f.db.get("SELECT decision FROM action_revision_decisions WHERE action_revision_id=?", [reviewed.revision.id])).decision, "APPROVED");
  const renewed = await f.services.approvalsService.currentForAction(reviewed.input);
  assert.notEqual(renewed.prepared_revision.id, reviewed.revision.id);
  assert.equal(renewed.prepared_revision.envelope.body, reviewed.revision.envelope.body);
});

test("a customer's question remains due when business criteria do not match", async t => {
  const f = await fixture(t, { interest: "Chair repair" });
  await f.client.post("/api/inbound-events/mock", { organization_id: f.lead.organization_id, lead_id: f.lead.id, channel: "EMAIL", provider_event_id: "synthetic-fit-question", event_type: "QUESTION", payload: { text: "Can you explain the alternatives?" } });
  const original = await f.db.get("SELECT * FROM follow_up_tasks WHERE lead_id=? AND status='DUE'", [f.lead.id]);
  assert.ok(original); assert.equal(original.reason, "Answer the lead's question.");
  await configure(f, rules); f.lead = await f.services.leadsRepository.getLead(f.lead.id);
  assert.equal((await pipeline(f)).snapshot.business_fit.status, "DOES_NOT_MATCH");
  assert.deepEqual(await f.db.get("SELECT * FROM follow_up_tasks WHERE id=?", [original.id]), original);
  assert.equal(await count(f, "action_executions"), 0);
});
