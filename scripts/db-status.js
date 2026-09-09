// Reports which migrations a database has applied and which are still pending,
// without changing anything. Safe to run against production.
import { loadConfig, describeConfig } from "../src/config.js";
import { getMigrationStatus, openDatabaseClient } from "../src/database/database.js";

const config = loadConfig();

let db;
try {
  db = await openDatabaseClient(config.database);
  const status = await getMigrationStatus(db);
  console.log(JSON.stringify({ config: describeConfig(config), migrations: status }, null, 2));
  process.exit(status.pending.length === 0 ? 0 : 1);
} catch (error) {
  console.error(`Database status check failed: ${error.message}`);
  process.exit(1);
} finally {
  await db?.close();
}
