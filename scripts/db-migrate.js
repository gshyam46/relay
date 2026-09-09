// Applies pending database migrations, then exits.
//
// Run as a Render pre-deploy command (or manually against staging) so the schema
// is up to date before new application instances start taking traffic. Booting
// the app applies migrations too; this exists so a deploy can fail on a bad
// migration BEFORE the old instances are replaced.
import { loadConfig, describeConfig, validateConfig } from "../src/config.js";
import { createDatabase, getMigrationStatus } from "../src/database/database.js";
import { createLogger } from "../src/shared/logger.js";

const config = loadConfig();
const logger = createLogger({ level: config.logging.level, json: config.logging.json });

const problems = validateConfig(config);
if (problems.length > 0) {
  logger.error("migrate.invalid_configuration", { problems });
  process.exit(1);
}

logger.info("migrate.starting", describeConfig(config));

let db;
try {
  // createDatabase() runs the migrations as part of opening the connection.
  db = await createDatabase(config.database, { logger });
  const status = await getMigrationStatus(db);
  if (status.pending.length > 0) {
    logger.error("migrate.incomplete", { pending: status.pending });
    process.exit(1);
  }
  logger.info("migrate.complete", { applied: status.applied.map((row) => row.id), total: status.total });
} catch (error) {
  logger.error("migrate.failed", { error });
  process.exit(1);
} finally {
  await db?.close();
}
