// Inspect history without DDL. Missing SQLite files are never created.
// PostgreSQL needs only SELECT/catalog privileges for this command.
import { loadConfig, describeConfig, validateConfig } from "../src/config.js";
import { describeDatabaseFailure, getMigrationStatus, openDatabaseClient } from "../src/database/database.js";

let db;
try {
  const config = loadConfig();
  const problems = validateConfig(config, { scope: "database" });
  if (problems.length > 0) {
    console.error(JSON.stringify({ event: "database.status_invalid_configuration", problems }));
    process.exitCode = 1;
  } else {
    db = await openDatabaseClient(config.database, { readOnly: true, requireExisting: true });
    const status = await getMigrationStatus(db);
    console.log(JSON.stringify({ config: describeConfig(config), migrations: status }, null, 2));
    process.exitCode = status.initialized && status.compatible && status.pending.length === 0 ? 0 : 1;
  }
} catch (error) {
  console.error(JSON.stringify({ event: "database.status_failed", ...describeDatabaseFailure(error) }));
  process.exitCode = 1;
} finally {
  try { await db?.close(); } catch (error) {
    console.error(JSON.stringify({ event: "database.status_close_failed", ...describeDatabaseFailure(error) }));
    process.exitCode = 1;
  }
}
