# L1-03 transaction-client foundation

Date: 2026-09-11.
Product: **AI Lead Intelligence & Outbound Automation**.
Owner: transaction_clients agent; root owns integration and task acceptance.
Decision: [ADR-002](../DECISIONS.md#adr-002-operational-transactions-and-database-specific-claims).

## Implemented scope

- [SQLite client](../../src/database/sqliteClient.js): a connection queue prevents unrelated requests from joining an async transaction. Transactions reserve the write lock with BEGIN IMMEDIATE before invoking domain work.
- [PostgreSQL client](../../src/database/postgresClient.js): each transaction checks out one pooled connection and passes a distinct scoped client to its callback.
- [Behavioral regressions](../../test/transaction-clients.test.js): 29 cases covering real SQLite persistence/contention/read-only behavior and PostgreSQL client lifecycle through a local pool double.

No schema, provider adapter, action claim, suppression, or immutable approval-envelope behavior is implemented in these client files. Root and the migration owner integrate the separate L1-03 slices.

## Exact client contract

~~~javascript
const result = await db.transaction(async (tx) => {
  // Rebuild every participating repository with tx.
  await recordsRepositoryUsingTx.write();
  await auditRepositoryUsingTx.write();
  return resultForCaller;
}, { lockTimeoutMs: 5000 });
~~~

- Scoped clients expose kind and transactionBound = true, plus exec, run, get, all, columnExists, transaction and close.
- transaction and close on a live scoped client explicitly reject. Nested transactions do not implicitly join, open savepoints or replay the callback.
- Use of the outer database client from the callback's async context rejects. This catches repositories accidentally retained on the pool handle.
- A scoped handle can only execute in its owning async context and while the callback is active. It rejects after commit, rollback or callback completion, including detached async work.
- Every scoped database operation should be awaited. PostgreSQL drains operations admitted before callback completion before COMMIT/ROLLBACK and connection release; later operations cannot enter that transaction.
- A statement error aborts the unit even if domain work catches it. It cannot silently commit a partial SQLite unit or report success from PostgreSQL's aborted transaction state.
- Domain callbacks execute at most once per transaction invocation. Deadlocks, query errors and COMMIT failures are returned to the caller, never automatically replayed.
- Keep HTTP/provider/LLM calls outside transactions. This is an application persistence boundary, not a sandbox for untrusted SQL.

## Concurrency and cleanup

SQLite queues independent root operations behind accepted work on that client. Another client opening the same file can retry only lock acquisition, asynchronously, up to lockTimeoutMs. The default is 5000 ms; zero makes acquisition fail immediately if busy. Lock waits use a monotonic deadline. The callback has not run if acquisition fails.

PostgreSQL permits unrelated callers to use other pool connections while a transaction runs. lockTimeoutMs is the SQLite acquisition option; PostgreSQL lock timeout is configured by the participating operation, such as the migration runner's transaction-local setting. No PostgreSQL isolation-level change or queue-claim algorithm is introduced here.

The outer close operation refuses new work and waits for already accepted work before closing the SQLite connection or PostgreSQL pool. Scoped close cannot close/release the shared resource. A failed SQLite rollback retires the connection. PostgreSQL BEGIN/COMMIT failures or failed rollback discard the checked-out connection; the original transaction error remains the reported error. The initial PostgreSQL connection probe now closes the pool if opening fails. Pool error events emit a fixed message and an explicitly whitelisted error code; server text, URLs and stacks cannot bypass the CLI error-redaction path. A local event-emitting pool double verifies this without loading pg or opening a socket.

A lost COMMIT acknowledgement can leave a database outcome uncertain. This client returns that error and does not retry business work. Future durable command/dispatch recovery must reconcile its own persisted identity and outcome.

## Read-only SQLite inspection

~~~javascript
new SqliteDatabaseClient(existingFile, { readOnly: true });
~~~

This uses the engine's read-only connection mode, refuses writes and does not create a missing file or its directory. Runtime existing-file checks and CLI adoption belong to the facade/tooling integration. PostgreSQL inspection uses SELECT-only code plus appropriate database role privileges; this change does not claim a read-only role exists.

## Verification

Executed through the environment-sanitizing local harness:

~~~powershell
node scripts/run-tests.js test/transaction-clients.test.js test/production-foundation.test.js test/postgres-adapter.test.js test/migration-safety.test.js
~~~

Result: **64 tests, 57 passed, 7 explicitly skipped, 0 failures**.

The 29 dedicated client tests cover commit/rollback across writes; poisoned statements; root/scoped escape and lifetime; independent same-client transactions; same-file two-client contention and timeout; close draining; true read-only files; SQLite deferred-constraint COMMIT failure and automatic rollback cleanup; PostgreSQL pinned connections, placeholder forwarding, BEGIN/COMMIT/ROLLBACK failures, pending-query drain and independent connections; and pool-event log redaction.

Initial test assertions compared SQLite's null-prototype rows with plain-object literals. Those assertions were corrected to compare persisted values without changing the driver or weakening the behavioral conditions. The final combined run also includes the migration owner's corrected fixture comparisons, cleanup order and pre-runner authorization guard. Independent review found that an unmarked legacy schema could receive permissive defaults from the immutable baseline before the forward repair saw it; the migration owner now refuses ambiguous missing authorization fields before baseline DDL, with a preservation regression.

## Remaining acceptance and human QA

- The seven skipped tests require an explicitly acknowledged disposable PostgreSQL target. Local lifecycle doubles do not establish PostgreSQL locking, pooler, TLS, real connection loss or multi-process behavior.
- No customer database, Supabase account, production migration or real provider was used.
- Approval/action/callback/import services still need their own transaction composition and invariant tests. A scoped client alone does not make existing multi-record workflows atomic.
- User-facing/browser QA is not part of this low-level client slice. L1-03 acceptance still requires the root integration record, prior-schema upgrade/compatible rollback walkthrough and real PostgreSQL evidence.
- Existing global numeric coercion and relaxed PostgreSQL TLS configuration remain separate documented work; these clients do not claim those launch gates are solved.

Next: integrate transaction-bound repositories and migration/runtime privilege separation, then validate the composed business command against rollback and competing requests.
