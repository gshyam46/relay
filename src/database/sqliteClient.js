import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

/**
 * Async SQLite boundary. Independent callers share a serial connection queue;
 * a transaction callback must use its scoped client, never the outer client.
 * SQLite remains a local-development aid, not PostgreSQL concurrency proof.
 */
export class SqliteDatabaseClient {
  #connection;
  #queue = Promise.resolve();
  #context = new AsyncLocalStorage();
  #closing = false;
  #closed = false;
  #closePromise;

  constructor(databaseFile = ":memory:", { readOnly = false } = {}) {
    this.kind = "sqlite";
    this.databaseFile = databaseFile;
    this.#connection = openSqliteConnection(databaseFile, readOnly);
  }

  async exec(sql) {
    return this.#schedule(() => this.#connection.exec(sql));
  }

  async run(sql, params = []) {
    return this.#schedule(() => this.#connection.prepare(sql).run(...params));
  }

  async get(sql, params = []) {
    return this.#schedule(() => this.#connection.prepare(sql).get(...params));
  }

  async all(sql, params = []) {
    return this.#schedule(() => this.#connection.prepare(sql).all(...params));
  }

  async columnExists(tableName, columnName) {
    return this.#schedule(() => columnExists(this.#connection, tableName, columnName));
  }

  /**
   * Acquires the write reservation before invoking work exactly once. Only
   * BEGIN may retry for local contention; domain work is never replayed.
   * Nested transactions are rejected instead of implicitly joined.
   */
  async transaction(work, { lockTimeoutMs = 5000 } = {}) {
    if (typeof work !== "function") throw new TypeError("Transaction work must be a function.");
    if (!Number.isFinite(lockTimeoutMs) || lockTimeoutMs < 0) {
      throw new TypeError("Transaction lockTimeoutMs must be a non-negative finite number.");
    }
    return this.#schedule(async () => {
      const state = { active: true, failure: null };
      const tx = new SqliteTransactionClient(this.#connection, state, this.#context);
      Object.defineProperty(tx, 'rootDatabase', { value: this, enumerable: false, writable: false });
      await beginImmediate(this.#connection, lockTimeoutMs);
      try {
        let result;
        try {
          result = await this.#context.run(state, () => work(tx));
        } finally {
          state.active = false;
        }
        if (state.failure) throw state.failure;
        this.#connection.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          this.#connection.exec("ROLLBACK");
        } catch {
          // Never reuse a connection whose transactional state is unknown.
          this.#closed = true;
          try { this.#connection.close(); } catch { /* Preserve the original failure. */ }
        }
        throw error;
      } finally {
        state.active = false;
      }
    });
  }

  async close() {
    this.#assertOuterContext();
    if (this.#closePromise) return this.#closePromise;
    if (this.#closed) return;
    this.#closing = true;
    this.#closePromise = this.#queue.then(() => {
      if (this.#closed) return;
      try {
        this.#connection.close();
      } finally {
        this.#closed = true;
      }
    });
    return this.#closePromise;
  }

  #assertOuterContext() {
    if (this.#context.getStore()) {
      throw new Error("Use the transaction-scoped client inside transaction work; outer database access is forbidden.");
    }
  }

  #schedule(work) {
    this.#assertOuterContext();
    if (this.#closing || this.#closed) throw new Error("Database client is closed.");
    const operation = this.#queue.then(() => {
      if (this.#closed) throw new Error("Database client is closed.");
      return work();
    });
    this.#queue = operation.catch(() => {});
    return operation;
  }
}

class SqliteTransactionClient {
  #connection;
  #state;
  #context;

  constructor(connection, state, context) {
    this.transactionBound = true;
    this.kind = "sqlite";
    this.#connection = connection;
    this.#state = state;
    this.#context = context;
  }

  async exec(sql) {
    return this.#perform(() => this.#connection.exec(sql));
  }

  async run(sql, params = []) {
    return this.#perform(() => this.#connection.prepare(sql).run(...params));
  }

  async get(sql, params = []) {
    return this.#perform(() => this.#connection.prepare(sql).get(...params));
  }

  async all(sql, params = []) {
    return this.#perform(() => this.#connection.prepare(sql).all(...params));
  }

  async columnExists(tableName, columnName) {
    return this.#perform(() => columnExists(this.#connection, tableName, columnName));
  }

  async transaction() {
    this.#assertActive();
    throw new Error("Nested transactions are not supported; compose work with the existing transaction-scoped client.");
  }

  async close() {
    this.#assertActive();
    throw new Error("A transaction-scoped client cannot close its database.");
  }

  #assertActive() {
    if (!this.#state.active) throw new Error("Transaction-scoped client is closed.");
    if (this.#context.getStore() !== this.#state) {
      throw new Error("Transaction-scoped client used outside its owning transaction context.");
    }
  }

  #perform(work) {
    this.#assertActive();
    if (this.#state.failure) throw this.#state.failure;
    try {
      return work();
    } catch (error) {
      this.#state.failure = error;
      throw error;
    }
  }
}

function columnExists(connection, tableName, columnName) {
  const quotedName = '"' + String(tableName).replaceAll('"', '""') + '"';
  return connection.prepare("PRAGMA table_info(" + quotedName + ")").all()
    .some((column) => column.name === columnName);
}

async function beginImmediate(connection, lockTimeoutMs) {
  const deadline = performance.now() + lockTimeoutMs;
  for (;;) {
    try {
      connection.exec("BEGIN IMMEDIATE");
      return;
    } catch (error) {
      const code = Number(error.errcode) & 255;
      if ((code !== 5 && code !== 6) || performance.now() >= deadline) throw error;
      await delay(Math.min(25, Math.max(1, deadline - performance.now())));
    }
  }
}

function openSqliteConnection(databaseFile, readOnly) {
  if (databaseFile !== ":memory:" && !readOnly) {
    mkdirSync(path.dirname(path.resolve(databaseFile)), { recursive: true });
  }
  const db = new DatabaseSync(databaseFile, { readOnly });
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}
