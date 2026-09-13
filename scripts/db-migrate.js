// Explicit schema-changing job. Deployed environments require a separate
// MIGRATION_DATABASE_URL secret; the web process never needs migration rights.
import { loadMigrationConfig, describeConfig, validateConfig } from "../src/config.js";
import { createDatabase, describeDatabaseFailure, getMigrationStatus } from "../src/database/database.js";
import { createLogger } from "../src/shared/logger.js";

let db;
let logger = createLogger();
try {
  const config = loadMigrationConfig();
  logger = createLogger({ level: config.logging.level, json: config.logging.json });
  const problems = validateConfig(config, { scope: "database" });
  if (problems.length > 0) {
    logger.error("migrate.invalid_configuration", { problems });
    process.exitCode = 1;
  } else {
    logger.info("migrate.starting", describeConfig(config));
    db = await createDatabase(config.database, { logger });
    const status = await getMigrationStatus(db);
    if (!status.initialized || !status.compatible || status.pending.length > 0) {
      logger.error("migrate.incomplete", { initialized: status.initialized, compatible: status.compatible, pending_count: status.pending.length });
      process.exitCode = 1;
    } else {
      logger.info("migrate.complete", { applied_count: status.applied.length, total: status.total });
    }
  }
} catch (error) {
  logger.error("migrate.failed", describeDatabaseFailure(error));
  process.exitCode = 1;
} finally {
  try { await db?.close(); } catch (error) {
    logger.error("migrate.close_failed", describeDatabaseFailure(error));
    process.exitCode = 1;
  }
}
