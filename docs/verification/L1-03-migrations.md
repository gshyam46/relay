# L1-03 migration verification

Date: 2026-09-11. Product: **AI Lead Intelligence & Outbound Automation**.

## Scope and contract

This is the migration portion of L1-03. The user authorized the next implementation batch after the documented ADR-002/ADR-009 plan. The integrating owner accepted the concrete transaction and migration contracts before dependent implementation. [TASKS.md](../TASKS.md) owns overall task status; this record does not certify PostgreSQL or pilot readiness.

Changed files:

- [Migration runner](../../src/database/migrate.js).
- [Explicit migration registry](../../src/database/migrations/index.js).
- [Forward reconciliation](../../src/database/migrations/0002_runtime_column_reconciliation.js).
- [Behavior tests](../../test/migration-safety.test.js).

The original [0001 baseline](../../src/database/migrations/0001_baseline_schema.js) is unchanged. Runtime startup, database-client transaction ownership, CLI privilege separation, and their verification belong to the integrating implementation; they are not implied by this isolated test result.

runMigrations(db, { logger, migrations, lockTimeoutMs }) returns IDs applied by that call. The default registry is explicitly ordered; migrations is an injectable test contract. IDs must use unique increasing four-digit prefixes, valid names, and callable up methods. Lock timeout defaults to 10000 ms and accepts integer values from 1 to 60000. This bounds lock acquisition, not total migration duration.

getMigrationStatus(db, { migrations }) performs catalog/history SELECTs only. Its existing applied/pending/total fields remain; initialized, compatible, unknown and outOfOrder are additive. A missing ledger is uninitialized with all versions pending. Unknown/newer history and gaps are incompatible. Startup/readiness must inspect compatible as well as pending: a newer database can have no known pending migration and still require another application release.

Each pending migration executes together with its version marker in one transaction. Lock acquisition precedes ledger creation and history inspection:

- SQLite uses the database client's BEGIN IMMEDIATE and asynchronous bounded acquisition retry. The migration callback is never replayed automatically.
- PostgreSQL uses a transaction-scoped advisory lock keyed by the current database and schema, with transaction-local lock_timeout, on the transaction's pinned connection.
- The runner rereads history under each new lock. Concurrent migrators may share the ordered work, but cannot both apply one version.
- A failure rolls back that migration and its marker; earlier committed migrations survive. Retrying requires an explicit call.
- A bad registry is rejected before database access. Incompatible recorded history is rejected before migration DDL or business-data writes.

Migrations must use transactional DDL and database work only. No provider/network calls, concurrent-index creation, or implicit callback retry is supported.

## Forward upgrade and historical evidence boundary

Migration 0002 explicitly reconciles the extension columns already required by current auth, lead, intelligence, action, callback, message, and follow-up repositories. It adds missing dependent indexes and fills only missing normalized email and structural source metadata. It neither imports nor replays the baseline.

The populated fixture retains an applied 0001 marker and core tables, then omits extension columns. This is an explicit synthetic supported prior shape. Repository history inspected during this change showed one original baseline commit; no production incident or observed released schema drift is claimed. Missing base tables, arbitrary type/constraint corruption, and duplicate data preventing a unique index require investigation; this migration does not silently rebuild them.

For marked schemas missing authorization metadata:

- Missing user role becomes UNASSIGNED; no owner or password is invented. Restore authorized account access through a reviewed administrative recovery procedure before use.
- Missing approval requirement becomes REQUIRED. If approval, execution-mode or provider columns were absent, PLANNED, AWAITING_APPROVAL, APPROVED and RETRYING actions become BLOCKED with an explanatory error. Review the intended recipient, sender, content and permission before creating a new intent.
- EXECUTING attempts are not restarted or declared successful. Reconcile them with available provider/history evidence before recovery.
- Completed and failed status history, existing roles/approval values, message payloads, and contact restrictions remain unchanged.
- A missing normalized phone stays unknown; no country interpretation or consent is inferred.

Pre-runner adoption now checks historical authorization structure before any baseline DDL or ledger creation. Existing users must already contain role and password_hash; existing actions must already contain approval_requirement, execution_mode and provider. Missing protected fields fail with MIGRATION_LEGACY_REVIEW_REQUIRED, preserving the database for reviewed offline remediation. This prevents the immutable baseline's original defaults from silently assigning OWNER or NOT_REQUIRED to unknown historical records. The same refusal applies if an empty ledger exists but no baseline is recorded.

The successful pre-runner fixture contains a populated organizations table without a ledger; baseline adoption plus the forward version preserves it. No universal legacy reconstruction tool is claimed. Inventory actual schemas and authorization records in an isolated copy, validate authorized user-role/password recovery and quarantine/reconcile old work, then establish the required explicit fields through a reviewed migration procedure. Do not insert a baseline marker or assign permissive defaults merely to bypass the refusal.

## Automated results

Executed through the sanitized launcher:

~~~powershell
node scripts/run-tests.js test/migration-safety.test.js
~~~

Result: 16 tests total, 13 passed, 3 PostgreSQL integration cases skipped, 0 failed.

Passed behavior:

- Read-only empty-schema status with no migration table creation.
- Fresh install, ordered version recording, and idempotent rerun.
- Malformed registry and invalid timeout refusal before database access.
- Unknown/newer and gapped history reported incompatible without repairs.
- Migration-body failure and version-marker failure roll back together.
- Populated pre-runner adoption and marked-baseline forward repair.
- Pre-runner users/actions missing each protected authorization field fail before baseline DDL, preserve records/schema, and do not create a version ledger.
- Current baseline upgrade preserves existing account/action values.
- Two SQLite connections compete for one migration without duplicate execution.
- Bounded lock timeout leaves state unchanged and allows a later explicit retry.
- A child process exits during migration DDL/data work; reopen preserves the prior committed version, rolls back interrupted work, and successfully applies the pending version.

The PostgreSQL cases are implemented behind the existing explicit disposable-target harness: populated upgrade, two-connection migration serialization/timeout, and failed-migration rollback. They were not executed in this local result. SQLite tests, mocked connections, or source review do not replace real PostgreSQL evidence.

## Human and operational QA still required

Before an environment upgrade, inspect its schema/history and account/action state using an isolated restored copy. Record versions, row counts and critical histories; prove the expected repairs; inspect blocked or in-flight legacy actions and accounts requiring explicit recovery. Keep worker dispatch paused during migration and reconciliation.

Use the dedicated migration role to apply versions. Verify readiness and application startup with the restricted runtime role and with no DDL grants. Test PostgreSQL concurrent deployment, interruption, and restore behavior on the explicit disposable environment before closing the corresponding gate.

These migrations are additive and provide no automatic down migration. Prefer a verified roll-forward repair. Integration added an AWAITING_APPROVAL guard for new pending reviews and decisions: missing or stale pending metadata cannot reactivate blocked, completed or in-flight actions, and repeating an existing decision preserves later execution state. Explicit legacy recovery and immutable content/recipient authorization remain later work; schema repair is not permission to replay historical sends.

Any rollback build must explicitly support the database's recorded history and expanded schema; an older build with unknown versions is expected to fail closed. Do not delete migration markers or rerun old baseline code to force startup.

No application/customer database, cloud project, live provider, or real recipient was used for this verification.
