# L2-01 review and generation boundary evidence

Product: **AI Lead Intelligence & Outbound Automation**.
Date: **2026-09-12**.
Status: local automated evidence for the [recorded contract](../L2-01_BUSINESS_CONTEXT.md); no external acceptance claim.

## Implemented

Prepared preview, decision and dispatch now read the current persisted business-profile/enquiry revision pair through the same transaction-scoped database that owns the review. Nonzero revisions extend the private context fingerprint. Both revisions zero preserve the previous fingerprint exactly. A caller-supplied token cannot override persisted context. Existing immutable copy and reviewer decisions remain history; revised context requires a new preview and decision. The preview retains previously edited copy for review rather than claiming to regenerate it. Already-authorized work retains its original captured intent, and re-review preserves the original retry budget/deadline.

Direct synthesis, recommendation and next-best-action generation capture context before building input. Generation remains outside database transactions. Cached result acceptance and generated output finalization recheck that revision pair under the workspace transaction used by context saves. Ready state, supersession and audit commit together. Transaction-bound staged event processing reuses its existing workspace gate without nesting another transaction. A context change returns INTELLIGENCE_CONTEXT_CHANGED and cannot publish or supersede a newer-context artifact.

Files: [preparedActionService](../../src/modules/outbound-automation/preparedActionService.js), [businessContextGuard](../../src/modules/lead-intelligence/businessContextGuard.js), [synthesisService](../../src/modules/lead-intelligence/synthesisService.js), [intelligenceRecommendationService](../../src/modules/lead-intelligence/intelligenceRecommendationService.js), [nextBestActionService](../../src/modules/next-best-action/nextBestActionService.js), [focused regressions](../../test/l2-context-review.test.js).

## Verification

Safe isolated command:

~~~powershell
node scripts/run-tests.js test/l2-context-review.test.js test/prepared-action-review.test.js test/domain-event-processing.test.js test/synthesis.test.js test/reply-intelligence.test.js test/next-best-action.test.js test/intelligence-workspace.test.js test/intelligence-recommendation.test.js test/intelligence-foundation.test.js
~~~

Result: **93 tests, 93 passed, zero failed, zero skipped**. The new focused file contributes 12 behavior tests: no-context compatibility; profile-save hold before any attempt; retained edited copy and immutable decisions; enquiry/tenant scope; forged token refusal; no-op stability; context saved during a provider call; retry preservation; three concurrent generation/context-save/newer-artifact races; and three audit-failure rollback cases. The existing suites also cover staged generation, opt-out and expired ownership, avoiding nested transactions, current-evidence versioning, retries, restart and organization boundaries.

The first new-file run exposed a missing test-function closing brace; corrected before the successful run. No production/runtime assertion was weakened to obtain the pass.

## Limits and human QA

This verifies owned disposable SQLite and synthetic adapters. It does not establish PostgreSQL process locking, deployed providers, browser usability or customer usefulness. The revision guard covers business/enquiry context; richer freshness, evidence correction/contradiction semantics, measured qualification and bounded analysis jobs remain L2-05/L3 work.

An operator still needs to verify that a real offering and enquiry correction makes analysis require refresh, that revised context is understandable beside the retained message copy, and that a previously approved send requires explicit renewed review. Verify keyboard/mobile/error states and the distinction between a queued stale approval and an already-authorized attempt. Main integrated evidence and task status are maintained by the integrating owner.

## Browser-discovered context warning regression

A real local browser walkthrough found that a conflicted interest plus an observed enquiry date and unknown budget could create its snapshot and synthesis but fail recommendation with a signal-context error. The integrating owner corrected the producer: existing deterministic contact/readiness/reply signals retain their original lead evidence IDs. New enquiry facts and metadata-only context-review warnings remain snapshot evidence, without becoming unrelated factual support for those signals. The strict recommendation grounding validator remains unchanged.

[Complete-path regressions](../../test/l2-context-grounding.test.js) drive the actual bulk-analysis API for both CONFLICTED and INFERRED interests. Snapshot, synthesis, recommendation and plan complete with a human review recommendation; unknown/inferred/conflicted values do not become claims; warning evidence remains visible; no send/attempt occurs; repeat analysis recognizes the current result. Deliberately inserting a metadata-only warning ID or a missing/foreign ID into a signal still fails strict validation.

~~~powershell
node scripts/run-tests.js test/l2-context-grounding.test.js test/l1-ai-grounding.test.js test/intelligence-recommendation.test.js test/reply-intelligence.test.js
~~~

Result: **46 tests, 46 passed, zero failed, zero skipped**. This follow-up covers source grounding, unsupported claims, injection, cross-context lineage, recommendation versioning, replies and the two new complete-path checks. Browser evidence is recorded separately by the integrating owner.
