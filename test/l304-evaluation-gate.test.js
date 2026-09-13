import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { evaluateIntelligenceCorpus } from "../scripts/helpers/intelligenceEvaluation.js";
import { assessIntelligenceRegression, loadIntelligenceRegressionBaseline, FROZEN_BASELINE_SHA256 } from "../scripts/helpers/intelligenceRegressionGate.js";

const accepted = await evaluateIntelligenceCorpus();
test("baseline is an immutable prior report/source snapshot and current fixed engineering replay passes", () => {
  const bytes = readFileSync(new URL("./fixtures/intelligence-quality/baseline-v1.json", import.meta.url)), baseline = loadIntelligenceRegressionBaseline();
  assert.equal(createHash("sha256").update(bytes).digest("hex"), FROZEN_BASELINE_SHA256);
  assert.equal(baseline.denominators.messages, 46); assert.equal(baseline.denominators.labeled_messages, 35); assert.equal(baseline.floors.labeled_correct, 26); assert.equal(baseline.floors.max_abstentions, 20);
  assert.equal(baseline.floors.per_class.OPT_OUT.true_positives, 17); assert.ok(Object.keys(baseline.baseline_versions.source_sha256).length >= 15);
  const result = assessIntelligenceRegression(accepted); assert.deepEqual(result.failures, []); assert.equal(result.status, "PASS"); assert.equal(result.scope, "ENGINEERING_REGRESSION");
  assert.equal(result.hosted_model_quality, "NOT_MEASURED"); assert.equal(result.customer_generalization, "NOT_ESTABLISHED"); assert.equal(result.release_authorization, "NOT_GRANTED");
});
test("safe abstention alone cannot erase measured class recall or coverage floors", () => {
  const report = structuredClone(accepted), scores = report.reply_quality.DEFAULT_LOCAL.overall;
  scores.labeled_correct--; scores.abstentions++; scores.per_class.POSITIVE_REPLY.true_positives--;
  const result = assessIntelligenceRegression(report);
  assert.equal(result.status, "FAIL"); assert.ok(result.failures.includes("LABELED_CORRECTNESS_REGRESSION:DEFAULT_LOCAL")); assert.ok(result.failures.includes("ABSTENTION_REGRESSION:DEFAULT_LOCAL"));
  assert.ok(result.failures.includes("CLASS_RECALL_REGRESSION:DEFAULT_LOCAL:POSITIVE_REPLY"));
});
test("changed denominators, unsupported facts and policy errors fail independently of an optimistic top-level status", () => {
  const report = structuredClone(accepted);
  report.reply_quality.DEFAULT_LOCAL.overall.explicit_opt_outs = 16;
  report.reply_quality.DEFAULT_LOCAL.overall.false_opt_outs = 1;
  report.grounding_quality.unsupported_claim_cases = 1;
  const result = assessIntelligenceRegression(report); assert.equal(result.status, "FAIL");
  assert.ok(result.failures.includes("DENOMINATOR_CHANGED:DEFAULT_LOCAL:explicit_opt_outs")); assert.ok(result.failures.includes("REPLY_SAFETY_REGRESSION:DEFAULT_LOCAL:false_opt_outs")); assert.ok(result.failures.includes("UNSUPPORTED_FACT_REGRESSION"));
});
test("stale source report, changed corpus, omitted challenges and model/customer overclaims cannot satisfy the gate", () => {
  for (const [mutate, expected] of [
    [r => { r.versions.source_sha256["src/modules/channels/replyClassifier.js"] = "0".repeat(64); }, "CANDIDATE_SOURCE_MISMATCH"],
    [r => { r.corpus.sha256 = "1".repeat(64); }, "CORPUS_IDENTITY_MISMATCH"],
    [r => { r.observations.reply_adapter_scenarios.pop(); }, "CHALLENGE_COVERAGE_CHANGED"],
    [r => { r.external_quality.hosted_model = "PASS"; }, "EXTERNAL_QUALITY_OVERCLAIM"],
    [r => { r.evaluation.provider_calls = 1; }, "UNSUPPORTED_EVALUATION_AUTHORITY"],
    [r => { r.evaluation.adapters_overridden_for_test = true; }, "UNSUPPORTED_EVALUATION_AUTHORITY"]
  ]) {
    const report = structuredClone(accepted); mutate(report); const result = assessIntelligenceRegression(report);
    assert.equal(result.status, "FAIL"); assert.ok(result.failures.includes(expected), expected);
  }
});
test("invalid or missing evaluation reports fail closed and independent baseline objects cannot change accepted floors", () => {
  assert.equal(assessIntelligenceRegression(null).status, "FAIL");
  const mutable = loadIntelligenceRegressionBaseline(); mutable.floors.labeled_correct = 0;
  assert.equal(loadIntelligenceRegressionBaseline().floors.labeled_correct, 26);
  assert.equal(assessIntelligenceRegression({}).status, "FAIL");
});
