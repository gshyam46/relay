# L1-06 migration and event repository verification

Date: 2026-09-11.
Product: **AI Lead Intelligence & Outbound Automation**.
Scope: local implementation evidence for the migration/storage portion of [L1-06 scheduling](../L1-06_SCHEDULING.md). This does not close L1 or certify a customer deployment.

## Implemented

- Immutable `0007_scheduler_event_recovery` adds managed event ownership/budgets, stage/review records, persistent scheduler cursors, workflow revisions/holds and nullable typed action links. The registry appends it after 0006; migrations 0001-0006 were not edited in this slice.
- Existing event statuses, attempts, payload bytes, errors and timestamps remain unchanged. Unfinished legacy events, including PENDING with zero attempts and possible partial effects, remain unmanaged and held for review. Old processed history does not acquire fabricated stage cursors. Legacy malformed counters and payloads remain preserved under version zero.
- Existing workflow history remains unchanged; unfinished runs gain a schedule review hold. No migration infers an action's typed workflow links from historical JSON.
- Managed-only checks constrain supported event states, hashes, counters and update metadata without rejecting old history. Stages/reviews, scheduler counters and action step identity have database constraints. Runtime services must additionally validate related tenant/lead/sequence identity.
- EventsRepository publishes managed immutable input and supplies transaction-bound claim, ownership, stage, finish and failure methods. Claims increment attempts, freeze limits and return an opaque frozen handle; copied rows and bare IDs cannot complete work. Current owner/fence/live lease and immutable event authority are rechecked for each write.
- Stage cursor writes can share the artifact/audit transaction. Changed input replaces only its event cursor. The repository cannot itself certify model output or required handler stages; the typed processor owns those checks and performs network generation outside transactions.
- Contact suppression now stops WAITING_EXECUTION workflows and increments the run revision once, preserving existing holds and in-flight execution facts.

## Automated evidence

Command:

```text
node scripts/run-tests.js test/event-repository.test.js test/scheduler-migrations.test.js
```

Result: **18 tests: 13 passed, 5 explicitly skipped PostgreSQL tests, 0 failed.**

Verified behavior:

- Populated previous-schema migration preserves legacy data and creates no event stage or replay authority.
- Invalid managed state, hash, counter, review, scheduler cursor and typed-link constraints reject writes.
- Expansion failure and migration-marker failure roll back schema and legacy holds atomically.
- Competing SQLite migrators seed one scheduler cursor; restart preserves legacy holds.
- Same-client and independent SQLite connections acquire one persisted event claim.
- Forged/copied handles, wrong workspace, escaped transactions and stale/expired owners cannot commit.
- Artifact, stage and final event status roll back together.
- Retry timing and original attempt/deadline limits survive restart and cannot be replenished.
- Malformed future dates and changed payloads become visible quarantines; unmanaged rows remain untouched.
- Repeated suppression stops waiting execution once without resetting an accepted attempt.

Syntax checks and scoped `git diff --check` passed for the owned migration, repository and test changes. Broader processor, workflow, scheduler, HTTP/UI and full-suite results belong to the integrating owner's L1-06 evidence.

## Independent processor review and compatibility checks

A bounded review of the processor, lead handlers, worker and due follow-up service found and reproduced two ownership/registry defects. The integrating owner corrected both: failure persistence now samples time after acquiring the workspace gate and checks expiry before commit; handler admission and retry inspection accept only explicitly registered own properties. Completion also checks lease expiry after its writes. Durable contact restrictions, including shared canonical identities and pending receipt policy, are consulted during planning and after generation.

`node scripts/run-tests.js test/domain-event-review.test.js`: **4 passed, 0 failed.** These regressions prove:

- A worker that expires while waiting to persist failure cannot clear its reclaimable lease or append a retry audit; a replacement can finish with the next fence/attempt.
- Inherited JavaScript names such as `toString` and `constructor` quarantine as unsupported events instead of being marked processed.
- Reimported duplicate contacts retain intelligence snapshots while initial contact actions and reply recommendation stages are skipped for either ALL opt-out or EMAIL unsubscribe restrictions, even with an independent NEW lifecycle.
- Pending mandatory receipt policy defers initial planning; processing a harmless receipt allows the same event to continue with its frozen attempt budget/deadline and one initial action.

`node scripts/run-tests.js test/execution-migrations.test.js`: **9 passed, 4 explicitly skipped PostgreSQL tests, 0 failed.** The historical 0005 preservation assertions remain pinned to their schema; fixtures explicitly upgrade to the current schema before invoking current runtime candidate SQL. No runtime schema fallback was introduced.

## Known limits and human QA

The five PostgreSQL fixtures require the explicit disposable PostgreSQL runner and were not executed in this local run. SQLite contention is not proof of PostgreSQL multi-process, least-privilege, restore or production performance behavior.

An operator must inventory held legacy events/runs before rollout; automatic replay or silent promotion is intentionally unavailable. Human QA must inspect legacy/managed recovery, retry budgets, schedule pause/stop and retained opt-out behavior through normal product controls. Live provider, browser/accessibility, restart and customer acceptance remain separate gates.
