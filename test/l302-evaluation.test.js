import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadIntelligenceCorpus, evaluateIntelligenceCorpus, FROZEN_CORPUS_SHA256 } from "../scripts/helpers/intelligenceEvaluation.js";
import { replyMetrics, replyBreakdown, unsupportedClaims, exactEvidence, evaluationExitCode } from "../scripts/helpers/intelligenceEvaluationMetrics.js";
import { parseEvaluationArgs, serializeEvaluationReport, REPORT_MAX_BYTES } from "../scripts/helpers/intelligenceEvaluationIO.js";
import { safeTestEnvironment } from "../scripts/helpers/testSafety.js";

const corpus = loadIntelligenceCorpus();
const unknown = () => ({ event_type: "UNKNOWN", confidence: "LOW", evidence: null, candidate: null, review_required: true, generation: { mode: "DETERMINISTIC_FALLBACK", reason: "SIMULATED_ABSTENTION", reply_policy_version: "test-only", prompt_version: null } });
const row = (gold_class, event_type, extra = {}) => ({ gold_class, event_type, explicit_opt_out: gold_class === "OPT_OUT", candidate: null, language: "en", ...extra });

test("independent corpus remains frozen with separate messages, injections and engineering-only labels", () => {
  const bytes = readFileSync(new URL("./fixtures/intelligence-quality/corpus-v1.json", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), FROZEN_CORPUS_SHA256);
  assert.deepEqual([corpus.reply_messages.length, corpus.reply_adapter_scenarios.length, corpus.grounding_cases.length, corpus.composer_cases.length], [46, 18, 24, 12]);
  assert.equal(corpus.origin, "SYNTHETIC"); assert.match(corpus.label_review, /ENGINEERING_ONLY/); assert.match(corpus.split, /NOT_CUSTOMER_HELD_OUT/);
  for (const item of corpus.reply_messages) assert.equal(item.text.slice(item.gold_evidence.start, item.gold_evidence.end), item.gold_evidence.quote);
  assert.ok(corpus.reply_messages.some(item => item.text.length > 32768));
  assert.ok(corpus.reply_messages.some(item => item.language === "hi" && /[\u0900-\u097f]/u.test(item.text)));
});

test("metrics preserve opt-out misses, false restrictions, abstention and ambiguous denominators", () => {
  const result = replyMetrics([row("OPT_OUT", "UNKNOWN"), row("OPT_OUT", "OPT_OUT"), row("QUESTION", "OPT_OUT"), row("POSITIVE_REPLY", "UNKNOWN"), row(null, "UNKNOWN"), row("NEGATIVE_REPLY", "INVALID")]);
  assert.equal(result.messages, 6); assert.equal(result.labeled_messages, 5); assert.equal(result.ambiguous_unlabeled, 1);
  assert.equal(result.explicit_opt_out_misses, 1); assert.equal(result.false_opt_outs, 1); assert.equal(result.abstentions, 3); assert.equal(result.invalid_outputs, 1);
  assert.equal(result.confusion.NEGATIVE_REPLY.INVALID, 1); assert.equal(result.coverage, 2 / 6);
  assert.equal(result.per_class.OPT_OUT.precision, 0.5); assert.equal(result.per_class.OPT_OUT.recall, 0.5);
  assert.equal(result.per_class.POSITIVE_REPLY.precision, null); assert.equal(result.per_class.POSITIVE_REPLY.recall, 0);
  assert.equal(result.per_class.UNKNOWN.recall, null);
});

test("candidate correctness does not promote authoritative class recall and language totals stay separate", () => {
  const result = replyBreakdown([row("POSITIVE_REPLY", "UNKNOWN", { language: "hi", candidate: { event_type: "POSITIVE_REPLY" } }), row("QUESTION", "QUESTION"), row(null, "OPT_OUT", { language: "hi-Latn" })]);
  assert.equal(result.overall.candidate_accuracy, 1); assert.equal(result.overall.per_class.POSITIVE_REPLY.recall, 0);
  assert.equal(result.by_language.hi.per_class.POSITIVE_REPLY.recall, 0); assert.equal(result.by_language.en.per_class.QUESTION.recall, 1); assert.equal(result.by_language.hi.messages, 1);
  assert.equal(result.by_language["hi-Latn"].opt_outs_on_unlabeled_ambiguity, 1);
  assert.equal(replyMetrics([]).coverage, null); assert.equal(replyMetrics([]).labeled_accuracy, null);
});

test("exact fact support rejects changed values and unrelated citations without treating a quoted field as a promise", () => {
  const fact = { field: "COMPANY_NAME", value: "We guarantee delivery tomorrow", evidence_refs: ["snapshot_evidence:company"] };
  assert.equal(unsupportedClaims([fact], [fact]).length, 0);
  for (const claim of [{ ...fact, field: "ENQUIRY_BUDGET" }, { ...fact, value: "50000" }, { ...fact, evidence_refs: ["snapshot_evidence:name"] }, { ...fact, evidence_refs: [] }, { ...fact, evidence_refs: [...fact.evidence_refs, ...fact.evidence_refs] }]) assert.equal(unsupportedClaims([claim], [fact]).length, 1);
  assert.equal(exactEvidence("A\r\nB", { start: 3, end: 4, quote: "B" }), true);
  assert.equal(exactEvidence("A\r\nB", { start: 2, end: 3, quote: "B" }), false);
  assert.equal(exactEvidence("  ", { start: 0, end: 1, quote: " " }), false);
  assert.equal(exactEvidence("\r\n\t", { start: 0, end: 3, quote: "\r\n\t" }), false);
});

test("frozen safety challenges pass while real model and customer quality remain explicitly unmeasured", async () => {
  const report = await evaluateIntelligenceCorpus();
  assert.deepEqual(report.synthetic_safety.failures, []);
  assert.equal(report.observations.reply_messages.length, 92); assert.equal(report.observations.reply_adapter_scenarios.length, 18); assert.equal(report.observations.grounding.length, 48); assert.equal(report.observations.composers.length, 12);
  for (const mode of Object.values(report.reply_quality)) { assert.equal(mode.overall.explicit_opt_outs, 17); assert.equal(mode.overall.explicit_opt_out_misses, 0); assert.equal(mode.overall.false_opt_outs, 0); assert.ok(mode.overall.abstentions > 0); assert.ok(mode.overall.labeled_accuracy < 1); }
  assert.equal(report.grounding_quality.unsupported_claim_cases, 0);
  assert.equal(report.external_quality.hosted_model, "NOT_MEASURED"); assert.equal(report.external_quality.customer_held_out, "NOT_MEASURED"); assert.equal(report.external_quality.production_readiness, "NOT_ESTABLISHED");
  assert.equal(report.evaluation.provider_calls, 0); assert.equal(report.evaluation.provider_cost, null); assert.equal(report.evaluation.provider_latency_ms, null);
  assert.equal(evaluationExitCode(report), 0); assert.ok(Buffer.byteLength(serializeEvaluationReport(report)) < REPORT_MAX_BYTES);
});

test("an all-abstaining classifier cannot pass explicit policy gates", async () => {
  const report = await evaluateIntelligenceCorpus({ adapters: { localReply: { classify: unknown } } });
  assert.equal(report.reply_quality.DEFAULT_LOCAL.overall.explicit_opt_out_misses, 17);
  assert.equal(report.synthetic_safety.failures.filter(item => item.mode === "DEFAULT_LOCAL" && item.reason === "EXPLICIT_OPT_OUT_MISSED").length, 17);
  assert.equal(evaluationExitCode(report), 1);
});

test("an abstain-everywhere summarizer fails positive control facts instead of winning with an empty output", async () => {
  const report = await evaluateIntelligenceCorpus({ adapters: { localSynthesis: { synthesize() { return { summary: { claims: [], text: "Review required" }, findings: [], qualification: { outcome: "NEEDS_REVIEW" } }; } } } });
  assert.ok(report.synthetic_safety.failures.some(item => item.id === "exact-recorded-name" && item.reason === "REQUIRED_CONTROL_FACT_MISSING"));
  assert.equal(evaluationExitCode(report), 1);
});

test("evaluation catches invented source assertions and a composer promise without model-based judging", async () => {
  const report = await evaluateIntelligenceCorpus({ adapters: {
    localSynthesis: { synthesize() { return { summary: { claims: [{ field: "ENQUIRY_BUDGET", value: "50000", evidence_refs: ["snapshot_evidence:e_name"] }], text: "" }, findings: [], qualification: { outcome: "READY_FOR_DEEPER_INTELLIGENCE" } }; } },
    composer() { return { subject: "A guarantee", message: "We guarantee a discount" }; }
  } });
  assert.ok(report.synthetic_safety.failures.some(item => item.reason === "UNSUPPORTED_MATERIAL_CLAIM"));
  assert.ok(report.synthetic_safety.failures.some(item => item.reason === "UNSUPPORTED_PROMISE_OR_RELATIONSHIP")); assert.equal(evaluationExitCode(report), 1);
});

test("report destination and byte limits cannot be replaced through user flags", () => {
  assert.deepEqual(parseEvaluationArgs([]), { writeReport: true }); assert.deepEqual(parseEvaluationArgs(["--check"]), { writeReport: false });
  for (const args of [["--output", "test/fixtures/intelligence-quality/corpus-v1.json"], ["--input", "customer.csv"], ["--check", "--check"]]) assert.throws(() => parseEvaluationArgs(args));
  assert.throws(() => serializeEvaluationReport({ value: "x".repeat(REPORT_MAX_BYTES) }), /byte limit/);
});

test("evaluation child blocks fetch and core socket transports before any adapter imports", () => {
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", "import {disableEvaluationNetwork} from './scripts/helpers/intelligenceEvaluationIO.js'; import http from 'node:http'; import net from 'node:net'; disableEvaluationNetwork(); for (const invoke of [()=>fetch('https://example.test'),()=>http.get('http://example.test'),()=>net.connect(80,'example.test')]) { try { invoke(); process.exit(1); } catch(error) { if(!error.message.includes('forbids network'))process.exit(2); } }"], { encoding: "utf8", env: safeTestEnvironment() });
  assert.equal(child.status, 0, child.stderr);
});

test("public evaluation runner sanitizes inherited provider/database targets and --check writes no report", () => {
  const file = new URL("../docs/verification/L3-02-evaluation.json", import.meta.url), before = readFileSync(file);
  const child = spawnSync(process.execPath, ["scripts/evaluate-intelligence.js", "--check"], { encoding: "utf8", env: { ...safeTestEnvironment(), DATABASE_URL: "postgres://secret@invalid.test/production", OPENAI_API_KEY: "synthetic-key-never-used", LLM_PROVIDER: "openai" }, timeout: 10000 });
  assert.equal(child.status, 0, child.stderr + child.stdout); assert.match(child.stdout, /NOT_MEASURED/); assert.doesNotMatch(child.stdout, /synthetic-key-never-used|secret@|Report:/);
  assert.deepEqual(readFileSync(file), before);
});
