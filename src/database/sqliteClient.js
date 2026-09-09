import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * SQLite implementation of the DatabaseClient contract.
 *
 * `node:sqlite` is synchronous, but every method here is declared `async` so
 * that SQLite and PostgreSQL expose the identical promise-returning contract
 * (`exec`, `run`, `get`, `all`, `columnExists`, `transaction`, `close`). Awaiting
 * a synchronous result costs one microtask and nothing else, so local
 * development and the test suite keep SQLite's real behaviour — in particular,
 * writes are still durable the instant the promise settles.
 */
export class SqliteDatabaseClient {
  constructor(databaseFile = ":memory:") {
    this.kind = "sqlite";
    this.databaseFile = databaseFile;
    this.connection = openSqliteConnection(databaseFile);
  }

  async exec(sql) {
    this.connection.exec(sql);
  }

  async run(sql, params = []) {
    return this.connection.prepare(sql).run(...params);
  }

  async get(sql, params = []) {
    return this.connection.prepare(sql).get(...params);
  }

  async all(sql, params = []) {
    return this.connection.prepare(sql).all(...params);
  }

  async columnExists(tableName, columnName) {
    const columns = this.connection.prepare(`PRAGMA table_info(${tableName})`).all();
    return columns.some((column) => column.name === columnName);
  }

  /**
   * Runs `work` inside a transaction, rolling back if it throws.
   *
   * The callback receives this same client rather than a dedicated connection —
   * SQLite here is a single connection, so there is nothing else to hand out.
   */
  async transaction(work) {
    this.connection.exec("BEGIN");
    try {
      const result = await work(this);
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.connection.exec("ROLLBACK");
      } catch {
        // A failed rollback (for example because the transaction was already
        // aborted) must not mask the original error.
      }
      throw error;
    }
  }

  async close() {
    this.connection.close();
  }
}

function openSqliteConnection(databaseFile) {
  if (databaseFile !== ":memory:") {
    mkdirSync(path.dirname(path.resolve(databaseFile)), { recursive: true });
  }

  const db = new DatabaseSync(databaseFile);
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}
