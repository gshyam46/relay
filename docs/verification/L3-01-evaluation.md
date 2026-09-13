# L3-01 business-fit evaluation and runtime evidence

Date: 2026-09-12. Local evidence for the accepted [business-fit contract](../L3-01_BUSINESS_FIT.md) and ADR-018. This records synthetic engineering evaluation and disposable SQLite behavior. It does not establish customer usefulness, general semantic quality, hosted PostgreSQL acceptance or live-provider readiness.

## Independently frozen expectations

The separate evaluation owner froze test/fixtures/business-fit/criteria-v1.json before the evaluator implementation was available. The fixture contains 37 expected qualification cases plus a four-enquiry ranking cohort. Expectations come from the agreed bounded business rules, not customer judgments or a held-out business dataset. A test verifies the fixture hash so an implementation disagreement cannot silently rewrite its expected answer.

SHA-256: 675f97bd0c65aa226be3ee29415c94918ec5b8f500a2a8999b4a5b99018cb55e.

The fixed synthetic clock is 2026-01-15T12:00:00.000Z. Sources carry explicit observation and recording dates; the harness uses the actual source-freshness assessor and canonical typed enquiry/profile normalization. Every result round-trips through the persisted-result validator and preserves its exact criterion fact, provenance, conflict alternatives and freshness assessment.

| Expected and observed classification | Cases |
| --- | ---: |
| MATCHES_CRITERIA | 13 |
| DOES_NOT_MATCH | 9 |
| NEEDS_REVIEW | 14 |
| NOT_CONFIGURED | 1 |

All 37 classifications and their separately frozen criterion outcomes pass. Coverage includes exact and approved whole-value interest aliases; explicit exclusions; unrecognized, negated and unmapped-language text; missing country and unsupported country; unknown locality and whole-country rules; zero, equal-threshold, one-minor-unit-below, crossing and large exact money ranges; currency mismatch; inclusive absolute date bounds; unknown preferences; stale, undated, future-at-recording, inferred and conflicted sources; unrelated unknown facts; and descriptive criteria that remain unevaluated. The same chair-repair enquiry matches a repair business and fails a table-only business. Unknown wording remains visible for review rather than becoming an invented fit or rejection.

## Transparent ranking comparison

The intentionally diagnostic cohort contains an older matching enquiry with incomplete contact/company data, a more complete match outside a preferred date window, a recent unresolved enquiry and a recent explicit exclusion. Its expected order was frozen as a, b, c, d.

| Ordering method | Observed order | Expected ordered pairs preserved |
| --- | --- | ---: |
| Recorded business criteria, preferred matches, stable ID | a, b, c, d | 6 / 6 |
| Existing data-readiness score, then stable ID | b, c, d, a | 3 / 6 |
| Latest recorded time, then stable ID | c, d, b, a | 1 / 6 |

This comparison shows the intended behavior on these four constructed enquiries: contact completeness and recency cannot substitute for declared business requirements. Six pairs are too few to estimate general ranking accuracy or prove a product advantage. The 14 review outcomes are part of the evaluation, not removed from the denominator. Actual business ranking agreement, false positive rate, review burden and the pilot's customer-usefulness target remain unmeasured.

Additional comparator checks keep archived, outdated and absent assessments unassessed; reject a forged top-level attention value as ordering authority; and preserve stable lead-ID ties regardless of recency or the legacy numeric score. A runtime comparison gives the same fit/attention result to identical enquiry facts with different source labels, contact completeness and readiness. A different workspace's criteria cannot affect the first workspace.

## Runtime change and authority

localRecommendationAgent.js retains the existing numeric processing-attention calculation. A configured DOES_NOT_MATCH or NEEDS_REVIEW assessment changes only a would-be PREPARE_OUTBOUND_REVIEW recommendation to REVIEW_LEAD_INTELLIGENCE, using the static reason: "Review the separately recorded business criteria assessment before preparing outreach." The independent business assessment supplies the detailed explanation. Existing data-gathering and duplicate review steps keep precedence; an existing task to answer the customer's question remains due.

No actionPlanner.js change was needed. Existing exact snapshot-evidence references remain valid; criterion IDs are not fabricated as source citations. The existing review plan creates a human task, not a send. The configured recommendation adapter follows the same deterministic restriction without invoking a free-form model grader. The direct criteria/evaluator/recommendation calls in these runtime fixtures create no approvals or provider attempts. The existing bulk-analysis API may materialize reviewable human work; it does not dispatch it. A match cannot approve an action or override an independent opt-out.

Review identified an additional authority dependency: adopted criteria require the evaluator version in prepared-review context, not only the snapshot fingerprint. Root implemented the conditional businessFitAuthority helper in prepared validation and delayed workflow continuation. Regression tests construct an otherwise matching historical review with an omitted or different evaluator version; both reject approval reuse and dispatch without attempts, preserve the original decision/copy, and require a new review. Neutral legacy reviews retain their existing compatibility checks.

The 15 new runtime tests also verify unchanged criteria reuse across the full snapshot/synthesis/recommendation/plan pipeline, monotonic disable/re-enable invalidation without resurrecting old approval, criteria edits during each of the three generation stages, immutable historical recommendations, and actual late delivery retained without obsolete automatic follow-up work.

## Automated verification

All commands used scripts/run-tests.js, disposable SQLite and sanitized inherited database/provider settings. No live model or outbound provider requests were made.

- Independent frozen evaluation: **41 passed, 0 failed, 0 skipped**. Command: node scripts/run-tests.js test/business-fit-evaluation.test.js.
- Initial runtime slice: **12 passed, 0 failed, 0 skipped**. Three additional authority/reply regressions were then added and included in the final focused run below.
- Final focused evaluation, runtime and existing grounding/currentness regressions: **138 passed, 0 failed, 0 skipped**. Command:

  node scripts/run-tests.js test/business-fit-evaluation.test.js test/business-fit-runtime.test.js test/l1-ai-grounding.test.js test/intelligence-recommendation.test.js test/next-best-action.test.js test/l2-context-review.test.js test/l205-currentness-runtime.test.js

The final run includes all 41 evaluation tests and all 15 new runtime tests. These counts overlap the earlier runs and must not be added together. Runner output was captured in temporary local files; root records final integrated CI/build/browser evidence separately.

Files owned by this slice: src/modules/lead-intelligence/localRecommendationAgent.js; test/business-fit-evaluation.test.js; test/business-fit-runtime.test.js; test/fixtures/business-fit/criteria-v1.json; this document. Backend owns criteria/evaluator/storage; root owns shared API and evaluator-version authority; UI owns customer-facing explanations.

## Remaining customer and environment acceptance

A business owner must review real supported offerings, exclusions, geography, currencies and time windows, then label real enquiry outcomes and priority pairs before seeing product results. Measure useful ranking agreement against readiness and recency baselines, false matches, abstention/review workload and time to a correct next action. Include local-language and novel wording: approved aliases deliberately do not provide general semantic understanding. Confirm operators understand unknown versus mismatch, provisional source freshness, unassessed descriptive criteria and the separate contact-permission boundary. Hosted PostgreSQL migration/transaction proof and live human/provider acceptance remain separate launch requirements; this slice authorizes no deployment or live sending.
