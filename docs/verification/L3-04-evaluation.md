# L3-04 reviewed evaluation verification

Recorded: 2026-09-12. Scope: owned dataset/replay modules and the offline engineering regression gate under [the recorded contract](../L3-04_FEEDBACK_EVALUATION.md). This is local synthetic verification, not customer acceptance or hosted-model quality evidence.

## Implemented

Owners explicitly freeze 1..100 nominated, currently active reply feedback revisions into an immutable named dataset version. Request-key recovery and expected-version checks prevent duplicate versions after a lost response. Each manifest binds exact captured source, labels, reply text and operational category; private target snapshots remain in the feedback store.

Permanent workspace lead/exact-text groups prevent DEV/HOLDOUT reuse. A protected group can be evaluated once across all wrappers and versions; identical same-dataset/current-candidate retries return their original result. Dataset creation, evaluation, group consumption and their audit records commit atomically. New evaluation rejects a changed or withdrawn nomination. Existing metrics remain historical with labels_current=false; restoring the same labels in a newer revision does not revive an old manifest.

Replay uses the actual loaded LocalReplyClassifier with a process-captured source/version identity. It compares the recorded operational category baseline and current local rules against owner judgments. UNKNOWN can be a correct reviewed judgment and is still counted as an abstention. Expected/false/missed opt-outs are measured against those judgments, not asserted as independently established customer intent.

APIs return bounded metadata and aggregate metrics for both splits. They expose no member identities, original text, individual labels or per-case predictions. Aggregate parsing reconstructs scores from the confusion matrix and rejects extra or inconsistent stored fields. Metadata-only source sizes enforce the 4MiB batch cap before any private replay input is materialized. Operational replies, restrictions, leads, tasks, actions, domain events and AI attempt records remain unchanged by replay.

## Frozen engineering baseline

The new baseline was written before evaluator-helper changes from the previously recorded L3-02 report:

- Baseline file: test/fixtures/intelligence-quality/baseline-v1.json.
- Baseline SHA256: 357a53147a4d583968cdca6c23799bd62a7ecefc4f675f46ae77b8f0444f7082.
- Existing corpus SHA256: fb947b5bae9e05a71b8655aec2d5a6d92420c9b2f01f254c819101bf03ddfc85.
- Fixed denominators: 46 messages, 35 labeled, 11 ambiguous, 17 explicit opt-outs, 18 known non-opt-outs.
- Required floors: at least26 correct, no more20 abstentions; per-class true positives3/2/4/17 for positive/negative/question/opt-out, with denominators6/5/7/17.
- Grader: l3.04-engineering-regression-v1.

No existing corpus example, gold label, classifier or floor was changed to obtain a passing gate. Baseline/report source manifests identify the previous accepted implementation separately from the newly evaluated implementation.

The fixed, sanitized runner now executes the original synthetic safety suite and the pinned-baseline/source comparison. It accepts no customer input, report upload, model target, source override or baseline-update flag. --check writes no report. Default execution writes only the existing bounded [synthetic report](L3-02-evaluation.json).

## Automated evidence

Command:

```text
node scripts/run-tests.js test/l304-evaluation-runtime.test.js test/l304-evaluation-gate.test.js test/l302-evaluation.test.js
```

Result: **28 tests passed, 0 failed, 0 skipped**: 12 new persistence/metric tests, 5 new engineering-gate tests and 11 existing evaluation regressions. Disposable SQLite and sanitized test environment; no live model/provider calls.

Behavior covered: exact version and request replay; owner/tenant enforcement; duplicate feedback/text and same-lead split rejection; concurrent protected evaluation; audit-failure rollback; withdrawal/restoration and historical metrics; strict client-field rejection; bounded pagination; metadata-first aggregate limits; corrupt member/manifest/source schema rejection; private aggregate projection; original opt-out preservation; exact score denominators; stale source/corpus identity; missing challenge coverage; recall/abstention floors and false external-quality claims.

The initial focused run exposed a test fixture without the existing required local reply adapter. Supplying LocalReplyClassifier fixed the fixture; production classification behavior was unchanged.

Commands:

```text
node scripts/evaluate-intelligence.js --check
node scripts/evaluate-intelligence.js
```

Final result: **synthetic safety PASS and ENGINEERING_REGRESSION PASS**, both with zero failures. Corpus coverage remains46 reply messages,18 injected adapter scenarios,24 grounding cases and12 composer cases, producing170 observations across modes. Actual provider calls0. The regenerated report records17 exercised source/fixture hashes; aggregate candidate source SHA256 is b20fe914b1c0548c7586e3da02ddd4777533beb899de4ab4701c8f1565614426. Owned diff whitespace checks passed.

The current baseline still has26/35 labeled local replies correct and20/46 abstentions. Ideal injected semantic proposals test bounded adapter handling; they do not measure hosted-model comprehension. The independent baseline gate does not turn these finite development regressions into a held-out customer benchmark.

## Remaining acceptance and limits

The protected workspace split is a one-use replay reservation, not proof that an owner or administrator has never seen the source. Exact lead/text grouping does not establish independence between different enquiries or paraphrases. PERMISSION_REVIEWED is an owner attestation, not automated permission verification or independent label adjudication.

Customer generalization, representative usefulness, native-language label review and actual hosted-model quality remain unmeasured. Runtime feedback evaluation does not authorize a deployment or configured-model promotion. Language is not inferred from private text; runtime language breakdown is explicitly NOT_CAPTURED. Real business outcomes remain L4-05.

Root owns integrated migration/API/CI and broader verification. UI owns actual browser evidence. PostgreSQL execution and human customer/label/permission/accessibility validation remain separate acceptance work; this focused SQLite result does not claim those checks.

## Files and handoff

Owned implementation: src/modules/intelligence-evaluation/evaluationContract.js, evaluationMetrics.js, evaluationRepository.js and evaluationService.js; scripts/helpers/intelligenceRegressionGate.js; narrow existing evaluator/source-manifest integration; pinned baseline; focused tests; regenerated synthetic report and this evidence note.

Shared contracts: IntelligenceEvaluationService owner-scoped dataset creation/list/detail/request recovery and aggregate replay/history; private loadEvaluationFeedback projection supplied by the feedback module. Root owns immutable migration0016 and API/package/CI wiring. No shared runtime/provider/classifier edits were required.
