# L1-03 Persistence Implementation Contract

Product: **AI Lead Intelligence & Outbound Automation**.
Date: 2026-09-11.
Status: agreed implementation contract for the user-authorized L1-03 slice; verification tracked separately.

## Decision and smallest change

ADR-002 identified a conflict: the old database facade restricted transactions to migrations and implied identical SQL everywhere. Related approval/action/audit changes require operational atomicity. The user approved continuing L1-03 after that plan. Keep the modular monolith, async driver, repository constructors and standard PostgreSQL adapter. Add transaction-scoped composition and narrowly isolated engine-specific locking; do not introduce an ORM, broker or microservices.

## Transaction and composition API

- db.transaction(async tx => result, { lockTimeoutMs }) invokes the callback once after acquiring its transaction. There is no automatic replay of business work.
- tx is a distinct client with transactionBound=true. Every participating repository is created with tx. Parent-client calls from that callback context, nested transactions, tx.close and use after completion fail explicitly.
- SQLite uses BEGIN IMMEDIATE and queues independent work sharing one connection. A bounded asynchronous retry may acquire BEGIN when another connection holds a lock; it never reruns the callback.
- PostgreSQL pins one checked-out connection, rolls back failed work and destroys unusable connections. A caught statement failure cannot silently commit a poisoned transaction.
- createUnitOfWork(db, buildContext).run(work) builds fresh scoped repositories/services inside the transaction; contexts must not escape the callback.
- First operational adoption: approval lookup/request/approve/reject use an actions/approvals/audit context. Decision operations lock the tenant-owned action before reading approval state (PostgreSQL FOR UPDATE, SQLite write transaction), then persist payload, approval, action status and audit together.
- Compatibility guard discovered during integration: only AWAITING_APPROVAL actions may acquire a new pending review or transition from pending to approved/rejected. Existing decisions remain readable/idempotent without resetting execution status. Blocked, executing, completed or otherwise non-reviewable legacy work needs explicit later recovery; ordinary approval must not reactivate it.
- External sends, LLM calls and arbitrary workflow execution remain outside transactions. Atomic approval does not implement immutable approved envelopes or atomic dispatch; those remain L1-08/L1-05.

## Migration and startup API

- runMigrations(db, { logger, migrations, lockTimeoutMs }) validates the registry, locks before ledger creation/history reads, rereads under the lock and applies a migration plus its marker atomically.
- getMigrationStatus(db, { migrations }) uses SELECT/catalog inspection only. Existing applied/pending/total fields remain; initialized, compatible, unknown and outOfOrder explain absent or incompatible history.
- Applied IDs must be a known contiguous registry prefix. Unknown/newer IDs, gaps and malformed registries fail closed; do not write a ledger on incompatible history.
- PostgreSQL serializes migration transactions using a lock scoped to the database/schema; SQLite uses its write reservation. Concurrent deploys reread history after lock acquisition.
- Preserve 0001_baseline_schema unchanged. Add 0002_runtime_column_reconciliation for the explicitly supported missing extension columns/indexes. This is a synthetic supported repair contract, not evidence of a deployed incident.
- Missing legacy authorization fields receive conservative defaults and pending actions require review; never invent an owner or approval. Existing correctly shaped records remain unchanged.
- createDatabase remains an explicit bootstrap helper for fixtures, local initialization and migration tooling, and closes failed connections.
- openRuntimeDatabase requires an existing current schema and performs no DDL. Normal development, staging and production startup use it. The verified disposable E2E memory harness may explicitly bootstrap its own empty database.
- db:status and verify:deploy inspect without applying migrations. Missing SQLite files are not created by inspection/runtime startup.
- db:migrate alone applies migrations. Deployed migration commands require MIGRATION_DATABASE_URL supplied to a separate controlled job, with runtime DATABASE_URL using application privileges. Migration secrets must not be added to the running web service.
- Render pre-deploy verification becomes read-only; a separate authorized migration job must finish before deployment. A blueprint is not proof that roles, secrets or cloud jobs have been provisioned.

## Acceptance and limits

Automated checks: rollback across real approval repositories, successful commit, competing decisions, escaped/nested transaction rejection, statement/commit/rollback failure, file-lock contention, old populated schema repair, baseline immutability, migration marker rollback, concurrent migration attempts, unknown history, runtime/status no-DDL, missing-file preservation and startup refusal before listening.

PostgreSQL fixtures are guarded by the dedicated disposable harness. SQLite tests and injected pool doubles do not substitute for PostgreSQL concurrency, restricted-role and deployment/restore evidence. Human QA must rehearse a populated upgrade, review any legacy role/action remediation and confirm compatible app rollback/roll-forward before a real release.

Sources consulted for the driver and locking boundary: [node-postgres transactions](https://node-postgres.com/features/transactions), [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html), [Node SQLite API](https://nodejs.org/api/sqlite.html). These support the client/lock mechanics; repository behavior is verified by project tests.
