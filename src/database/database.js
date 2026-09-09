import { runMigrations } from "./migrate.js";
import { PostgresDatabaseClient } from "./postgresClient.js";
import { SqliteDatabaseClient } from "./sqliteClient.js";

export { getMigrationStatus, runMigrations } from "./migrate.js";
export { PostgresDatabaseClient } from "./postgresClient.js";
export { SqliteDatabaseClient } from "./sqliteClient.js";

/**
 * The DatabaseClient contract every module depends on:
 *
 *   exec(sql)                        -> Promise<void>     multi-statement DDL
 *   run(sql, params)                 -> Promise<{changes}> writes
 *   get(sql, params)                 -> Promise<row|undefined>
 *   all(sql, params)                 -> Promise<row[]>
 *   columnExists(table, column)      -> Promise<boolean>  (migrations only)
 *   transaction(fn)                  -> Promise<T>        (migrations only)
 *   close()                          -> Promise<void>
 *
 * Both implementations satisfy it identically, which is what lets the same
 * repositories, services, and tests run against SQLite locally and PostgreSQL in
 * staging and production. SQL is written once, in SQLite's dialect with `?`
 * placeholders; the PostgreSQL client translates.
 *
 * Opens a database and brings its schema up to date.
 *
 * Accepts either a SQLite file path (the historical signature, still used by the
 * test suite and dev scripts) or a config object:
 *
 *   createDatabase(":memory:")
 *   createDatabase("data/app.db")
 *   createDatabase({ driver: "postgres", databaseUrl, ssl, maxConnections })
 */
export async function createDatabase(target = ":memory:", { logger = null } = {}) {
  const db = await openDatabaseClient(target);
  await runMigrations(db, { logger });
  return db;
}

/**
 * Opens a connection WITHOUT applying migrations.
 *
 * Only for tooling that must inspect a database exactly as it is — `npm run
 * db:status` reporting pending migrations against production, for example.
 * Application code should always use `createDatabase()`.
 */
export async function openDatabaseClient(target = ":memory:") {
  const config = typeof target === "string" ? { driver: "sqlite", databaseFile: target } : target;
  return openClient(config);
}

async function openClient(config) {
  if (config.driver === "postgres") {
    if (!config.databaseUrl) {
      throw new Error("PostgreSQL driver selected but no databaseUrl was provided.");
    }
    return PostgresDatabaseClient.connect({
      connectionString: config.databaseUrl,
      ssl: config.ssl !== false,
      maxConnections: config.maxConnections,
      connectionTimeoutMillis: config.connectionTimeoutMillis
    });
  }

  return new SqliteDatabaseClient(config.databaseFile || ":memory:");
}

export function parseJson(value) {
  return value ? JSON.parse(value) : null;
}

export function stringifyJson(value) {
  return JSON.stringify(value ?? {});
}
