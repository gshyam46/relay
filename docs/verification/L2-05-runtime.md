# L2-05 runtime verification

Date: 2026-09-12. Local implementation evidence for the accepted [freshness contract](../L2-05_FRESHNESS.md) and ADR-017. This is not pilot, provider or PostgreSQL acceptance.

## Implemented behavior

- Synthesis, recommendation and next-action generation reload the database-owned current lead before model input construction. They capture source/revision/discrete freshness authority and recheck both the existing artifact fingerprint and a canonical hash of the complete actual parent input under the workspace gate. Direct model calls remain outside transactions; the staged event processor retains its own preparation/finalization boundary. Cached reuse receives the same final check.
- The additional full-input guard is transient and does not change neutral legacy artifact fingerprints. Current-read composition accepts an injectable clock and runs each dependent current read under a common workspace transaction. It generates no analysis; the technical high-water exception follows ADR-017.
- Grounding validates persisted assessment metadata, excludes unusable enquiry/research facts, retains explicit field review flags and rejects selection of a conflicted field. A known historical date can remain supported with its nonblocking missing-observation warning. Refresh cannot turn inferred/conflicted, undated ongoing, future-at-recording or failed-ingestion sources into factual claims.
- Prepared previews, approval checks and dispatch bind current freshness alongside their existing business/data revisions. Expiry or new research/reply authority requires a new exact preview and decision. Existing reviewed copy is retained for explicit review, without claiming the customer reconfirmed it. A deliberately reviewed question remains possible when the facts still need review.
- All unexecuted external dispatch paths already pass through prepared validation, including scheduled and workflow actions; this slice introduces no scheduler or workflow status rewrite. The executor forwards its clock to the prepared check.
- Late delivery callbacks keep the actual execution, immutable recipient and channel delivery history. Before creating automatic no-response work, they compare the executed revision against current source/freshness authority, including adoption on a revision-0 lead. Typed freshness/input-limit or saved-context corruption skips new automatic work; storage failures retain existing transactional error handling.
- The common workspace gate preserves only observed technical time after a rejected domain transaction. The root-owned savepoint change is exercised by a first-expiry failed approval followed by clock rollback; original approval rows remain unchanged and cannot regain dispatch authority.

## Files

Runtime: businessContextGuard.js, currentIntelligence.js, synthesisService.js, intelligenceRecommendationService.js, nextBestActionService.js, ai/grounding.js, preparedActionService.js, channels/channelWorkflowService.js and handlers/actionExecutor.js. Backend owns evaluator/storage/snapshot/research integration. Root owns the common transaction gate and HTTP/read-view wiring.

Tests: test/l205-currentness-runtime.test.js adds 25 behavioral checks. Existing synthesis.test.js, intelligence-recommendation.test.js and next-best-action.test.js now explicitly observe OUTDATED after research ingestion and refresh foundational intelligence before downstream stages; source facts used as current research carry an explicit synthetic observation time. Existing history, exact evidence and no-outbound-side-effect assertions remain. The original historical date assertion in l2-context-grounding.test.js passes unchanged.

## Executed automated checks

All runs used the safe wrapper, a disposable SQLite database and sanitized inherited provider/database configuration. No live model/provider requests were made.

1. Core runtime, legacy model and event regressions: **126 passed, 0 failed, 0 skipped**. Command:

   node scripts/run-tests.js test/l205-currentness-runtime.test.js test/synthesis.test.js test/intelligence-recommendation.test.js test/next-best-action.test.js test/l2-context-grounding.test.js test/l2-context-review.test.js test/lead-data-runtime-safety.test.js test/l1-ai-grounding.test.js test/domain-event-processing.test.js

   This run contained the first 23 new runtime checks. Temporary runner output was captured; final integrated counts are recorded separately.

2. After adding explicit saved-context corruption handling and two callback regressions: **51 passed, 0 failed, 0 skipped**. Command:

   node scripts/run-tests.js test/l205-currentness-runtime.test.js test/channel-workflow.test.js test/callback-replay.test.js

   This includes all 25 new runtime checks. Temporary runner output was captured; final integrated counts are recorded separately. Counts overlap the first run and must not be added together.

3. During integration, current HTTP/read behavior plus the first 19 runtime cases: **23 passed, 0 failed**. The later broader runs above cover the final runtime changes; root owns final HTTP/full-suite certification.

New tests cover exact expiry and unchanged refresh reuse across the full pipeline; rollback-clock and restarted read composition; nine direct expiry/research/reply model races; three cache races; three parent-content-only races with unchanged source authority and persisted fingerprints; the configured extractive adapter returning after expiry; failed approval/technical-time persistence; scheduled dispatch without an attempt; delayed callback expiry/research adoption/clock corruption/context corruption; and uncertain, conflicting, inferred, undated and future sources remaining nonfactual.

## Remaining acceptance

Root must record final integrated CI/build/browser results separately. Real PostgreSQL serialization/savepoint behavior, provider recovery and operator understanding of refresh versus sourced correction remain human/environment acceptance. The 90-day policy is provisional and requires customer validation. These tests authorize neither deployment nor live sends.

## Independent integration review

Reviewed the root-owned workspace savepoint/clock recorder, intelligenceReadView.js, bulk refresh result handling and logger code/path filtering. One concrete issue was found: a common database transaction did not itself stop the wall clock crossing expiry between the badge assessment and dependent artifact reads. Root corrected the read view to capture one physical instant inside the gate and pass that constant clock through the composition, with an exact-boundary regression (root reported 5/5 HTTP checks). No additional tenant, comparison-bound or per-lead error-disclosure issue was identified.

The SQLite and PostgreSQL transaction clients deliberately poison a transaction after a SQL operation fails. Technical-time preservation therefore applies to ordinary domain rejections; a database-operation/commit failure still aborts the unit and cannot promise a durable time observation. This is the documented storage-failure exception, not partial domain success. No database-adapter relaxation was proposed.
