# L3-03 analysis jobs: backend verification

Date: 2026-09-12. Local implementation evidence; no PostgreSQL deployment, real-provider, human acceptance or customer-quality certification.

## Implemented

- Persisted `analysis_jobs` intent and at most 50 scoped items, each linked to one `AnalysisRequested` domain event. Existing event attempts, deadline, lease, fence and stage records remain runtime authority.
- Atomic owner admission, explicit request-key replay/conflict checks, active/scoped selection checks and a 100-unfinished-item workspace cap. Held events count until completed or cancelled.
- Metadata-only job detail/history, SQL-bounded lead names, at most 20 jobs per page and at most 16 stage descriptors per item. No lead source, research or model payload is loaded for progress.
- Revisioned cancellation/retry with bounded decision history (100 commands and 64 KiB). Cancellation dismisses unfinished events and advances their fences; retry preserves original event attempts and deadline. Completed artifacts remain historical records.
- One shared prepare/generate/finalize runner for requested analysis and reply-triggered analysis. Generation is outside transactions; artifact and progress commits retain exact event and current-source authority.
- Frozen generation-descriptor comparison before each job stage transaction. Prepared input fingerprints also bind the registered generation descriptor for existing reply events.
- Legacy single-stage processing preserves prerequisite checks and injected failed-draft behavior. `AFTER_DRAFT` records a failed draft without calling a generator. Compatibility processing makes one processing attempt per selected item, without an HTTP retry loop.
- `PREPARE_DRAFTS` materializes only a current eligible plan under the same event fence. It neither approves nor dispatches. Requested-job completion uses `AnalysisCompleted`; reply intelligence retains its existing `LeadIntelligenceUpdated` audit meaning.

The AI invocation/usage implementation, shared migration, API compatibility adapters and UI are separately owned and verified. The runner passes immutable domain-event origin/fence to the AI context boundary; deterministic stages do not themselves create provider-attempt records.

## Automated evidence

Safe command:

```text
node scripts/run-tests.js --test-concurrency=1 --test-timeout=15000 test/l303-analysis-jobs.test.js test/l303-analysis-http-race.test.js test/domain-event-processing.test.js test/reply-intelligence.test.js
```

Result: **32 passed, 0 failed, 0 skipped** (15 new job behaviors, one new HTTP race regression and 16 retained event/reply regressions).

New cases demonstrate:

1. Atomic rollback on partially inserted selection, tenant/owner rejection, distinct selection and idempotent lost-response lookup.
2. Full pipeline completion and exact artifact reuse on a new unchanged request.
3. Partial failure, persisted snapshot/sibling completion, processor replacement and bounded stage reuse.
4. Cancellation during generation, rejection of late finalization and exact command replay.
5. Expired claim replacement without overwriting the replacement's completed artifact.
6. Changed generation contract held before snapshot or generation.
7. Source change during generation discards the late result.
8. Retry preserves original attempts/deadline; expiration cannot be reset.
9. Workspace cap includes held/queued work and cancellation releases only unfinished admission slots.
10. Artifact, audit and stage completion roll back together.
11. Single-stage prerequisite and injected failed-draft compatibility.
12. Cancellation preserves completed siblings, rejects conflicting decisions and rolls back with failed audit.
13. Bounded metadata-only public projection with large legacy source/name fields.
14. Actual SQLite database close/reopen recovers request identity and completes queued work.
15. Cancellation after earlier successful stages prevents late plan creation and draft preparation.
16. A concurrent newer analysis cannot make a legacy bulk response combine its current recommendation with an older job draft. Exact artifact comparison rejects the mixed result and retains historical actions.

Existing regressions additionally preserve mandatory opt-out handling during generation, reply-source intelligence updates, unchanged snapshot reuse, no outbound action from reply reanalysis, event budget exhaustion and completed policy-skip audit visibility.

An extraction regression omitted the policy-skip `lead_status` audit field; the implementation was corrected and the original test retained. Job completion audit was separated from knowledge-change audit so a reused job does not claim new intelligence. Independent integration review reproduced a mixed-artifact bulk response before the root fix; the new HTTP race test passes after restoring exact artifact comparisons. The final shared generation descriptor also captures snapshot, recommendation, planner and business-fit evaluator versions.

## Files owned by this slice

- `src/modules/analysis-jobs/analysisJobsContract.js`
- `src/modules/analysis-jobs/analysisJobsRepository.js`
- `src/modules/analysis-jobs/analysisJobsService.js`
- `src/modules/analysis-jobs/analysisPipelineRunner.js`
- `src/modules/events/leadEventHandlers.js`
- `test/l303-analysis-jobs.test.js`
- `test/l303-analysis-http-race.test.js`

## Limits and remaining acceptance

Cancellation cannot recall a provider request already admitted. Late usage remains a separate accounting fact and cannot authorize an artifact commit. A new explicit job remains subject to workspace admission and AI quotas; cancelling or retrying never refunds admitted provider usage.

This command uses disposable SQLite and injected/local generators. It does not establish PostgreSQL multi-process behavior, serving latency, fairness under the pilot workload, real-model charges or provider invoice reconciliation. Root-owned integrated verification covers migration/API/usage/browser checks.

Human QA must verify readable progress and partial results, stale-analysis distinction, cancellation during active work, quota/retry explanations, request recovery after reload and reviewable draft preparation without sending. These operator/provider/customer gates remain open.

## Final context-conflict correction

The full-suite integration found that the new single-stage adapter reclassified a profile-change race as a missing prerequisite. That lost the existing HTTP 409 `INTELLIGENCE_CONTEXT_CHANGED` contract. Accepted-job source changes now retain the explicit context-conflict code and status; legacy named-stage prerequisites are still checked before enqueue by the API.

Focused follow-up command:

```text
node scripts/run-tests.js --test-concurrency=1 --test-timeout=15000 test/business-context-http.test.js test/l303-analysis-jobs.test.js test/l303-analysis-http-race.test.js
```

Result after the correction: **21 passed, 0 failed, 0 skipped**. The existing profile-save race assertions were retained unchanged. The new direct-service test now distinguishes an already accepted job whose required context is unavailable from an API request rejected before enqueue. The earlier 32-check run remains recorded above; these overlapping counts must not be added.

## Additional normal-server scheduler proof

Added `test/l303-analysis-runtime.test.js` after the root final-suite loader had already started. Separate safe command:

```text
node scripts/run-tests.js --test-concurrency=1 test/l303-analysis-runtime.test.js
```

Result: **1 passed, 0 failed, 0 skipped**. This is an additional focused runtime result, not part of the already-started full-suite count.

The test initializes a uniquely owned temporary SQLite file, starts the normal `src/server.js` child with a sanitized environment, an ephemeral local port, `windowsHide: true`, test controls disabled, no provider configuration and global outbound dispatch disabled. With the worker disabled it registers an owner, captures a lead and accepts an asynchronous `ANALYSIS_ONLY` / `PLAN` job. Repeated GET reads leave the single job queued with zero attempts.

It then stops and reopens the normal server with the worker enabled. The persisted request key recovers the same job, and ordinary scheduler ticks complete its four stages in one processing attempt. The test invokes neither a processing endpoint nor a service pump. Repeated GET reads create no new jobs. Final read-only database checks record zero AI provider attempts, zero SEND executions and no action linked to the analysis-only plan; logs contain scheduler completion and no `worker.tick_failed`.

Normal `LeadCreated` processing remains enabled. It produced **one initial CREATE_HUMAN_TASK execution**, which is existing internal work and is reported separately from external sends and analysis-job effects. The original zero-total-executions test assumption was corrected to retain that valid behavior; no application source changed.

Cleanup verifies the resolved temporary directory is a generated child of the system temporary root before recursive removal.
