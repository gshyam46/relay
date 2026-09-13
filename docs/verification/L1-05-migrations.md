# L1-05 migration and repository verification

Product: **AI Lead Intelligence & Outbound Automation**. Date: 2026-09-11.

Status: additive schema and repository slice implemented and verified locally. The [execution recovery contract](../L1-05_EXECUTION_RECOVERY.md) governs runtime integration. This document does not close L1-05, certify PostgreSQL behavior, or authorize live sends.

## Implemented changes

- [0005_bounded_dispatch_recovery](../../src/database/migrations/0005_bounded_dispatch_recovery.js) adds persisted retry timing/budget, active attempt/fence/hold, immutable attempt binding/key/lease/outcome fields, and the dispatch_resolutions evidence table. It is appended to the explicit registry; migrations 0001-0004 remain unchanged.
- Historical attempts receive LEGACY_UNKNOWN. No existing revision, provider reference, error, status, key or timestamp is rewritten; no new revision binding, lease, acceptance, provider key, deadline or active execution is invented.
- Current EXECUTING/RETRYING actions are held even without a recorded attempt. PLANNED/APPROVED/AWAITING_APPROVAL actions with any existing attempt receive LEGACY_OUTCOME_REVIEW_REQUIRED. Including pending review prevents later approval from clearing ambiguous send history. Existing completed/blocked history remains unchanged. A genuinely unattempted action remains subject to normal runtime review/policy checks.
- Invalid or duplicate historical attempt numbers cause MIGRATION_EXECUTION_REVIEW_REQUIRED before any 0005 DDL. The error contains no record identities. The operator must inventory and resolve the history offline; the migration never renumbers or deletes it.
- Constraints enforce positive attempt/fence values, bounded max_attempts, supported outcomes and resolution decisions, one resolution per execution, unique action/attempt and action/fence. There is deliberately no unique STARTED-status index: unresolved historical attempts must remain representable.
- Resolution evidence is nonempty and at most 2000 characters, reviewer IDs at most 256, provider references at most 512; ACCEPTED requires a reference. Runtime commands own tenant/fence checks and append-only usage. SQL foreign keys alone do not enforce every cross-table tenant relationship.
- [ActionsRepository](../../src/modules/outbound-automation/actionsRepository.js) persists max_attempts and exposes new policy defaults. nextExecutable(limit, organizationId, canonicalUtcNow) excludes holds and valid future scheduled/retry instants. Calendar/format validation keeps malformed timestamps visible to the executor for a durable hold. This candidate query is not dispatch authorization.
- [ExecutionsRepository](../../src/modules/outbound-automation/executionsRepository.js) accepts all new attempt fields and provides attempt counts, scoped execution/revision/provider-reference lookup, and exact guarded completion/failure helpers. They preserve an existing HTTP provider reference, cannot reopen CLOSED_UNRESOLVED, and cannot turn delivered/completed history into a failure. Old action-only wrappers refuse multiple attempts. The callback service owns current-action/fence/precedence decisions; the executor owns conditional lease/fence writes.

## Automated evidence

Command:

~~~text
node scripts/run-tests.js test/execution-migrations.test.js test/migration-safety.test.js
~~~

Result: **29 tests; 22 passed, 7 explicitly skipped PostgreSQL checks, zero failures**. The new execution migration suite contributes 9 passes and 4 PostgreSQL skips. The launcher removes inherited application database/provider configuration; all executed databases are in-memory or owned disposable SQLite files. No provider calls occur.

[test/execution-migrations.test.js](../../test/execution-migrations.test.js) verifies:

- A populated synthetic schema with migrations 0001-0004 already marked, including existing reviewed copy, preserves every old action/attempt/revision field.
- STARTED with/without a provider reference, unclassified FAILED/RETRYING history, pending review with earlier attempts, and missing-attempt in-flight actions acquire the correct conservative holds.
- Invalid/duplicate numbering leaves data, schema and migration history untouched; policy/outcome/uniqueness/resolution constraints reject invalid writes.
- Injected failure after the actual migration and backfill rolls back DDL, data and marker. An actual child-process exit after backfill also leaves no partial upgrade after reopen.
- Two separate SQLite connections apply the migration once. Restart/re-running migrations preserves holds, frozen first-use times, budget and fence values.
- Valid future retry/schedule values remain out of the queue, due values enter it, and invalid format, calendar date, month or hour reaches the executor candidate path. Tenant selection is scoped.
- Exact attempt writes require the owning workspace transaction, preserve a later attempt, preserve HTTP references, and reject ambiguous legacy action-only mutation. Delivered and manually closed history cannot be weakened by these helpers.

The existing migration suite remains passing for baseline adoption/refusal, populated older extension repair, unknown/gapped migration history, registry validation, marker failure, lock timeout and process interruption. These fixtures are explicit synthetic prior schemas, not a claim that a matching production incident occurred.

## Pending PostgreSQL and operational acceptance

Four new PostgreSQL fixtures use only the explicit disposable harness: populated upgrade, constraints, due-time SQL, and interrupted/concurrent migration. They were **not executed**. The local availability check found Docker's executable but no local engine pipe, no psql/pg_ctl/postgres executable or PostgreSQL service, and no TEST_DATABASE_URL or disposable opt-in. Only presence was inspected; no credentials were printed and no application database connection was attempted.

The safe future command is:

~~~text
node scripts/run-postgres-tests.js test/execution-migrations.test.js test/migration-safety.test.js
~~~

It requires an independently verified disposable target and the existing explicit harness opt-in. Root integration must additionally verify runtime lease expiry, late result fencing, bounded retries, operator resolution, exact callbacks and shutdown. PostgreSQL multi-process dispatch, previous-release production-shaped upgrade/restore, real provider outcomes and human recovery walkthrough remain separate required evidence.

An operator should inspect legacy holds and their original attempt evidence, including action records with no attempt. Neither approval nor migration clears them. Do not roll back to a runtime that ignores execution holds or automatically retries uncertain historical work.
