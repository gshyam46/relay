import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { evaluationSourceHashes, FROZEN_CORPUS_SHA256 } from "./intelligenceEvaluation.js";

export const ENGINEERING_GRADER_VERSION = "l3.04-engineering-regression-v1";
export const FROZEN_BASELINE_SHA256 = "357a53147a4d583968cdca6c23799bd62a7ecefc4f675f46ae77b8f0444f7082";
const digest = value => createHash("sha256").update(value).digest("hex");
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const identity = value => digest(JSON.stringify(canonical(value)));
export function loadIntelligenceRegressionBaseline() {
  const bytes = readFileSync(new URL("../../test/fixtures/intelligence-quality/baseline-v1.json", import.meta.url));
  if (bytes.length > 65536 || digest(bytes) !== FROZEN_BASELINE_SHA256) throw new Error("Frozen engineering baseline integrity check failed.");
  const baseline = JSON.parse(bytes.toString("utf8"));
  if (baseline.version !== 1 || baseline.corpus_sha256 !== FROZEN_CORPUS_SHA256 || baseline.grader_version !== ENGINEERING_GRADER_VERSION) throw new Error("Frozen engineering baseline version is unsupported.");
  return baseline;
}
// The CLI recomputes in its isolated process and accepts no uploaded reports,
// customer cases, source overrides, model targets or baseline-update flag.
export function assessIntelligenceRegression(report) {
  const baseline = loadIntelligenceRegressionBaseline(), failures = [];
  const fail = code => { if (!failures.includes(code)) failures.push(code); };
  if (report?.corpus?.sha256 !== baseline.corpus_sha256 || report?.corpus?.origin !== "SYNTHETIC") fail("CORPUS_IDENTITY_MISMATCH");
  const actualSources = evaluationSourceHashes();
  if (!report?.versions?.source_sha256 || identity(report.versions.source_sha256) !== identity(actualSources)) fail("CANDIDATE_SOURCE_MISMATCH");
  if (report?.evaluation?.execution_mode !== "SYNTHETIC_INJECTED_ADAPTERS_ONLY" || report.evaluation.provider_calls !== 0 || report.evaluation.customer_data_used !== false || report.evaluation.adapters_overridden_for_test !== false) fail("UNSUPPORTED_EVALUATION_AUTHORITY");
  if (report?.synthetic_safety?.status !== "PASS" || report.synthetic_safety.failure_count !== 0 || report.synthetic_safety.failures?.length !== 0) fail("SYNTHETIC_SAFETY_REGRESSION");
  for (const mode of ["DEFAULT_LOCAL", "CONFIGURED_INJECTED_IDEAL_SUGGESTION"]) {
    const metrics = report?.reply_quality?.[mode]?.overall;
    if (!metrics) { fail("MISSING_REPLY_MODE:" + mode); continue; }
    for (const [key, expected] of Object.entries(baseline.denominators)) if (metrics[key] !== expected) fail("DENOMINATOR_CHANGED:" + mode + ":" + key);
    if (!Number.isInteger(metrics.labeled_correct) || metrics.labeled_correct < baseline.floors.labeled_correct || metrics.labeled_correct > baseline.denominators.labeled_messages) fail("LABELED_CORRECTNESS_REGRESSION:" + mode);
    if (!Number.isInteger(metrics.abstentions) || metrics.abstentions > baseline.floors.max_abstentions || metrics.abstentions < 0) fail("ABSTENTION_REGRESSION:" + mode);
    for (const key of ["invalid_outputs", "explicit_opt_out_misses", "false_opt_outs", "opt_outs_on_unlabeled_ambiguity"]) if (metrics[key] !== 0) fail("REPLY_SAFETY_REGRESSION:" + mode + ":" + key);
    for (const [label, floor] of Object.entries(baseline.floors.per_class)) {
      const item = metrics.per_class?.[label];
      if (!item || item.actual !== floor.actual) fail("CLASS_DENOMINATOR_CHANGED:" + mode + ":" + label);
      if (!Number.isInteger(item?.true_positives) || item.true_positives < floor.true_positives || item.true_positives > floor.actual) fail("CLASS_RECALL_REGRESSION:" + mode + ":" + label);
    }
  }
  if (report?.observations?.reply_messages?.length !== 92 || report?.observations?.reply_adapter_scenarios?.length !== 18 || report?.observations?.grounding?.length !== 48 || report?.observations?.composers?.length !== 12) fail("CHALLENGE_COVERAGE_CHANGED");
  if (report?.grounding_quality?.unsupported_claim_cases !== 0 || report?.grounding_quality?.unsupported_finding_cases !== 0) fail("UNSUPPORTED_FACT_REGRESSION");
  if (report?.external_quality?.hosted_model !== "NOT_MEASURED" || report?.external_quality?.customer_held_out !== "NOT_MEASURED" || report?.external_quality?.production_readiness !== "NOT_ESTABLISHED") fail("EXTERNAL_QUALITY_OVERCLAIM");
  return {
    version: 1, scope: "ENGINEERING_REGRESSION", status: failures.length ? "FAIL" : "PASS", failure_count: failures.length, failures,
    grader_version: ENGINEERING_GRADER_VERSION, baseline_version: baseline.version, baseline_sha256: FROZEN_BASELINE_SHA256,
    baseline_report_sha256: baseline.baseline_report_sha256, corpus_sha256: baseline.corpus_sha256,
    candidate_source_sha256: identity(actualSources), candidate_sources: actualSources,
    hosted_model_quality: "NOT_MEASURED", customer_generalization: "NOT_ESTABLISHED", release_authorization: "NOT_GRANTED"
  };
}
