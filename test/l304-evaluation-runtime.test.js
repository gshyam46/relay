import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startClient } from "./helpers/testClient.js";
import { IntelligenceEvaluationService, evaluationCandidateIdentity } from "../src/modules/intelligence-evaluation/evaluationService.js";
import { IntelligenceFeedbackService } from "../src/modules/intelligence-feedback/intelligenceFeedbackService.js";
import { feedbackHash } from "../src/modules/intelligence-feedback/intelligenceFeedbackContract.js";
import { LocalReplyClassifier } from "../src/modules/channels/replyClassifier.js";
import { InboundMessageService } from "../src/modules/channels/inboundMessageService.js";
import { AuditRepository } from "../src/modules/events/auditRepository.js";
import { EvaluationRepository } from "../src/modules/intelligence-evaluation/evaluationRepository.js";
import { scoreReplies } from "../src/modules/intelligence-evaluation/evaluationMetrics.js";

async function fixture(t) {
  const client = await startClient(t), who = await client.register("Synthetic reviewed evaluation"), org = who.organization.id, actor = { id: who.user.id, role: "OWNER" };
  return { client, db: client.db, org, actor, scope: { organization_id: org, actor }, service: new IntelligenceEvaluationService(client.db), feedback: new IntelligenceFeedbackService(client.db), inbound: new InboundMessageService({ db: client.db, replyClassifier: new LocalReplyClassifier() }) };
}
async function caseFor(f, { body = "What is the price?", expected = "QUESTION", lead = null, eval_use = "SYNTHETIC" } = {}) {
  lead ||= await f.client.services.leadsRepository.createLead({ organization_id: f.org, name: "Private synthetic person", email: randomUUID() + "@example.test", source: "MANUAL" });
  const result = await f.inbound.receiveInboundEvent({ organization_id: f.org, lead_id: lead.id, channel: "EMAIL", provider: "synthetic-review", provider_event_id: randomUUID(), payload: { text: body } });
  const scope = { ...f.scope, lead_id: lead.id, target_kind: "REPLY", target_id: result.message.id }, review = await f.feedback.review(scope);
  const labels = { correctness: expected === result.inbound_event.event_type ? "CORRECT" : "INCORRECT", usefulness: "USEFUL", expected_category: expected, eval_use };
  const saved = await f.feedback.record({ ...scope, review_token: review.review_token, expected_feedback_revision: 0, request_key: randomUUID(), operation: "RECORD", labels, reason: "Synthetic owner-reviewed category." });
  return { scope, body, lead, labels, feedback: saved.feedback, reference: { feedback_id: saved.feedback.id, revision: saved.feedback.revision } };
}
async function changeReview(f, item, { operation = "WITHDRAW", labels = null } = {}) {
  const review = await f.feedback.review(item.scope);
  return f.feedback.record({ ...item.scope, review_token: review.review_token, expected_feedback_revision: review.feedback.revision, request_key: randomUUID(), operation, labels, reason: "Synthetic review correction." });
}
function create(f, items, extra = {}) { return f.service.createDataset({ ...f.scope, name: "Reviewed replies", split: "DEV", expected_version: 0, request_key: randomUUID(), feedback_revisions: items.map(item => item.reference), ...extra }); }
function evaluate(f, dataset, extra = {}) { return f.service.evaluate({ ...f.scope, dataset_id: dataset.id, ...extra }); }
async function operationalState(f) {
  return Object.fromEntries(await Promise.all(["leads", "channel_messages", "inbound_events", "contact_restrictions", "actions", "follow_up_tasks", "domain_events", "ai_provider_attempts"].map(async table => [table, await f.db.all("SELECT * FROM " + table + " WHERE organization_id=? ORDER BY id", [f.org])])));
}
test("reviewed UNKNOWN is a correct review judgment and zero denominators remain unknown", () => {
  const scores = scoreReplies([{ expected: "OPT_OUT", actual: "UNKNOWN" }, { expected: "QUESTION", actual: "OPT_OUT" }, { expected: "UNKNOWN", actual: "UNKNOWN" }, { expected: "POSITIVE_REPLY", actual: "INVALID" }]);
  assert.equal(scores.correct, 1); assert.equal(scores.abstentions, 2); assert.equal(scores.expected_opt_outs, 1); assert.equal(scores.missed_expected_opt_outs, 1); assert.equal(scores.false_opt_outs, 1); assert.equal(scores.invalid_outputs, 1);
  assert.equal(scores.per_class.NEGATIVE_REPLY.precision, null); assert.equal(scores.per_class.NEGATIVE_REPLY.recall, null); assert.equal(scoreReplies([]).accuracy, null);
});
test("explicit immutable selection replays local rules without exposing cases or changing operational state", async t => {
  const f = await fixture(t), first = await caseFor(f, { body: "What is the private price of order SYNTHETIC-SECRET-814?" }), second = await caseFor(f, { body: "Maybe later", expected: "UNKNOWN" });
  const before = await operationalState(f), dataset = await create(f, [first, second]), result = await evaluate(f, dataset);
  assert.equal(dataset.case_count, 2); assert.equal(dataset.version, 1); assert.equal(dataset.labels_current, true);
  assert.equal(result.metrics.case_count, 2); assert.equal(result.metrics.baseline.kind, "RECORDED_OPERATIONAL_CLASS"); assert.equal(result.metrics.candidate.kind, "CURRENT_LOCAL_RULES");
  assert.equal(result.metrics.candidate.correct, 2); assert.equal(result.metrics.candidate.abstentions, 1); assert.equal(result.metrics.provider_calls, 0);
  assert.equal(result.metrics.hosted_model_quality, "NOT_MEASURED"); assert.equal(result.metrics.release_decision, "NOT_AUTHORIZED"); assert.deepEqual(result.candidate_versions, evaluationCandidateIdentity().candidate_versions);
  const allPublic = JSON.stringify([dataset, result, await f.service.listDatasets(f.scope), await f.service.listEvaluations({ ...f.scope, dataset_id: dataset.id })]);
  for (const secret of [first.body, first.lead.id, first.reference.feedback_id, "SYNTHETIC-SECRET-814", "case_sha256", "reply_text_sha256"]) assert.equal(allPublic.includes(secret), false, secret);
  assert.deepEqual(await operationalState(f), before);
  assert.deepEqual(await evaluate(f, dataset), result); assert.equal(Number((await f.db.get("SELECT count(*) n FROM intelligence_evaluations")).n), 1);
});
test("lost-response recovery and simultaneous create commands preserve one exact named version", async t => {
  const f = await fixture(t), item = await caseFor(f), key = randomUUID(), command = { ...f.scope, name: "Stable version", split: "DEV", expected_version: 0, request_key: key, feedback_revisions: [item.reference] };
  assert.deepEqual(await f.service.getDatasetRequest({ ...f.scope, request_key: key }), { dataset: null });
  const [one, two] = await Promise.all([f.service.createDataset(command), f.service.createDataset(command)]); assert.deepEqual(one, two);
  assert.equal((await f.service.getDatasetRequest({ ...f.scope, request_key: key })).dataset.id, one.id);
  await assert.rejects(f.service.createDataset({ ...command, name: "Changed intent" }), { code: "EVALUATION_REQUEST_CONFLICT" });
  await assert.rejects(f.service.createDataset({ ...command, request_key: randomUUID() }), { code: "EVALUATION_VERSION_STALE" });
  const next = await f.service.createDataset({ ...command, request_key: randomUUID(), expected_version: 1 }); assert.equal(next.version, 2); assert.notEqual(next.id, one.id);
  assert.equal((await f.service.getDataset({ ...f.scope, dataset_id: one.id })).version, 1);
});
test("permanent split protection covers the same enquiry and exact reply across other enquiries", async t => {
  const f = await fixture(t), first = await caseFor(f), sameLead = await caseFor(f, { body: "How much is delivery?", lead: first.lead }), sameText = await caseFor(f, { body: first.body });
  await create(f, [first], { split: "HOLDOUT" });
  await assert.rejects(create(f, [sameLead], { name: "Other", split: "DEV" }), { code: "EVALUATION_SPLIT_CONFLICT" });
  await assert.rejects(create(f, [sameText], { name: "Exact other", split: "DEV" }), { code: "EVALUATION_SPLIT_CONFLICT" });
  await assert.rejects(create(f, [first, sameText], { name: "Duplicate text", split: "HOLDOUT" }), { code: "EVALUATION_REQUEST_INVALID" });
  await changeReview(f, first);
  await assert.rejects(create(f, [sameLead], { name: "After withdrawal", split: "DEV" }), { code: "EVALUATION_SPLIT_CONFLICT" });
});
test("concurrent protected replays consume shared groups once across dataset wrappers", async t => {
  const f = await fixture(t), item = await caseFor(f), first = await create(f, [item], { name: "Protected A", split: "HOLDOUT" }), second = await create(f, [item], { name: "Protected B", split: "HOLDOUT" });
  const attempts = await Promise.allSettled([evaluate(f, first), evaluate(f, second)]);
  assert.equal(attempts.filter(item => item.status === "fulfilled").length, 1); assert.equal(attempts.find(item => item.status === "rejected").reason.code, "EVALUATION_HOLDOUT_CONSUMED");
  const won = attempts[0].status === "fulfilled" ? first : second, lost = won.id === first.id ? second : first;
  const [a, b] = await Promise.all([evaluate(f, won), evaluate(f, won)]); assert.equal(a.id, b.id);
  assert.equal((await f.service.getDataset({ ...f.scope, dataset_id: lost.id })).can_evaluate, false);
  assert.equal(Number((await f.db.get("SELECT count(*) n FROM intelligence_evaluations")).n), 1);
  const newer = await create(f, [item], { name: won.name, expected_version: 1, split: "HOLDOUT" }); await assert.rejects(evaluate(f, newer), { code: "EVALUATION_HOLDOUT_CONSUMED" });
});
test("evaluation and dataset audit failure roll back result, version and protected consumption together", async t => {
  const f = await fixture(t), item = await caseFor(f), oldRecord = AuditRepository.prototype.record;
  let failure = "IntelligenceEvaluationDatasetCreated";
  AuditRepository.prototype.record = async function(input) { if (input.event_type === failure) throw new Error("Synthetic audit failure"); return oldRecord.call(this, input); };
  try {
    await assert.rejects(create(f, [item], { split: "HOLDOUT" }), /Synthetic audit failure/);
    assert.equal(Number((await f.db.get("SELECT count(*) n FROM intelligence_evaluation_datasets")).n), 0); assert.equal(Number((await f.db.get("SELECT count(*) n FROM intelligence_evaluation_groups")).n), 0);
    failure = "IntelligenceEvaluationRecorded"; const dataset = await create(f, [item], { split: "HOLDOUT" });
    await assert.rejects(evaluate(f, dataset), /Synthetic audit failure/);
    assert.equal(Number((await f.db.get("SELECT count(*) n FROM intelligence_evaluations")).n), 0);
    assert.equal(Number((await f.db.get("SELECT count(*) n FROM intelligence_evaluation_groups WHERE consumed_evaluation_id IS NOT NULL")).n), 0);
    failure = null; assert.equal((await evaluate(f, dataset)).metrics.candidate.correct, 1);
  } finally { AuditRepository.prototype.record = oldRecord; }
});
test("relabeling and withdrawal block new runs, preserve historical metrics and never release protected splits", async t => {
  const f = await fixture(t), item = await caseFor(f), dataset = await create(f, [item]), unrun = await create(f, [item], { name: "Unrun" }), result = await evaluate(f, dataset);
  await changeReview(f, item);
  assert.equal((await f.service.getDataset({ ...f.scope, dataset_id: unrun.id })).hold_reason, "EVALUATION_LABELS_CHANGED");
  await assert.rejects(evaluate(f, unrun), { code: "EVALUATION_LABELS_CHANGED" });
  const replay = await evaluate(f, dataset); assert.equal(replay.id, result.id); assert.equal(replay.labels_current, false); assert.deepEqual(replay.metrics, result.metrics);
  const restored = await changeReview(f, item, { operation: "RECORD", labels: item.labels });
  assert.equal((await f.service.getDataset({ ...f.scope, dataset_id: dataset.id })).labels_current, false);
  await assert.rejects(create(f, [item], { name: "Old label" }), { code: "EVALUATION_LABELS_CHANGED" });
  const current = await create(f, [{ reference: { feedback_id: restored.feedback.id, revision: restored.feedback.revision } }], { name: "Current labels" }); assert.equal(current.labels_current, true);
});
test("owner/tenant authority, strict requests and pagination refuse forged scope or measurements", async t => {
  const f = await fixture(t), item = await caseFor(f), dataset = await create(f, [item]), other = await f.client.register("Other synthetic review owner"), foreign = { organization_id: other.organization.id, actor: { id: other.user.id, role: "OWNER" } };
  await assert.rejects(f.service.getDataset({ ...foreign, dataset_id: dataset.id }), { code: "EVALUATION_NOT_FOUND" });
  await assert.rejects(f.service.listDatasets({ ...f.scope, actor: foreign.actor }), { code: "EVALUATION_OWNER_REQUIRED" });
  await assert.rejects(evaluate(f, dataset, { metrics: { correct: 100 } }), { code: "EVALUATION_REQUEST_INVALID" });
  await assert.rejects(evaluate(f, dataset, { candidate_source_sha256: "a".repeat(64) }), { code: "EVALUATION_REQUEST_INVALID" });
  await assert.rejects(f.service.listDatasets({ ...f.scope, limit: 51 }), { code: "EVALUATION_REQUEST_INVALID" });
  await assert.rejects(f.service.getDatasetRequest({ ...f.scope, actor: { ...f.actor, role: "MEMBER" }, request_key: "unknown" }), { code: "EVALUATION_OWNER_REQUIRED" });
  await assert.rejects(create(f, [], { name: "Empty" }), { code: "EVALUATION_LIMIT" });
  await assert.rejects(create(f, Array(101).fill(item), { name: "Excess" }), { code: "EVALUATION_LIMIT" });
  await assert.rejects(create(f, [item, item], { name: "Duplicates" }), { code: "EVALUATION_REQUEST_INVALID" });
  const next = await create(f, [item], { name: "Next" }), page = await f.service.listDatasets({ ...f.scope, limit: 1 });
  assert.equal(page.has_more, true); assert.equal(page.items.length, 1);
  const tail = await f.service.listDatasets({ ...f.scope, limit: 1, before_dataset_id: page.next_before_dataset_id }); assert.equal(tail.items.length, 1); assert.notEqual(tail.items[0].id, page.items[0].id);
  assert.ok([dataset.id, next.id].includes(tail.items[0].id));
});
test("metadata-first aggregate cap refuses large private snapshots before any replay source materialization", async t => {
  const f = await fixture(t), items = [];
  for (let i = 0; i < 5; i++) {
    const item = await caseFor(f, { body: "What is price number " + i + "?" }); items.push(item);
    const row = await f.db.get("SELECT snapshot_json FROM intelligence_feedback_targets WHERE id=?", [item.reference.feedback_id]), snapshot = JSON.parse(row.snapshot_json); snapshot.synthetic_padding = "x".repeat(900000);
    await f.db.run("UPDATE intelligence_feedback_targets SET snapshot_json=?,source_sha256=? WHERE id=?", [JSON.stringify(snapshot), feedbackHash(snapshot), item.reference.feedback_id]);
  }
  const original = EvaluationRepository.prototype.feedback; let materialized = 0;
  EvaluationRepository.prototype.feedback = function(...args) { materialized++; return original.apply(this, args); };
  try { await assert.rejects(create(f, items), { code: "EVALUATION_LIMIT" }); assert.equal(materialized, 0); } finally { EvaluationRepository.prototype.feedback = original; }
  assert.equal(Number((await f.db.get("SELECT count(*) n FROM intelligence_evaluation_datasets")).n), 0);
});
test("corrupt frozen manifest and exact case digest fail closed without minting evaluation evidence", async t => {
  const f = await fixture(t), item = await caseFor(f), dataset = await create(f, [item]);
  await f.db.run("UPDATE intelligence_evaluation_members SET case_sha256=? WHERE dataset_id=?", ["0".repeat(64), dataset.id]);
  await assert.rejects(evaluate(f, dataset), { code: "EVALUATION_STATE_INVALID" });
  assert.equal(Number((await f.db.get("SELECT count(*) n FROM intelligence_evaluations")).n), 0);
});

test("malformed rehashed private reply objects and extra stored aggregate fields never become public evidence", async t => {
  const f = await fixture(t), item = await caseFor(f), source = await f.db.get("SELECT snapshot_json FROM intelligence_feedback_targets WHERE id=?", [item.reference.feedback_id]), snapshot = JSON.parse(source.snapshot_json);
  const corrupted = structuredClone(snapshot); corrupted.reply.hidden_text = "Private unrelated source";
  await f.db.run("UPDATE intelligence_feedback_targets SET snapshot_json=?,source_sha256=? WHERE id=?", [JSON.stringify(corrupted), feedbackHash(corrupted), item.reference.feedback_id]);
  await assert.rejects(create(f, [item]), { code: "EVALUATION_CASE_INELIGIBLE" });
  await f.db.run("UPDATE intelligence_feedback_targets SET snapshot_json=?,source_sha256=? WHERE id=?", [JSON.stringify(snapshot), feedbackHash(snapshot), item.reference.feedback_id]);
  const dataset = await create(f, [item]), result = await evaluate(f, dataset), badMetrics = { ...result.metrics, private_reply: "Private unrelated source" };
  await f.db.run("UPDATE intelligence_evaluations SET metrics_json=? WHERE id=?", [JSON.stringify(badMetrics), result.id]);
  await assert.rejects(f.service.listEvaluations({ ...f.scope, dataset_id: dataset.id }), { code: "EVALUATION_STATE_INVALID" });
  await assert.rejects(evaluate(f, dataset), { code: "EVALUATION_STATE_INVALID" });
});
test("recorded opt-out remains restricted when a review expects a different category", async t => {
  const f = await fixture(t), item = await caseFor(f, { body: "Please stop contacting me", expected: "QUESTION" }), before = await operationalState(f), dataset = await create(f, [item]), result = await evaluate(f, dataset);
  assert.equal(result.metrics.candidate.false_opt_outs, 1); assert.equal(result.metrics.candidate.correct, 0); assert.equal(result.metrics.baseline.false_opt_outs, 1);
  assert.ok(before.contact_restrictions.length > 0); assert.deepEqual(await operationalState(f), before);
});
