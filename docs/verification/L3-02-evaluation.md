# L3-02 independent intelligence evaluation

Date: 2026-09-12. Local implementation evidence for the [intelligence-quality contract](../L3-02_INTELLIGENCE_QUALITY.md) and ADR-019. The [machine-readable report](L3-02-evaluation.json) records individual observations, denominators, failures and source hashes. Customer/native-language labels and actual hosted-model quality remain unmeasured; L3-02's external acceptance is open.

## Frozen corpus and independence

The evaluation owner froze the source inputs and labels before the classifier owner began runtime changes. test/fixtures/intelligence-quality/corpus-v1.json contains 46 reply messages, 18 separate injected-adapter scenarios, 24 grounding challenges and 12 composer cases. Its manifest and test pin SHA-256 fb947b5bae9e05a71b8655aec2d5a6d92420c9b2f01f254c819101bf03ddfc85. The corpus remains unchanged after the fixes.

Each message records a stable ID, language/script, original text, independently labeled intent or explicit ambiguity, separately allowed safe outcomes, opt-out expectation, risk tags, rationale and exact original evidence offsets. The 35 labeled messages and 11 ambiguous messages remain separate denominators. The cases include English, five Hindi-script examples and five transliterated Hindi examples; all labels are engineering judgments pending native/customer review. Development reproductions are deliberately included. This is a frozen engineering challenge that becomes regression evidence after inspection, not a genuinely held-out customer dataset.

Grounding expectations list exact allowed material fact/value/reference tuples without deriving them from production grounding. Input setup constructs scoped source records and explicit synthetic freshness metadata at a fixed clock. Cases cover supported controls, empty selection, invented budget/relationship/promise, changed values, unrelated or foreign citations, malformed/tool output, provider failure, conflicting identities, changed identity, low confidence, stale/inferred/undated/future enquiry facts and quoted values that must remain quotations. Composer challenges cover the four existing channel templates, restrictions and malicious identity/business labels.

## Observed results

The final runner returns synthetic safety PASS with zero gate failures across 170 observations: 46 messages in two adapter modes, 18 injected scenarios, 24 grounding cases in two modes and 12 composer cases. These repeated runs are not 170 independent human-labeled examples.

Both default and configured-adapter message runs detect all 17 explicit stop requests. There are zero false opt-outs among 18 labeled non-opt-out messages and zero restrictions on the 11 ambiguous messages. Both modes abstain on 20 of 46 messages, including nine labeled messages. They match 26 of the 35 intent labels. This visible review burden prevents a safety pass from masquerading as complete semantic understanding.

| Language/script | Messages | Labeled | Ambiguous | Correct authoritative labels | Abstentions | Explicit stops detected |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| English | 36 | 25 | 11 | 19 / 25 | 17 | 11 / 11 |
| Hindi script | 5 | 5 | 0 | 3 / 5 | 2 | 3 / 3 |
| Transliterated Hindi | 5 | 5 | 0 | 4 / 5 | 1 | 3 / 3 |

Full confusion matrices and per-class precision/recall are in the JSON report. Zero-denominator metrics are null; invalid output has its own confusion-matrix column and cannot silently disappear. UNKNOWN counts as a miss for any explicit opt-out. Ambiguous unlabeled rows, safe abstention and false restriction are reported separately.

The configured message mode injects the engineering label as an ideal structured proposal; it does not call a model. Four correct proposals are retained as candidates while the authoritative event remains UNKNOWN and human review remains required. The separate candidate result measures proposal retention, not prediction accuracy or model comprehension. Eighteen independently specified hostile/supported adapter scenarios test disagreement, ambiguity vetoes, exact quote rejection, low confidence, added instructions, failure, conservative possible opt-out and candidate handling. Only injected method invocations occur; real provider calls, cost and latency are not measured.

The 48 grounding observations emit 54 structured claims with zero unsupported claim cases and zero unusable-source finding leaks. Eight invalid-source observations reject input; 33 reject or require review. These counts include repeated control facts, not 54 independent factuality labels. All 12 composer cases preserve restrictions and avoid the independently listed unsupported promises and relationships.

The first evaluation exposed three residual runtime errors: "I am not sure" still became positive; mixed affirmative/declining wording could remove the review obligation; and the transliterated contact-stop form was missed. The classifier owner corrected these and added focused regressions. No gold label was changed to obtain a pass.

## Explicit grader clarifications

Two grading assumptions were corrected after the first run, with root agreement, while preserving the frozen corpus and expected semantic outcomes:

- Conflicting recorded alternatives may remain visible as source findings when conflict/review flags are present. They must never become asserted summary claims. Unusable stale/inferred/undated/future findings are checked separately. The first grader incorrectly treated all visible conflicting sources as assertions.
- For a rejected injected challenge, expected_calls=1 is an upper bound: safe attribution/ambiguity checks may stop before a provider call. expected_calls=0 remains mandatory policy/veto bypass. Successful model controls and retained candidates must actually invoke the injected adapter. The first grader incorrectly demanded a call for already-rejected quoted source text.

Independent peer review also tightened exact-evidence grading to reject blank or whitespace-only quotes, with focused regressions; this was a grader strictness gap, not an observed classifier output failure. The frozen corpus was not changed.

The report records these clarifications and actual call counts. They change the harness interpretation of source visibility and call boundaries, not the frozen gold messages, allowed outcomes or material-fact labels.

## Runner and verification

Run npm run eval:intelligence or node scripts/evaluate-intelligence.js. The parent launches a child with the existing sanitized test environment, strips inherited database/provider configuration and disables fetch/core socket transports before importing adapters. The child uses bundled inputs and injected adapter objects only. It accepts no customer input, provider target or arbitrary report path. Normal execution writes only docs/verification/L3-02-evaluation.json; --check performs the evaluation without writing. The writer bounds the report to 1 MiB and rejects linked/non-regular destinations. Source/prompt/policy hashes and versions accompany the corpus hash; rerun after any tested source changes.

Owned files: scripts/evaluate-intelligence.js; scripts/helpers/intelligenceEvaluation.js, intelligenceEvaluationMetrics.js and intelligenceEvaluationIO.js; test/l302-evaluation.test.js; test/fixtures/intelligence-quality/corpus-v1.json and manifest.json; this document and the generated JSON report. Root owns the package command and source/provider changes; backend owns reply interpretation.

Automated results:

- Eleven new evaluation tests: **11 passed, 0 failed, 0 skipped**. They verify metric denominators and invalid outputs, candidate-versus-authoritative quality, exact support, immutable fixture integrity, positive controls preventing an all-abstain summary pass, opt-out gates preventing an all-UNKNOWN classifier pass, deliberately invented assertions/promises, fixed output bounds, network refusal and inherited-environment sanitization.
- Focused new and existing regressions: **64 passed, 0 failed, 0 skipped**. Command: node scripts/run-tests.js test/l302-evaluation.test.js test/reply-classifier.test.js test/l1-ai-grounding.test.js test/reply-intelligence.test.js test/synthesis.test.js.
- The reproducible evaluation command completes with synthetic safety PASS and the external-quality fields NOT_MEASURED / NOT_COMPLETED / NOT_ESTABLISHED. The 11 tests overlap the 64-test run; counts must not be added.

Root records final integrated CI/build/browser evidence separately. No live model or outbound requests were made by this slice.

## What this does not prove

The finite stop forms do not certify every language, dialect, typo, quotation structure or future message. Exact selected field/value support does not provide a general natural-language entailment judge. Actual providers, models, prompts and token/cost behavior were not benchmarked. This suite does not evaluate customer priority usefulness; the separate L3-01 comparison remains diagnostic synthetic evidence.

Before customer acceptance, obtain native/domain labels for representative consented examples, keep a genuinely untouched evaluation split, review labeling disagreements, and test the chosen configured model under explicit authorization. Compare per-language/class quality, policy misses, false restrictions, abstention workload, candidate usefulness, operating cost and end-to-end customer outcomes. Any policy-sensitive miss blocks release pending correction. A synthetic safety pass does not establish production readiness.

L3-03 maintenance check (2026-09-12): the fixed runner regenerated the JSON report after the metered-provider boundary, typed admission fallback and synthesis-version changes. Corpus labels and outcomes remain unchanged: synthetic safety PASS, zero gate failures, and the evaluator tests pass 11/11. Current source hashes are in the refreshed report; this does not add real model or customer evidence.
