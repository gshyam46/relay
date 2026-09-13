import { LlmSynthesisAgent } from "../src/modules/ai/llmSynthesisAgent.js";
import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";
import { BusinessContextService } from "../src/modules/business-context/businessContextService.js";
import { createCurrentIntelligenceServices } from "../src/modules/lead-intelligence/currentIntelligence.js";
import { PreparedActionService } from "../src/modules/outbound-automation/preparedActionService.js";
import { ResearchEvidenceRepository } from "../src/modules/lead-intelligence/researchEvidenceRepository.js";
import { evaluateFreshness } from "../src/modules/lead-intelligence/freshnessService.js";
import { buildGroundedContext, validateSelection, renderGroundedSynthesis } from "../src/modules/ai/grounding.js";

const TTL = 90 * 24 * 60 * 60 * 1000;
const stages = [
  ["synthesisService", "synthesisAgent", "synthesize", "runForLead", "synthesisRepository"],
  ["intelligenceRecommendationService", "recommendationAgent", "recommend", "runForLead", "recommendationRepository"],
  ["nextBestActionService", "actionPlanner", "plan", "planForLead", "nextBestActionRepository"]
];
function unknown() { return Object.fromEntries(["interest", "location", "budget", "timeline", "enquiry_date", "last_interaction"].map(field => [field, { state: "UNKNOWN", value: null, provenance: null }])); }
function known(value, observed_at, assertion = "CUSTOMER_STATED") { return { state: "KNOWN", value, provenance: { assertion, source_type: "MANUAL", source_reference: "Synthetic recorded conversation", observed_at } }; }
function barrier() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
async function fixture(t, { context = true } = {}) {
  const client = await startClient(t), identity = await client.register("Synthetic freshness runtime");
  const lead = await client.services.leadsRepository.createLead({ organization_id: identity.organization.id, name: "Recorded person", company: "Recorded company", email: "recorded@example.test", source: "MANUAL" });
  const f = { client, db: client.db, services: client.services, lead, actor: { id: identity.user.id, role: "OWNER" }, ms: Date.now(), revision: 0 };
  f.now = () => f.ms; f.observed = f.ms - 1000; f.expiry = f.observed + TTL;
  f.context = new BusinessContextService(f.db, { now: f.now });
  for (const name of ["intelligenceService", "synthesisService", "intelligenceRecommendationService", "nextBestActionService", "actionExecutor", "channelWorkflowService"]) f.services[name].now = f.now;
  f.enquiry = { ...unknown(), interest: known("A dining table", new Date(f.observed).toISOString()) };
  if (context) await save(f);
  return f;
}
async function save(f) { await f.context.updateEnquiry({ organization_id: f.lead.organization_id, lead_id: f.lead.id, actor: f.actor, expected_revision: f.revision, reason: "Recorded synthetic source", enquiry: f.enquiry }); f.revision++; }
async function pipeline(f) {
  const snapshot = await f.services.intelligenceService.runForLead(f.lead);
  const synthesis = await f.services.synthesisService.runForLead(f.lead);
  const recommendation = await f.services.intelligenceRecommendationService.runForLead(f.lead);
  const plan = await f.services.nextBestActionService.planForLead(f.lead);
  return { snapshot, synthesis, recommendation, plan };
}
async function prerequisites(f, stage) {
  await f.services.intelligenceService.runForLead(f.lead);
  if (stage !== "synthesisService") await f.services.synthesisService.runForLead(f.lead);
  if (stage === "nextBestActionService") await f.services.intelligenceRecommendationService.runForLead(f.lead);
}
async function research(f, { value = f.lead.company, observed = new Date(f.observed).toISOString(), state = "PERSISTED" } = {}) {
  const repo = new ResearchEvidenceRepository(f.db);
  const ingestion = await repo.createIngestion({ organization_id: f.lead.organization_id, lead_id: f.lead.id, adapter_type: "APPROVED_RESEARCH", provider_key: "APPROVED_MANUAL_RESEARCH", idempotency_key: "synthetic:" + Math.random() });
  const item = await repo.createEvidenceItem({ organization_id: f.lead.organization_id, lead_id: f.lead.id, ingestion_id: ingestion.id, source_type: "APPROVED_RESEARCH", source_reference: "Synthetic research record", title: "Recorded company", claim_field: "COMPANY_NAME", claim_value: value, confidence: "HIGH", evidence_timestamp: observed });
  await repo.updateIngestionState(ingestion.id, { state, completed: true }); return item;
}
async function reply(f) { return f.services.inboundEventsRepository.create({ organization_id: f.lead.organization_id, lead_id: f.lead.id, channel: "EMAIL", provider_event_id: "synthetic:" + Math.random(), event_type: "QUESTION", received_at: new Date(f.ms).toISOString(), payload: { text: "A new source question" } }); }
async function approval(f, method, input) {
  return f.services.approvalsService.unitOfWork.run(({ approvalsService }) => { approvalsService.prepared.now = f.now; return approvalsService[method](input); }, { organization_id: f.lead.organization_id });
}
async function approved(f, { scheduled_at = null } = {}) {
  const action = await f.services.actionsRepository.createAction({ organization_id: f.lead.organization_id, lead_id: f.lead.id, type: "SEND_EMAIL", status: "AWAITING_APPROVAL", approval_requirement: "REQUIRED", scheduled_at, idempotency_key: "freshness:" + Math.random(), payload: { subject: "Reviewed question", message: "Would this still be useful?", mock_behavior: "SUCCESS" } });
  const input = { organization_id: f.lead.organization_id, action_id: action.id, reviewer_user_id: f.actor.id };
  const preview = await approval(f, "currentForAction", input);
  await approval(f, "approveAction", { ...input, expected_revision_id: preview.prepared_revision.id });
  return { action, input, revision: preview.prepared_revision };
}
async function current(f) { return createCurrentIntelligenceServices(f.db, { now: f.now }); }
async function count(f, table) { return Number((await f.db.get("SELECT COUNT(*) n FROM " + table)).n); }

test("unchanged refresh reuses all artifacts, exact expiry invalidates and clock rollback cannot revive them", async t => {
  const f = await fixture(t), before = await pipeline(f), audits = await count(f, "audit_logs");
  f.ms += 60000; const repeated = await pipeline(f);
  for (const key of Object.keys(before)) assert.equal(repeated[key].id, before[key].id);
  assert.equal(await count(f, "audit_logs"), audits);
  f.ms = f.expiry; let services = await current(f);
  assert.equal((await services.synthesisService.currentForLead(f.lead)).synthesis, null);
  assert.equal((await services.intelligenceRecommendationService.currentForLead(f.lead)).intelligence_recommendation, null);
  assert.equal((await services.nextBestActionService.currentForLead(f.lead)).next_best_action_plan, null);
  f.ms = f.observed; services = await current(f);
  assert.equal((await services.intelligenceService.assessLead(f.lead)).snapshot, null);
  const refreshed = await pipeline(f); assert.notEqual(refreshed.snapshot.id, before.snapshot.id);
  assert.equal(refreshed.snapshot.freshness.facts.interest.freshness, "STALE");
  assert.equal(refreshed.snapshot.freshness.facts.interest.observed_at, f.enquiry.interest.provenance.observed_at);
  assert.equal(refreshed.snapshot.claims.some(item => item.field === "ENQUIRY_INTEREST"), false);
  assert.ok(refreshed.synthesis.qualification.review_flags.includes("STALE:interest"));
  assert.equal((await pipeline(f)).plan.id, refreshed.plan.id);
});

for (const [stage, agent, method, run] of stages) for (const mutation of ["expiry", "research", "reply"]) {
  test(stage + " rejects " + mutation + " arriving during model generation without superseding the newer result", { timeout: 20000 }, async t => {
    const f = await fixture(t); await prerequisites(f, stage);
    const service = f.services[stage], original = service[agent], entered = barrier(), release = barrier();
    service[agent] = { async [method](input) { entered.release(); await release.promise; return original[method](input); } };
    const running = service[run](f.lead), rejected = assert.rejects(running, { code: "INTELLIGENCE_CONTEXT_CHANGED" });
    await entered.promise;
    try {
      if (mutation === "expiry") f.ms = f.expiry;
      else if (mutation === "research") await research(f);
      else await reply(f);
      service[agent] = original;
      const newer = await pipeline(f); f.newer = newer;
    } finally { release.release(); }
    await rejected;
    const services = await current(f);
    assert.equal((await services.nextBestActionService.currentForLead(f.lead)).next_best_action_plan.id, f.newer.plan.id);
  });
}

for (const [stage, agent, method, run, repo] of stages) test(stage + " cached reuse rechecks source authority under the gate", async t => {
  const f = await fixture(t); await pipeline(f); const service = f.services[stage], original = service[repo].findByFingerprint.bind(service[repo]);
  service[repo].findByFingerprint = async input => { const result = await original(input); f.ms = f.expiry; return result; };
  service[agent] = { [method]() { throw new Error("A cache hit must not call a model"); } };
  await assert.rejects(service[run](f.lead), { code: "INTELLIGENCE_CONTEXT_CHANGED" });
});

test("first observed expiry in a rejected approval remains durable after domain rollback and clock rollback", async t => {
  const f = await fixture(t), reviewed = await approved(f), original = await f.db.get("SELECT * FROM action_revisions WHERE id=?", [reviewed.revision.id]);
  f.ms = f.expiry;
  await assert.rejects(approval(f, "approveAction", { ...reviewed.input, expected_revision_id: reviewed.revision.id }), { code: "APPROVAL_REVISION_STALE" });
  f.ms = f.observed;
  await assert.rejects(approval(f, "approveAction", { ...reviewed.input, expected_revision_id: reviewed.revision.id }), { code: "APPROVAL_REVISION_STALE" });
  assert.deepEqual(await f.db.get("SELECT * FROM action_revisions WHERE id=?", [reviewed.revision.id]), original);
  assert.equal(await count(f, "action_revision_decisions"), 1);
  const reopened = await approval(f, "currentForAction", reviewed.input);
  assert.notEqual(reopened.prepared_revision.id, reviewed.revision.id); assert.equal(reopened.prepared_revision.envelope.body, reviewed.revision.envelope.body);
  await approval(f, "approveAction", { ...reviewed.input, expected_revision_id: reopened.prepared_revision.id });
  const validated = await f.services.contactPolicyService.withWorkspacePolicyTransaction(f.lead.organization_id, async tx => {
    const service = new PreparedActionService(tx, { now: f.now }), action = await tx.get("SELECT * FROM actions WHERE id=?", [reviewed.action.id]);
    return service.validateForDispatch({ action, ...await service.inputs(action) });
  });
  assert.equal(validated.revision_id, reopened.prepared_revision.id, "Explicit review can authorize a question without inventing fresh customer facts");
});

test("an approved scheduled send aging before dispatch is held without an attempt or provider call", async t => {
  const f = await fixture(t), reviewed = await approved(f, { scheduled_at: new Date(f.ms + 60000).toISOString() });
  let sends = 0; f.services.actionExecutor.adapter = { async invoke() { sends++; return { ok: true }; } };
  f.ms = f.expiry; const result = await f.services.actionExecutor.execute(reviewed.action);
  assert.equal(result.status, "AWAITING_APPROVAL"); assert.equal(sends, 0); assert.equal(await count(f, "action_executions"), 0);
});

for (const mutation of ["expiry", "research"]) test("late delivered callback after " + mutation + " preserves delivery and creates no obsolete follow-up", async t => {
  const f = await fixture(t, { context: mutation === "expiry" }), reviewed = await approved(f);
  const sent = await f.services.actionExecutor.execute(reviewed.action); assert.equal(sent.dispatched, true);
  if (mutation === "expiry") f.ms = f.expiry; else await research(f);
  const callback = { organization_id: f.lead.organization_id, action_execution_id: sent.execution.id, provider_event_id: "freshness-late-delivery", status: "COMPLETED" };
  await f.client.post("/api/actions/" + reviewed.action.id + "/callback", callback);
  await f.client.post("/api/actions/" + reviewed.action.id + "/callback", callback);
  assert.equal((await f.services.executionsRepository.latestForAction(reviewed.action.id)).outcome_class, "DELIVERED");
  assert.equal((await f.db.get("SELECT * FROM channel_messages WHERE action_id=?", [reviewed.action.id])).status, "DELIVERED");
  assert.equal(await count(f, "follow_up_tasks"), 0);
});

test("undated, future-at-recording, failed research and conflicted or inferred enquiry sources never become asserted findings", async t => {
  const f = await fixture(t, { context: false });
  f.enquiry = { ...unknown(), interest: { state: "CONFLICTED", alternatives: [known("A table", new Date(f.observed).toISOString()), known("A desk", new Date(f.observed).toISOString())].map(({ value, provenance }) => ({ value, provenance })) }, timeline: known({ description: "Soon", target_date: null }, new Date(f.observed).toISOString(), "INFERRED") };
  await save(f);
  const undated = await research(f, { observed: null });
  const future = await research(f, { observed: new Date(f.ms + 60000).toISOString() });
  const failed = await research(f, { state: "FAILED" });
  let result = await pipeline(f);
  for (const item of [undated, future, failed]) assert.equal(result.synthesis.findings.some(finding => finding.evidence_refs.includes("research_evidence:" + item.id)), false);
  assert.equal(result.synthesis.findings.some(item => ["ENQUIRY_INTEREST", "ENQUIRY_TIMELINE"].includes(item.field)), false);
  assert.ok(result.synthesis.qualification.review_flags.includes("CONFLICTED_FACT:interest"));
  assert.ok(result.synthesis.qualification.review_flags.includes("INFERRED_FACT:timeline"));
  f.ms += 120000; result = await pipeline(f);
  assert.equal(result.snapshot.freshness.research.find(item => item.id === future.id).freshness, "FUTURE_DATED");
  assert.equal((await evaluateFreshness(f.db, f.lead, { now: f.now })).research.find(item => item.id === failed.id).usable, false);
});

test("exact selector and renderer cannot promote one of two conflicting recorded values", async t => {
  const f = await fixture(t, { context: false }), result = await pipeline(f);
  const base = buildGroundedContext({ lead: f.lead, snapshot: result.snapshot });
  const company = base.findings.find(item => item.field === "COMPANY_NAME");
  const context = { ...base, conflicts: ["COMPANY_NAME"], findings: [...base.findings, { ...company, value: "Another recorded company" }] };
  assert.throws(() => validateSelection({ selected_claims: [{ field: company.field, value: company.value, evidence_refs: company.evidence_refs }] }, context), /MODEL_OUTPUT_REJECTED/);
  const rendered = renderGroundedSynthesis({ lead: f.lead, context, selected: [company], mode: "DETERMINISTIC_EXTRACTIVE" });
  assert.deepEqual(rendered.summary.claims, []); assert.equal(rendered.qualification.outcome, "NEEDS_REVIEW");
});

for (const [stage, agent, method, run] of stages) test(stage + " rejects changed parent content even when source and persisted input fingerprint stay identical", async t => {
  const f = await fixture(t); await prerequisites(f, stage);
  const service = f.services[stage], original = service[agent], entered = barrier(), release = barrier();
  const before = await service.buildInput(f.lead), authority = await evaluateFreshness(f.db, f.lead, { now: f.now });
  service[agent] = { async [method](input) { entered.release(); await release.promise; return original[method](input); } };
  const running = service[run](f.lead), rejected = assert.rejects(running, { code: "INTELLIGENCE_CONTEXT_CHANGED" });
  await entered.promise;
  try {
    // Simulate a concurrent artifact finalization, independently of saved source revisions.
    await f.services.contactPolicyService.withWorkspacePolicyTransaction(f.lead.organization_id, async tx => {
      if (stage === "synthesisService") await tx.run("UPDATE intelligence_claims SET confidence='MEDIUM' WHERE snapshot_id=? AND field='LEAD_NAME'", [before.snapshot.id]);
      else if (stage === "intelligenceRecommendationService") await tx.run("UPDATE intelligence_synthesis_runs SET summary_json=? WHERE id=?", [JSON.stringify({ ...before.synthesis.summary, text: "Re-rendered supported source summary" }), before.synthesis.id]);
      else await tx.run("UPDATE intelligence_recommendation_runs SET personalization_json=? WHERE id=?", [JSON.stringify([{ label: "Recorded name", value: f.lead.name, evidence_refs: before.snapshot.claims.find(item => item.field === "LEAD_NAME").evidence_ids.map(id => "snapshot_evidence:" + id) }]), before.intelligence_recommendation.id]);
    });
    assert.equal((await evaluateFreshness(f.db, f.lead, { now: f.now })).authority_fingerprint, authority.authority_fingerprint);
    assert.equal((await service.buildInput(f.lead)).input_fingerprint, before.input_fingerprint);
  } finally { release.release(); }
  await rejected;
});

test("configured extractive provider output crossing expiry is rejected after returning outside the workspace gate", async t => {
  const f = await fixture(t, { context: false }); await research(f); await f.services.intelligenceService.runForLead(f.lead);
  const entered = barrier(), release = barrier(); let calls = 0;
  f.services.synthesisService.synthesisAgent = new LlmSynthesisAgent({ async jsonCompletion({ messages }) {
    calls++; const source = JSON.parse(messages[1].content).findings[0]; entered.release(); await release.promise;
    return { selected_claims: [{ field: source.field, value: source.value, evidence_refs: source.evidence_refs }] };
  } });
  const running = f.services.synthesisService.runForLead(f.lead), rejected = assert.rejects(running, { code: "INTELLIGENCE_CONTEXT_CHANGED" });
  await entered.promise; f.ms = f.expiry;
  try { assert.equal((await evaluateFreshness(f.db, f.lead, { now: f.now })).research[0].freshness, "STALE"); }
  finally { release.release(); }
  await rejected; assert.equal(calls, 1);
});

for (const corruption of ["clock", "context"]) test("unverifiable " + corruption + " preserves a late delivery fact without granting automatic follow-up authority", async t => {
  const f = await fixture(t), reviewed = await approved(f), sent = await f.services.actionExecutor.execute(reviewed.action);
  if (corruption === "clock") await f.db.run("UPDATE workspace_freshness_clocks SET high_water_at=? WHERE organization_id=?", ["x".repeat(24), f.lead.organization_id]);
  else await f.db.run("UPDATE lead_enquiry_revisions SET enquiry_json='{}' WHERE organization_id=? AND lead_id=?", [f.lead.organization_id, f.lead.id]);
  await f.client.post("/api/actions/" + reviewed.action.id + "/callback", { organization_id: f.lead.organization_id, action_execution_id: sent.execution.id, provider_event_id: "unverifiable-source-delivery", status: "COMPLETED" });
  assert.equal((await f.services.executionsRepository.latestForAction(reviewed.action.id)).outcome_class, "DELIVERED");
  assert.equal((await f.db.get("SELECT status FROM channel_messages WHERE action_id=?", [reviewed.action.id])).status, "DELIVERED");
  assert.equal(await count(f, "follow_up_tasks"), 0);
});
