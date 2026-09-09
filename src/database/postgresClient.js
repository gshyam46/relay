import { splitStatements, toPositionalPlaceholders } from "./sql.js";

/**
 * PostgreSQL implementation of the DatabaseClient contract, used for Supabase
 * and any other managed Postgres in staging/production.
 *
 * Two translations happen here and nowhere else in the codebase:
 *
 *  1. Placeholders. Repositories write SQLite-style `?`; this client rewrites
 *     them to `$1..$n` (see `sql.js`).
 *  2. Numeric types. `pg` returns BIGINT (`COUNT(*)`) and NUMERIC (`SUM(...)`)
 *     as JavaScript strings to avoid precision loss. Every such value in this
 *     application is a small counter or aggregate that the API serialises as a
 *     number and the frontend does arithmetic on, so both are parsed to Number
 *     to match SQLite's behaviour exactly. Without this, `COUNT(*)` would arrive
 *     as "12" on Postgres and 12 on SQLite and every dashboard total would
 *     silently become string concatenation.
 */
export class PostgresDatabaseClient {
  constructor(pool) {
    this.kind = "postgres";
    this.pool = pool;
  }

  /**
   * Opens a pool against `connectionString`.
   *
   * `pg` is imported dynamically so that SQLite-only environments (local
   * development, the test suite, CI) never load the driver and never need it
   * installed for anything to work.
   */
  static async connect({ connectionString, ssl = true, maxConnections = 10, connectionTimeoutMillis = 10000 }) {
    let pg;
    try {
      pg = (await import("pg")).default;
    } catch (cause) {
      const error = new Error(
        "DATABASE_URL is set to a PostgreSQL connection string but the 'pg' driver is not installed. Run `npm install` in the deployment environment."
      );
      error.cause = cause;
      throw error;
    }

    // BIGINT (oid 20) and NUMERIC (oid 1700) — see the class comment.
    pg.types.setTypeParser(20, (value) => (value === null ? null : Number(value)));
    pg.types.setTypeParser(1700, (value) => (value === null ? null : Number(value)));

    const pool = new pg.Pool({
      connectionString,
      max: maxConnections,
      connectionTimeoutMillis,
      // Supabase (and most managed Postgres) terminate TLS with a certificate
      // chain that is not in Node's default trust store for the pooler
      // hostname. Verification is therefore relaxed while the transport stays
      // encrypted. `DATABASE_SSL=disable` turns TLS off entirely for a local
      // Postgres container.
      ssl: ssl ? { rejectUnauthorized: false } : false
    });

    // Surface pool-level failures (a dropped idle connection, a server restart)
    // instead of letting them reach the process as an unhandled 'error' event,
    // which would take the whole server down.
    pool.on("error", (error) => {
      console.error(
        JSON.stringify({
          level: "error",
          event: "database.pool_error",
          message: error.message,
          time: new Date().toISOString()
        })
      );
    });

    const client = new PostgresDatabaseClient(pool);
    await client.get("SELECT 1");
    return client;
  }

  async exec(sql) {
    // `pg` accepts multi-statement scripts only through the simple query
    // protocol, which is exactly what a parameterless `query()` call uses.
    await this.pool.query(sql);
  }

  async run(sql, params = []) {
    const result = await this.pool.query(toPositionalPlaceholders(sql), params);
    return { changes: result.rowCount };
  }

  async get(sql, params = []) {
    const result = await this.pool.query(toPositionalPlaceholders(sql), params);
    return result.rows[0];
  }

  async all(sql, params = []) {
    const result = await this.pool.query(toPositionalPlaceholders(sql), params);
    return result.rows;
  }

  async columnExists(tableName, columnName) {
    const row = await this.get(
      `SELECT 1 AS present
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = ?
          AND column_name = ?`,
      [tableName, columnName]
    );
    return Boolean(row);
  }

  /**
   * Runs `work` inside a transaction on a single pooled connection.
   *
   * The callback receives a client bound to that one connection, so every
   * statement it issues participates in the transaction. Statements issued
   * against the outer client during `work` would take a different connection and
   * would NOT be transactional — callers must use the client they are given.
   */
  async transaction(work) {
    const connection = await this.pool.connect();
    const scoped = new PostgresConnectionClient(connection);
    try {
      await connection.query("BEGIN");
      const result = await work(scoped);
      await connection.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await connection.query("ROLLBACK");
      } catch {
        // A failed rollback must not mask the original error.
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

/**
 * The same contract, pinned to one checked-out connection, so that everything a
 * `transaction()` callback runs lands inside that transaction.
 */
class PostgresConnectionClient {
  constructor(connection) {
    this.kind = "postgres";
    this.connection = connection;
  }

  async exec(sql) {
    for (const statement of splitStatements(sql)) {
      await this.connection.query(statement);
    }
  }

  async run(sql, params = []) {
    const result = await this.connection.query(toPositionalPlaceholders(sql), params);
    return { changes: result.rowCount };
  }

  async get(sql, params = []) {
    const result = await this.connection.query(toPositionalPlaceholders(sql), params);
    return result.rows[0];
  }

  async all(sql, params = []) {
    const result = await this.connection.query(toPositionalPlaceholders(sql), params);
    return result.rows;
  }

  async columnExists(tableName, columnName) {
    const row = await this.get(
      `SELECT 1 AS present
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = ?
          AND column_name = ?`,
      [tableName, columnName]
    );
    return Boolean(row);
  }

  async transaction(work) {
    // Already inside one — Postgres would need SAVEPOINTs for true nesting, and
    // nothing in this codebase nests transactions.
    return work(this);
  }
}
