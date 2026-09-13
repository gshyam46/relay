# L1-03 Runtime and Migration-Job Boundary

Product: **AI Lead Intelligence & Outbound Automation**.
Date: **2026-09-11**.
Scope: runtime database opening, startup, explicit migration configuration, inspection CLI and staging blueprint.
Status: implemented with local regression evidence. Real PostgreSQL and human deployment acceptance remain pending.

## Completed behavior

Normal server startup opens an existing database and reads migration state before listening. Missing SQLite files/directories are not created. Uninitialized, pending and incompatible migration histories refuse startup with a safe error category. The separately validated disposable E2E memory harness is the only server path that explicitly bootstraps its database.

The explicit createDatabase bootstrap helper still supports fixtures, local initialization and migration tooling. It passes migration options to the runner, rolls back according to the runner/client contract, and closes its client when migration fails.

db:status uses native read-only SQLite opening and read-only catalog/history queries. verify:deploy no longer applies migrations: it verifies current PostgreSQL history, required tables and actual valid uniqueness of the required indexes. Both commands fail on incompatible histories even when all known migration IDs are present. CLI failures use fixed safe messages rather than database-provided errors, SQL, connection strings or stacks. All CLI cleanup is awaited through finally and exit status uses process.exitCode.

db:migrate uses loadMigrationConfig. Staging and production require explicit MIGRATION_DATABASE_URL supplied only to a separate authorized migration job. Local migration commands retain the DATABASE_URL/DATABASE_FILE fallback. The runtime loadConfig ignores migration credentials.

Render pre-deploy now executes read-only verify:deploy with the runtime DATABASE_URL. The blueprint does not provision the separate migration job or roles and does not inject migration secrets into the web service. Automated worker execution in that staging blueprint is disabled pending L1 dispatch gates; the application's normal config default is unchanged.

## Files and contracts

- [database.js](../../src/database/database.js): openDatabaseClient(target, { readOnly, requireExisting }), openRuntimeDatabase(target), failed-bootstrap cleanup, strict sqlite/postgres driver selection and describeDatabaseFailure(error).
- [server.js](../../src/server.js): existing-schema startup and the verified E2E bootstrap exception; safe startup refusal before listen.
- [config.js](../../src/config.js): additive loadMigrationConfig; existing runtime/test-control selection remains intact.
- [db-migrate.js](../../scripts/db-migrate.js), [db-status.js](../../scripts/db-status.js), [verify-deployment.js](../../scripts/verify-deployment.js): explicit mutation versus inspection boundaries, safe errors and awaited close.
- [render.yaml](../../render.yaml) and [.env.example](../../.env.example): separate migration-job deployment ordering and configuration guidance.
- [runtime-database.test.js](../../test/runtime-database.test.js): behavior, subprocess startup/CLI and guarded PostgreSQL tests.

Additional migration configuration is MIGRATION_DATABASE_URL, MIGRATION_DATABASE_SSL, MIGRATION_DATABASE_MAX_CONNECTIONS and MIGRATION_DATABASE_CONNECTION_TIMEOUT_MS. The migration pool defaults to one connection. URL selection is explicit in deployed environments, but configuration alone cannot prove that privileges were provisioned correctly.

Safe failure categories include DATABASE_FILE_REQUIRED, DATABASE_NOT_INITIALIZED, DATABASE_MIGRATIONS_PENDING, MIGRATION_HISTORY_INCOMPATIBLE, MIGRATION_LEGACY_REVIEW_REQUIRED, MIGRATION_DATABASE_REQUIRED and MIGRATION_DATABASE_INVALID; unexpected database errors use DATABASE_OPERATION_FAILED.

No domain API, authentication cookie, action state or application schema contract is introduced by this runtime slice. Related schema/transaction changes belong to the other L1-03 slices and [persistence contract](../L1-03_PERSISTENCE.md).

## Verification performed

Commands ran through the sanitized, disposable SQLite launcher, with no application database, real provider or filled environment file used:

~~~powershell
node scripts/run-tests.js test/runtime-database.test.js
node scripts/run-tests.js test/runtime-database.test.js test/production-foundation.test.js test/test-harness-safety.test.js
node scripts/format-check.js
git diff --check
~~~

Results:

- Runtime-specific suite: **14 tests, 13 passed, 1 guarded PostgreSQL test skipped**.
- Runtime plus existing configuration/foundation/harness suites: **43 tests, 42 passed, 1 PostgreSQL test skipped**.
- Scoped JavaScript syntax checks passed.
- Formatting passed for 170 files at that check; git diff --check passed, with the existing AGENTS.md CRLF advisory only.

Behavior verified: missing-file preservation, strict drivers, byte-preserving inspection of empty/current/pending/future SQLite databases, no write/transaction invocation during runtime opening, native read-only write refusal, rollback and close after failed bootstrap, separate migration target selection, redacted malformed-URL errors, explicit local migration, refusal before listen, the E2E-only bootstrap path, and readiness changing to 503/schema_incompatible after an independently applied newer migration marker.

An initial test cleanup hook attempted Windows file removal before stopping its owned server. The test hook ordering was fixed; only the failed test runs' owned server descendants were stopped. The subsequent targeted and combined runs passed. This was a fixture cleanup failure, not evidence of a successful earlier run.

## Limits and human QA

PostgreSQL inspection remains SELECT/catalog-only code with caller-supplied privileges; the generic readOnly opening option does not create a pool-wide PostgreSQL read-only session. The guarded PostgreSQL test uses an owned disposable schema with default_transaction_read_only enabled to detect accidental writes. It was skipped locally and must run through the dedicated PostgreSQL harness.

A passing read-only transaction test does not establish real restricted-role grants, migration-job provisioning, TLS verification, database availability, restore safety, provider delivery or safe concurrent sends. Existing adapter TLS certificate verification and unsafe deployed TLS-option refusal remain L1-10. Worker draining and durable dispatch recovery remain L1-05.

Before deployed acceptance, an operator must:

1. Verify the separate application and migration roles, database/schema target and job-only secret placement.
2. Rehearse an authorized migration on an isolated populated prior-release copy, inspect any legacy authorization review refusal, and retain historical records.
3. Start with the restricted runtime role, run status/readiness/deployment verification, and demonstrate that missing privileges or incompatible history fail without DDL or secret exposure.
4. Rehearse the compatible application rollback or roll-forward procedure and restore path.
5. Record actual PostgreSQL, hosting and human evidence before closing the L1-03 task.

No staging/production job, database migration, deployment or real send was performed by this implementation slice.
