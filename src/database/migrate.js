import { MIGRATIONS } from "./migrations/index.js";

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )
`;

/**
 * Only numbered, explicitly ordered migrations are accepted. Copy the registry
 * so mutation of a caller-owned array cannot reorder work between transactions.
 */
function validateRegistry(migrations) {
  if (!Array.isArray(migrations) || migrations.length === 0) {
    throw new Error("Migration registry must be a nonempty ordered array.");
  }
  let previous = 0;
  return migrations.map((migration) => {
    const match = /^(\d{4})_[a-z][a-z0-9_]*$/.exec(migration?.id || "");
    const sequence = match ? Number(match[1]) : 0;
    if (!match || sequence <= previous || typeof migration.up !== "function") {
      throw new Error("Migration registry requires unique, increasing numbered IDs and up functions.");
    }
    previous = sequence;
    return { id: migration.id, up: migration.up };
  });
}

async function tableExists(db, tableName) {
  if (db.kind === "sqlite") {
    return Boolean(await db.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?", [tableName]));
  }
  if (db.kind === "postgres") {
    return Boolean(await db.get(
      "SELECT 1 AS present FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ? AND table_type = 'BASE TABLE'", [tableName]
    ));
  }
  throw new Error("Migration status requires a supported database kind.");
}

async function readStatus(db, migrations) {
  const initialized = await tableExists(db, "schema_migrations");
  const applied = initialized
    ? await db.all("SELECT id, applied_at FROM schema_migrations ORDER BY id")
    : [];
  const expected = migrations.map((migration) => migration.id);
  const known = new Set(expected);
  const appliedIds = new Set(applied.map((row) => row.id));
  const unknown = applied.filter((row) => !known.has(row.id)).map((row) => row.id);
  const outOfOrder = applied.some((row, index) => row.id !== expected[index]);
  return {
    applied,
    pending: expected.filter((id) => !appliedIds.has(id)),
    total: migrations.length,
    initialized,
    compatible: unknown.length === 0 && !outOfOrder,
    unknown,
    outOfOrder
  };
}

async function requireSafeLegacyAdoption(tx, migrationId, appliedCount) {
  if (migrationId !== "0001_baseline_schema" || appliedCount !== 0) return;
  // The frozen baseline used permissive defaults for these historical
  // fields. Detect their absence before it can erase that distinction.
  // An actual legacy database needs reviewed offline remediation first.
  const required = [
    ["users", ["role", "password_hash"]],
    ["actions", ["approval_requirement", "execution_mode", "provider"]]
  ];
  for (const [table, columns] of required) {
    if (!await tableExists(tx, table)) continue;
    for (const column of columns) {
      if (await tx.columnExists(table, column)) continue;
      const error = new Error("Legacy authorization metadata requires reviewed offline remediation before baseline adoption.");
      error.code = "MIGRATION_LEGACY_REVIEW_REQUIRED";
      throw error;
    }
  }
}

function requireCompatible(status) {
  if (!status.compatible) {
    const error = new Error("Database migration history is unknown or out of order. Use the matching release and investigate before migrating.");
    error.code = "MIGRATION_HISTORY_INCOMPATIBLE";
    throw error;
  }
}

async function lockMigrations(tx, lockTimeoutMs) {
  if (tx.kind === "postgres") {
    await tx.get("SELECT set_config('lock_timeout', ?, true)", [String(lockTimeoutMs) + "ms"]);
    // Transaction ownership and current_schema scope both survive process
    // crashes. The client pins this transaction to one checked-out connection.
    await tx.get("SELECT pg_advisory_xact_lock(hashtext(current_database()), hashtext(current_schema()))");
  } else if (tx.kind !== "sqlite") {
    throw new Error("Migration locking requires a supported database kind.");
  }
  // SQLite's client obtains BEGIN IMMEDIATE before entering this callback.
}

/**
 * Serialize before reading history or creating the ledger. Each numbered
 * migration and its marker commit atomically. Re-read under the next lock:
 * another deploy may have completed work between transactions.
 * Network calls and nontransactional DDL are not valid migration operations.
 */
export async function runMigrations(db, { logger = null, migrations = MIGRATIONS, lockTimeoutMs = 10000 } = {}) {
  const registry = validateRegistry(migrations);
  if (!Number.isInteger(lockTimeoutMs) || lockTimeoutMs < 1 || lockTimeoutMs > 60000) {
    throw new Error("Migration lockTimeoutMs must be an integer between 1 and 60000.");
  }
  const appliedNow = [];
  while (true) {
    const startedAt = Date.now();
    const appliedId = await db.transaction(async (tx) => {
      await lockMigrations(tx, lockTimeoutMs);
      const status = await readStatus(tx, registry);
      requireCompatible(status);
      const migration = registry[status.applied.length];
      if (!migration) return null;
      await requireSafeLegacyAdoption(tx, migration.id, status.applied.length);
      if (!status.initialized) await tx.exec(MIGRATIONS_TABLE);
      await migration.up(tx);
      await tx.run("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", [
        migration.id,
        new Date().toISOString()
      ]);
      return migration.id;
    }, { lockTimeoutMs });
    if (!appliedId) {
      logger?.debug?.("database.migrations_up_to_date", { total: registry.length });
      return appliedNow;
    }
    appliedNow.push(appliedId);
    logger?.info?.("database.migration_applied", {
      migration: appliedId,
      duration_ms: Date.now() - startedAt
    });
  }
}

/**
 * Read-only catalog/history inspection: never creates a ledger, runs DDL, or
 * repairs state. A missing ledger is all-pending; newer/gapped history is
 * incompatible even if no known migration appears pending.
 */
export async function getMigrationStatus(db, { migrations = MIGRATIONS } = {}) {
  return readStatus(db, validateRegistry(migrations));
}
