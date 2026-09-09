import { MIGRATIONS } from "./migrations/index.js";

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )
`;

/**
 * Applies every migration that this database has not recorded yet.
 *
 * Each migration runs inside its own transaction together with the row that
 * records it, so a migration either lands completely or not at all — an
 * interrupted deploy can be retried without leaving a half-migrated schema.
 * Both SQLite and PostgreSQL support transactional DDL, which is what makes
 * this safe.
 *
 * Returns the ids of the migrations that were applied by this call (empty when
 * the database was already up to date).
 */
export async function runMigrations(db, { logger = null } = {}) {
  await db.exec(MIGRATIONS_TABLE);

  const appliedRows = await db.all("SELECT id FROM schema_migrations");
  const applied = new Set(appliedRows.map((row) => row.id));
  const pending = MIGRATIONS.filter((migration) => !applied.has(migration.id));

  if (pending.length === 0) {
    logger?.debug?.("database.migrations_up_to_date", { applied: applied.size });
    return [];
  }

  const appliedNow = [];
  for (const migration of pending) {
    const startedAt = Date.now();
    await db.transaction(async (tx) => {
      await migration.up(tx);
      await tx.run("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", [
        migration.id,
        new Date().toISOString()
      ]);
    });
    appliedNow.push(migration.id);
    logger?.info?.("database.migration_applied", {
      migration: migration.id,
      duration_ms: Date.now() - startedAt
    });
  }

  return appliedNow;
}

/**
 * Reports which migrations are applied and which are still pending, without
 * changing anything. Used by the readiness endpoint and by `npm run db:status`
 * so a deploy can be checked before traffic is sent to it.
 */
export async function getMigrationStatus(db) {
  await db.exec(MIGRATIONS_TABLE);
  const appliedRows = await db.all("SELECT id, applied_at FROM schema_migrations ORDER BY id");
  const applied = new Set(appliedRows.map((row) => row.id));
  return {
    applied: appliedRows,
    pending: MIGRATIONS.filter((migration) => !applied.has(migration.id)).map((migration) => migration.id),
    total: MIGRATIONS.length
  };
}
