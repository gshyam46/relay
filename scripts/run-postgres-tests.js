// Runs the whole test suite against PostgreSQL instead of SQLite.
//
//   npm run test:pg
//
// The target is taken from TEST_DATABASE_URL, falling back to DATABASE_URL, and
// is read from the environment or a local `.env` — never passed on the command
// line, so it does not end up in shell history.
//
// This is safe to point at the staging database: every test works inside its own
// generated schema and nothing touches `public`. The schemas that outlive a test
// (the "survives restart" cases deliberately reuse one) are dropped here, after
// the run, so nothing accumulates.
import { spawn } from "node:child_process";

const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.error("No database configured. Set TEST_DATABASE_URL (preferred) or DATABASE_URL.");
  console.error("");
  console.error("Put it in a local .env file rather than on the command line:");
  console.error('  DATABASE_URL=postgresql://user:password@host:5432/postgres');
  console.error("");
  console.error(".env is gitignored. `npm run test:pg` loads it automatically.");
  process.exit(1);
}

let target;
try {
  target = new URL(connectionString);
} catch {
  console.error("The configured connection string is not a valid URL.");
  process.exit(1);
}

if (!/^postgres(ql)?:$/.test(target.protocol)) {
  console.error(`Expected a postgres:// connection string, got "${target.protocol}//".`);
  process.exit(1);
}

// Host and database only — never the credentials.
console.log(`Running the full suite against PostgreSQL at ${target.host}${target.pathname}`);
if (!process.env.TEST_DATABASE_URL) {
  console.log("(using DATABASE_URL; tests are schema-scoped and will not touch existing data)");
}
console.log("");

const child = spawn(process.execPath, ["--test"], {
  stdio: "inherit",
  env: { ...process.env, RELAY_TEST_PG: "1", TEST_DATABASE_URL: connectionString }
});

child.on("exit", async (code) => {
  await dropLeftoverSchemas(connectionString);
  process.exit(code ?? 1);
});

/**
 * Drops the schemas the run created.
 *
 * `relay_mem_*` schemas are dropped by the client that made them; `relay_file_*`
 * ones deliberately outlive their client so a "restart" test can reattach, and
 * `relay_adapter_*` ones are dropped by their own test. This is the safety net
 * for all three when a run is interrupted or a test fails before its teardown.
 */
async function dropLeftoverSchemas(url) {
  let PostgresDatabaseClient;
  try {
    ({ PostgresDatabaseClient } = await import("../src/database/postgresClient.js"));
  } catch {
    return;
  }

  let db;
  try {
    db = await PostgresDatabaseClient.connect({
      connectionString: url,
      ssl: (process.env.TEST_DATABASE_SSL ?? process.env.DATABASE_SSL) !== "disable",
      maxConnections: 1
    });
    const rows = await db.all(
      `SELECT schema_name FROM information_schema.schemata
        WHERE schema_name LIKE 'relay\\_mem\\_%'
           OR schema_name LIKE 'relay\\_file\\_%'
           OR schema_name LIKE 'relay\\_adapter\\_%'
           OR schema_name LIKE 'relay\\_test\\_%'`
    );
    for (const row of rows) {
      await db.exec(`DROP SCHEMA IF EXISTS ${row.schema_name} CASCADE`);
    }
    if (rows.length > 0) {
      console.log(`\nCleaned up ${rows.length} test schema(s).`);
    }
  } catch (error) {
    console.warn(`\nCould not clean up test schemas: ${error.message}`);
  } finally {
    await db?.close();
  }
}
