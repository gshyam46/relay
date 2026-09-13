# L5-03 local operational verification

Recorded 2026-09-13 under [the contract/runbooks](../L5-03_OPERATIONS_ACCEPTANCE.md). Root owns HTTP/settings/package integration. Backend owns the owner metrics/finite alert module, sanitized workload launcher, scenario helper and focused tests.

## Measured local scenario

The [saved JSON report](L5-03-workload.json) comes from:

```text
node scripts/verify-operations.js --output docs/verification/L5-03-workload.json
```

Result PASS for l5.03-local-100-v1. The launcher created and removed its own temporary SQLite database, inherited no application/provider configuration, and did not start HTTP or a background server. It drove the real service factory, reviewed import chunks, durable analysis jobs and normal scheduler phases.

| Measurement | Recorded result |
| --- | --- |
| Enquiries / tenants | 100 / 2, split 90 and 10 |
| Current complete PLAN analyses | 100 |
| Scheduler ticks / total scenario | 180 / 20324.75 ms |
| Import/commit samples, p95 | 7 / 149.11 ms |
| Current reads, p95 / maximum | 100 / 7.24 ms / 9.62 ms |
| Scheduler tick p95 / maximum | 171.79 ms / 246.99 ms |
| Human workflow actions / due manual reminders | 10 / 10 |
| Internal HUMAN_TASK executions | 110 |
| SEND attempts / AI attempts / network attempts | 0 / 0 / 0 |

Both workspaces received a scheduler visit on tick 1. The small workspace finished its 10 analyses on tick 20 while 160 events remained for the noisy workspace, which completed on tick 180. There were no remaining main-scenario eligible analysis events and every final current read retained snapshot/synthesis/recommendation/plan.

This is one measured local deterministic service workload, not HTTP latency, production PostgreSQL throughput, model quality, physical provider concurrency or customer capacity. Fixed local regression thresholds were total 120 seconds, read p95 <= 1000 ms, tick p95 <= 5000 ms and <= 400 ticks. They were not widened to pass. Empty model usage remains unknown cost rather than invented spend.

## Incident and policy controls

The separate synthetic control phase created an ordinary exact-reviewed sandbox message. Actual executor admission held it under GLOBAL_DISPATCH_PAUSED. A separately constructed explicit local controls boundary then proved WORKSPACE_DISPATCH_PAUSED; neither created an attempt or invoked its adapter. Existing AI admission under a claimed synthetic event returned AI_PAUSED before any provider attempt. The separate control fixture is not counted as an additional completed customer analysis and its disposable event is not reported as drained main-workload history.

Nine injected alert conditions produced their fixed severity/runbook references. Persisted incident-state coverage separately verifies UNCERTAIN execution, retry hold and overdue human reminder counts/alerts. No external notification delivery or on-call response is claimed. Owner/current-role and foreign-workspace tests verify status does not expose source identities or raw content. Budget summaries reuse current domain services.

## Final automated checks

```text
node scripts/run-tests.js --test-concurrency=1 test/l501-schema.test.js test/l501-recovery.test.js test/l503-operations.test.js
```

**24 total: 23 passed, 0 failed, 1 explicit PostgreSQL skip.** L5-03 contributes 5 passed checks, including the complete 100-enquiry scenario. The other 19 checks are the overlapping L5-01 schema/recovery suite, so counts are not additive to prior individual runs.

The final run used the regenerated 82-table/24-migration manifest after root finalized 0023/0024. Current structural fingerprint: 47fd584ffa1f3fa9dc28a4bddfcd4f870416f4aaa80c052a6a8971efafa6bb9b. Existing 80-table L5-01 evidence is retained as historical evidence of its earlier scope.

Read-only peer review found readiness could overlap catalog checks after its five-second cache window while the first check was still in flight. Root fixed separate in-flight deduplication and cache-after-settlement. Root also aligned deployed role-check environment fallback. Root owns those source changes and their integration proof.

## Remaining acceptance

Run the agreed customer-shaped workload on the selected isolated PostgreSQL deployment; measure real latency/backlog/connection contention, workload mix, external provider/model usage and budgets. Configure and test actual alert delivery and human incident response. Confirm pause behavior with real provider acceptance/uncertainty and controlled recipients. Independently reconcile later erasures/suppression before activating any restored data. No live provider/model call, customer database action or deployment occurred in this local verification.
