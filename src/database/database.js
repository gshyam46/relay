import { assertRuntimeSchema } from "./schemaVerifier.js";
import { assertRuntimeRole } from "./runtimeRoleVerifier.js";
import { buildPostgresOptions } from "./connectionPolicy.js";
import { statSync } from "node:fs";
import { getMigrationStatus, runMigrations } from "./migrate.js";
import { PostgresDatabaseClient } from "./postgresClient.js";
import { SqliteDatabaseClient } from "./sqliteClient.js";

export { getMigrationStatus, runMigrations } from "./migrate.js";
export { PostgresDatabaseClient } from "./postgresClient.js";
export { SqliteDatabaseClient } from "./sqliteClient.js";

/**
 * Async persistence boundary: exec, run, get, all, columnExists,
 * transaction(work, options), close. Operational work must compose repositories
 * with the supplied transaction-bound client; provider calls stay outside it.
 *
 * Explicit bootstrap helper for fixtures, local initialization and migrations.
 * Normal application startup must call openRuntimeDatabase instead.
 */
export async function createDatabase(target = ":memory:", options = {}) {
  const db = await openDatabaseClient(target);
  try {
    await runMigrations(db, options);
    return db;
  } catch (error) {
    try { await db.close(); } catch { /* Preserve the migration failure. */ }
    throw error;
  }
}

/**
 * Open without schema changes. readOnly uses SQLite's native mode; PostgreSQL
 * callers need SELECT-only operations and appropriate database privileges.
 * requireExisting rejects missing local files without creating directories.
 */
export async function openDatabaseClient(target = ":memory:", { readOnly = false, requireExisting = false } = {}) {
  const config = typeof target === "string" ? { driver: "sqlite", databaseFile: target } : target;
  if (!config || !["sqlite", "postgres"].includes(config.driver)) {
    throw databaseError("DATABASE_DRIVER_UNSUPPORTED");
  }
  if (config.driver === "postgres") {
    if (typeof config.databaseUrl !== "string" || !config.databaseUrl.trim()) {
      throw databaseError("DATABASE_URL_REQUIRED");
    }
    buildPostgresOptions(config);
    return PostgresDatabaseClient.connect({ ...config, connectionString: config.databaseUrl });
  }

  const databaseFile = config.databaseFile || ":memory:";
  if (requireExisting || readOnly) {
    if (databaseFile === ":memory:") throw databaseError("DATABASE_FILE_REQUIRED");
    let exists = false;
    try { exists = statSync(databaseFile).isFile(); } catch { /* Report a safe target error. */ }
    if (!exists) throw databaseError("DATABASE_FILE_REQUIRED");
  }
  return new SqliteDatabaseClient(databaseFile, { readOnly });
}

/**
 * Verify migration history before application code runs. This performs reads
 * only; no ledger creation, migration, repair or automatic version downgrade.
 * The caller receives a writable runtime client after the check.
 */
export async function openRuntimeDatabase(target) {
  const db = await openDatabaseClient(target, { requireExisting: true });
  try {
    const status = await getMigrationStatus(db);
    if (!status.initialized) throw databaseError("DATABASE_NOT_INITIALIZED");
    if (!status.compatible) throw databaseError("MIGRATION_HISTORY_INCOMPATIBLE");
    if (status.pending.length > 0) throw databaseError("DATABASE_MIGRATIONS_PENDING");
    await assertRuntimeSchema(db);
    if (db.kind==="postgres" && ["staging","production"].includes(String(target?.environment??process.env.NODE_ENV??"development").trim().toLowerCase())) await assertRuntimeRole(db);
    return db;
  } catch (error) {
    try { await db.close(); } catch { /* Preserve the readiness failure. */ }
    throw error;
  }
}

const FAILURE_MESSAGES = {
  DATABASE_CONFIGURATION_INVALID: "Database connection settings are invalid; values are redacted.",
  DATABASE_URL_INVALID: "Database URL must explicitly identify a PostgreSQL host, database, user and password; URL overrides are refused.",
  DATABASE_TLS_REQUIRED: "Staging and production require verified PostgreSQL TLS.",
  DATABASE_CA_INVALID: "Database CA must be a valid bounded PEM certificate bundle; its value is redacted.",
  DATABASE_TEST_SCOPE_INVALID: "Database test settings require an owned disposable schema.",
  DATABASE_DRIVER_UNSUPPORTED: "Database driver must explicitly be sqlite or postgres.",
  DATABASE_URL_REQUIRED: "PostgreSQL requires a configured database URL.",
  DATABASE_FILE_REQUIRED: "An existing SQLite file is required; inspection and runtime startup do not create a database.",
  DATABASE_NOT_INITIALIZED: "Database schema is not initialized. Run the authorized migration job before starting the application.",
  DATABASE_MIGRATIONS_PENDING: "Database migrations are pending. Run the authorized migration job before deploying this version.",
  MIGRATION_HISTORY_INCOMPATIBLE: "Database migration history is incompatible with this release. Inspect the release and migration history before proceeding.",
  MIGRATION_LEGACY_REVIEW_REQUIRED: "Legacy authorization data needs explicit operator review before migration; no owner or approval is inferred.",
  MIGRATION_DATABASE_REQUIRED: "MIGRATION_DATABASE_URL is required in staging/production and must be supplied to a separate migration job.",
  MIGRATION_DATABASE_INVALID: "MIGRATION_DATABASE_URL must identify a PostgreSQL host and database; the value is redacted.",
  DATABASE_SCHEMA_INCOMPATIBLE: "Database structures do not match this release. Run the read-only deployment verifier; no automatic repair is attempted.",
  DATABASE_RUNTIME_ROLE_UNSAFE: "Database runtime privileges are unsafe or incomplete. Use the separate reviewed application role.",
  DATABASE_OPERATION_FAILED: "Database operation failed. Check connectivity, credentials, privileges and schema with the database operator; connection details are redacted."
};

function databaseError(code) {
  return Object.assign(new Error(FAILURE_MESSAGES[code]), { code });
}

/** Never forward server-provided messages, SQL, URLs or stacks to CLI/boot logs. */
export function describeDatabaseFailure(error) {
  const code = Object.hasOwn(FAILURE_MESSAGES, error?.code) ? error.code : "DATABASE_OPERATION_FAILED";
  return { code, message: FAILURE_MESSAGES[code] };
}

export function parseJson(value) {
  return value ? JSON.parse(value) : null;
}

export function stringifyJson(value) {
  return JSON.stringify(value ?? {});
}
