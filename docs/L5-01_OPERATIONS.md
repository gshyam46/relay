# L5-01 local operations contract

Recorded 2026-09-13 before implementation under the completion authorization. Root approves this bounded slice; real deployment, PostgreSQL restoration, monitored retention and operator release acceptance remain external gates.

## Ownership and boundaries

Backend owns the static runtime schema manifest, catalog/role verification helpers, explicit SQLite backup and isolated restore-drill tooling, focused tests and evidence. Root owns startup/readiness/deployment wiring, configuration/package scripts and migrations. Latest registry at recording is0022. No runtime path creates or repairs schema, grants privileges or runs a migration.

## Release structural manifest

A committed version1 manifest is generated from a new isolated in-memory database containing the exact ordered release migrations, never from an application database and never during runtime startup. It covers every application table/column (portable type and required nullability), ordered ordinary/unique index columns and directions/partial predicates, and scoped ordered foreign-key columns, referenced keys and delete/update actions. Automatically generated constraint-index names are not portable authority; their actual key shape is.

Read-only SQLite/PostgreSQL catalog comparison must refuse missing/invalid required structures and a manifest whose migration IDs differ from the release registry. Extra structures do not silently replace required ones. Catalog sizes and reported issues are bounded. A static structure check does not prove equivalent arbitrary CHECK predicates, triggers, row contents, cluster configuration or query performance. Existing behavioral constraints/migration fixtures retain that responsibility; no byte-identical DDL claim is made.

schemaVerifier exports inspectRuntimeSchema(db), verifyRuntimeSchema(db,{manifest}) and assertRuntimeSchema(db). Verification returns compatible, manifest_version, tables, columns, indexes, foreign_keys and bounded issues. Assertion uses DATABASE_SCHEMA_INCOMPATIBLE. Startup runs after migration-history checks; readiness reports safe finite status/counts, without dumping catalog names or roles publicly.

## Runtime role verification

PostgreSQL application runtime uses a separate role from migration/backup administrators. verifyRuntimeRole/assertRuntimeRole are read-only and intended for deployed runtime admission and explicit deployment verification, never migration/bootstrap credentials. SQLite remains supported locally with NOT_APPLICABLE role mode.

Required application table access is SELECT/INSERT/UPDATE/DELETE for domain tables and SELECT only for schema_migrations. This is the bounded existing monolith CRUD contract, not a claim of minimum column-level grants. Refuse effective application table, schema or database ownership; membership paths to owner/privileged roles; superuser, create-role, create-database, replication or bypass-RLS authority; CREATE on application schema/database; and effective schema_migrations INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER privileges. Refuse TRUNCATE/REFERENCES/TRIGGER on domain tables. Column-level ledger INSERT/UPDATE/REFERENCES grants are also refused, as are REFERENCES column grants on domain tables, predefined pg_* role membership and table privilege grant-option delegation. Missing Boolean privilege evidence fails closed. No write probe or grant/revoke occurs. Uninspectable or malformed catalog evidence fails closed. PostgreSQL role behavior must also be demonstrated on the disposable PostgreSQL harness and selected real deployment; synthetic catalog fixtures do not establish that external proof.

## Explicit SQLite backup and isolated restore rehearsal

SQLite is the local-development/rehearsal path. A backup command requires explicit absolute existing source and new destination directory. It uses the SQLite engine's consistent backup API, not a potentially torn file/WAL copy. Source is opened read-only; output files are exclusive and never overwrite another artifact. Resolved parents must exist and contain no symbolic links/junctions; source and destination must differ. The command reads no DATABASE_URL, application .env or provider credentials and never starts an app/worker.

Backup metadata contains version, created_at, engine, exact artifact bytes/SHA256, migration IDs, structural fingerprint and table counts only; no credentials or record payloads. Backup files themselves contain private application data and must use deployment-owned access controls/encryption/retention. A checksum detects accidental corruption; it does not authenticate an untrusted backup producer.

Restore rehearsal requires the backup directory and a new explicitly named target directory. Verify metadata/checksum before restoration, restore a consistent copy into that new directory, verify SQLite integrity/foreign keys, migration history, structure and table counts, and emit bounded evidence. It never modifies/replaces an application database, never pumps domain events or releases a pending send, and never starts a provider/model worker. The rehearsal result explicitly records outbound_enabled:false and worker_enabled:false. This is an offline restore-validation artifact, not a production restore installer or an authorization to start that database with sending enabled. Recovered historical attempts, restrictions, review history, account state and clocks are copied exactly.

Partial failures must clean only files/directories exclusively created by the current command after validating exact ownership. Existing targets, source identity, missing parents, symlink/junction components, corrupt/mismatched metadata and incompatible schema are refused. Commands print finite safe error codes without database content, URLs or raw driver errors. CLI operations are explicit flags; inherited database configuration is never a fallback.

## PostgreSQL operator rehearsal

The production database remains PostgreSQL/Supabase-compatible. Use a separate authorized backup role and encrypted provider-managed snapshots or a transactionally consistent pg_dump custom archive. Restore using pg_restore --no-owner --no-acl into a newly provisioned, explicitly isolated PostgreSQL database, never the running application target. Use protected connection/service files rather than command-line passwords. Runtime and migration roles are provisioned separately and reviewed grants applied explicitly; do not copy broad owner grants.

Keep deployment OUTBOUND_DISPATCH_ENABLED=false and WORKER_ENABLED=false before opening the restored application. Use the matching application/migration release, verify the migration ledger and full structural manifest, verify the runtime role, inspect restrictions/approvals/attempt history and compare agreed record/integrity evidence. Uncertain historical sends require actual provider reconciliation before any controlled release. Never reset idempotency records or classify restored unknown attempts as safe retries. Record restore duration/recovery point, operator, isolated target, backup identifier, TLS/role checks and exact outcome; destroy only the explicitly owned rehearsal target after stopping its processes.

Actual PostgreSQL backup/restore execution, retention monitoring, access controls/encryption, recovery objectives, deployment rollback and a restore drill that cannot resend historical messages remain external operator acceptance. No customer database or provider operation is part of implementing these tools.


## Explicit local commands and limits

Run node scripts/generate-schema-manifest.js to inspect the isolated release fingerprint; add --write only when intentionally recording a reviewed migration change. Backup uses node scripts/db-backup.js --source <absolute-existing-file> --destination <absolute-new-directory>. Rehearsal uses node scripts/db-restore-drill.js --backup <absolute-backup-directory> --destination <absolute-new-directory>. No argument defaults to an application database.

Local artifact size is capped at1GiB, metadata at1MiB. Backup checks its page-copy progress against60seconds and the byte cap; this is not a guaranteed wall-clock timeout for subsequent synchronous integrity scans. Catalogs cap256tables,10000columns,5000indexes and5000foreignkeys; public verifier issues cap50. Root may share concurrent readiness work and cache it for at most5seconds; startup/deployment checks remain fresh.

The consistent-copy API is documented by [Node SQLite backup](https://nodejs.org/api/sqlite.html#sqlitebackupsourceDb-path-options). Role inspection uses PostgreSQL [effective privilege functions](https://www.postgresql.org/docs/current/functions-info.html#FUNCTIONS-INFO-ACCESS-TABLE). PostgreSQL archive/restoration options follow the official [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html) and [pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html) documentation. These references do not establish that a selected deployment has completed the drill.


## Later workspace erasure and restored data

A checksum-valid old backup cannot establish erasures or suppression changes recorded after its capture. Before activating any restored application, compare an independent current authoritative lifecycle/erasure and suppression manifest and reconcile the differences under the lifecycle contract. The offline rehearsal does not perform that reconciliation or grant release authority. Never blindly replay deletion commands against newly created records or clear restored suppression history.
