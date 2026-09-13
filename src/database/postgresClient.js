import { loadConfig } from "../config.js";
import { buildPostgresOptions, databasePolicyError } from "./connectionPolicy.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { splitStatements, toPositionalPlaceholders } from "./sql.js";

const SAFE_POOL_ERROR_CODES = new Set([
  "08000", "08001", "08003", "08004", "08006", "08007", "08P01",
  "57P01", "57P02", "57P03", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT",
  "EPIPE", "ENOTFOUND", "EAI_AGAIN"
]);

/**
 * PostgreSQL implementation of the DatabaseClient contract, used for Supabase
 * and any other managed Postgres in staging/production.
 *
 * Two translations happen here and nowhere else in the codebase:
 *
 *  1. Placeholders. Repositories write SQLite-style `?`; this client rewrites
 *     them to `$1..$n` (see `sql.js`).
 *  2. Legacy numeric compatibility. BIGINT/NUMERIC currently map to Number
 *     because existing dashboard counts and sums expect numeric responses.
 *     This can lose precision for large integers and exact decimals. Do not
 *     use this parser as an amount/currency contract; exact monetary/usage
 *     representation and precision tests remain documented follow-up work.
 */
export class PostgresDatabaseClient {
  #pool;
  #context = new AsyncLocalStorage();
  #operations = new Set();
  #closing = false;
  #closed = false;
  #closePromise;

  constructor(pool) {
    this.kind = "postgres";
    this.#pool = pool;
    // Surface pool-level failures (a dropped idle connection, a server restart)
    // instead of letting them reach the process as an unhandled 'error' event,
    // which would take the whole server down.
    pool.on?.("error", (error) => {
      console.error(
        JSON.stringify({
          level: "error",
          event: "database.pool_error",
          message: "Database pool connection failed; inspect connectivity and database health.",
          code: SAFE_POOL_ERROR_CODES.has(error?.code) ? error.code : "DATABASE_POOL_ERROR",
          time: new Date().toISOString()
        })
      );
    });
  }

  /**
   * Opens a pool against `connectionString`.
   *
   * `pg` is imported dynamically so that SQLite-only environments (local
   * development, the test suite, CI) never load the driver and never need it
   * installed for anything to work.
   */
  static async connect(config) {
    const currentConfig = loadConfig();
    if (currentConfig._pgEnvironmentPresent) throw databasePolicyError();
    const currentEnvironment = currentConfig.env;
    const environment = ["staging", "production", "invalid"].includes(currentEnvironment)
      ? currentEnvironment : config?.environment ?? currentEnvironment;
    if (["staging", "production"].includes(environment) && currentConfig._globalTlsDisabled) throw databasePolicyError("DATABASE_TLS_REQUIRED");
    // Refuse unsafe configuration before driver import or socket creation.
    const poolOptions = buildPostgresOptions({ ...config, environment });
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

    const pool = new pg.Pool(poolOptions);

    const client = new PostgresDatabaseClient(pool);
    try {
      await client.get("SELECT 1");
      return client;
    } catch (error) {
      try { await pool.end(); } catch { /* Preserve the connection failure. */ }
      throw error;
    }
  }

  async exec(sql) {
    return this.#perform(() => this.#pool.query(sql).then(() => undefined));
  }

  async run(sql, params = []) {
    return this.#perform(async () => {
      const result = await this.#pool.query(toPositionalPlaceholders(sql), params);
      return { changes: result.rowCount };
    });
  }

  async get(sql, params = []) {
    return this.#perform(async () => {
      const result = await this.#pool.query(toPositionalPlaceholders(sql), params);
      return result.rows[0];
    });
  }

  async all(sql, params = []) {
    return this.#perform(async () => {
      const result = await this.#pool.query(toPositionalPlaceholders(sql), params);
      return result.rows;
    });
  }

  async columnExists(tableName, columnName) {
    return Boolean(await this.get(COLUMN_EXISTS_SQL, [tableName, columnName]));
  }

  /**
   * Pins one connection and invokes work exactly once. Only the supplied tx
   * client may be used inside work. No implicit nesting or callback retry.
   * An operation error aborts the unit even if work catches that error.
   */
  async transaction(work) {
    if (typeof work !== "function") throw new TypeError("Transaction work must be a function.");
    return this.#perform(async () => {
      const connection = await this.#pool.connect();
      const state = { active: true, failure: null, pending: new Set() };
      const tx = new PostgresTransactionClient(connection, state, this.#context);
      Object.defineProperty(tx, 'rootDatabase', { value: this, enumerable: false, writable: false });
      let begun = false;
      let commitStarted = false;
      let releaseError;
      let primaryError;
      try {
        await connection.query("BEGIN");
        begun = true;
        let result;
        try {
          result = await this.#context.run(state, () => work(tx));
        } finally {
          state.active = false;
        }
        await Promise.allSettled([...state.pending]);
        if (state.failure) throw state.failure;
        commitStarted = true;
        await connection.query("COMMIT");
        return result;
      } catch (error) {
        primaryError = error;
        state.active = false;
        await Promise.allSettled([...state.pending]);
        if (!begun || commitStarted) releaseError = error;
        if (begun) {
          try {
            await connection.query("ROLLBACK");
          } catch (rollbackError) {
            releaseError = rollbackError;
          }
        }
        throw error;
      } finally {
        state.active = false;
        try {
          // pg destroys a released connection when passed an error.
          connection.release(releaseError);
        } catch (error) {
          if (!primaryError) throw error;
        }
      }
    });
  }

  async close() {
    this.#assertOuterContext();
    if (this.#closePromise) return this.#closePromise;
    this.#closing = true;
    this.#closePromise = (async () => {
      await Promise.allSettled([...this.#operations]);
      try {
        await this.#pool.end();
      } finally {
        this.#closed = true;
      }
    })();
    return this.#closePromise;
  }

  #assertOuterContext() {
    if (this.#context.getStore()) {
      throw new Error("Use the transaction-scoped client inside transaction work; outer database access is forbidden.");
    }
  }

  #perform(work) {
    this.#assertOuterContext();
    if (this.#closing || this.#closed) throw new Error("Database client is closed.");
    const operation = Promise.resolve().then(work);
    this.#operations.add(operation);
    operation.then(
      () => this.#operations.delete(operation),
      () => this.#operations.delete(operation)
    );
    return operation;
  }
}

const COLUMN_EXISTS_SQL = `SELECT 1 AS present
  FROM information_schema.columns
  WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?`;

/** A handle valid only in the callback's async context and lifetime. */
class PostgresTransactionClient {
  #connection;
  #state;
  #context;

  constructor(connection, state, context) {
    this.transactionBound = true;
    this.kind = "postgres";
    this.#connection = connection;
    this.#state = state;
    this.#context = context;
  }

  async exec(sql) {
    return this.#perform(async () => {
      for (const statement of splitStatements(sql)) {
        await this.#connection.query(statement);
      }
    });
  }

  async run(sql, params = []) {
    return this.#perform(async () => {
      const result = await this.#connection.query(toPositionalPlaceholders(sql), params);
      return { changes: result.rowCount };
    });
  }

  async get(sql, params = []) {
    return this.#perform(async () => {
      const result = await this.#connection.query(toPositionalPlaceholders(sql), params);
      return result.rows[0];
    });
  }

  async all(sql, params = []) {
    return this.#perform(async () => {
      const result = await this.#connection.query(toPositionalPlaceholders(sql), params);
      return result.rows;
    });
  }

  async columnExists(tableName, columnName) {
    return Boolean(await this.get(COLUMN_EXISTS_SQL, [tableName, columnName]));
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
    const operation = Promise.resolve().then(work);
    this.#state.pending.add(operation);
    operation.then(
      () => this.#state.pending.delete(operation),
      (error) => {
        this.#state.failure ??= error;
        this.#state.pending.delete(operation);
      }
    );
    return operation;
  }
}
