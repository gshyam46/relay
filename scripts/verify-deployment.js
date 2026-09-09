// Pre-deployment verification against a real PostgreSQL (Supabase or otherwise).
//
//   npm run verify:deploy
//
// Reads DATABASE_URL from the environment or a local `.env` — never from the
// command line, so it stays out of shell history — and never prints it. Only the
// host and database name are echoed.
//
// Checks, in the order a deploy depends on them:
//   1. Configuration resolves to the PostgreSQL driver.
//   2. The server is reachable, and reports its version.
//   3. Migration state BEFORE anything is applied.
//   4. Migrations apply cleanly.
//   5. Migration state after: nothing pending.
//   6. The schema really exists (core tables + the idempotency indexes the
//      product's correctness depends on).
//   7. A production-shaped config would pass validateConfig().
//
// It stops at the first failure, because each step depends on the one before.
import { describeConfig, loadConfig, validateConfig } from "../src/config.js";
import { createDatabase, getMigrationStatus, openDatabaseClient } from "../src/database/database.js";

const REQUIRED_TABLES = [
  "organizations",
  "users",
  "sessions",
  "leads",
  "import_batches",
  "import_rows",
  "intelligence_snapshots",
  "intelligence_synthesis_runs",
  "intelligence_recommendation_runs",
  "next_best_action_plans",
  "actions",
  "action_executions",
  "action_approvals",
  "callbacks",
  "channel_messages",
  "inbound_events",
  "follow_up_tasks",
  "campaigns",
  "sequences",
  "sequence_steps",
  "workflow_runs",
  "organization_settings",
  "audit_logs",
  "domain_events",
  "schema_migrations"
];

// Uniqueness is how this product is idempotent. If these are missing, duplicate
// imports, duplicate sends and duplicate enrollments all become possible.
const REQUIRED_UNIQUE_INDEXES = [
  { table: "intelligence_snapshots", index: "idx_intelligence_snapshot_idempotency" },
  { table: "action_executions", index: "idx_action_executions_idempotency" },
  { table: "users", index: "idx_users_email" }
];

let step = 0;
const pass = (message) => console.log(`  ok    ${message}`);
const info = (message) => console.log(`        ${message}`);
function heading(title) {
  step += 1;
  console.log(`\n[${step}] ${title}`);
}
function fail(message, hint) {
  console.error(`  FAIL  ${message}`);
  if (hint) {
    console.error("");
    console.error(hint);
  }
  process.exit(1);
}

const config = loadConfig();

heading("Configuration");
if (config.database.driver !== "postgres") {
  fail(
    "DATABASE_URL is not set, so the app resolved to SQLite.",
    [
      "Set DATABASE_URL to your PostgreSQL connection string. Put it in a local",
      ".env file (gitignored) rather than on the command line:",
      "",
      "  DATABASE_URL=postgresql://user:password@host:5432/postgres",
      "",
      "For Supabase, use the DIRECT connection (port 5432) for this check and for",
      "migrations; use the transaction POOLER (port 6543) for the running service.",
      "Then re-run: npm run verify:deploy"
    ].join("\n")
  );
}
const described = describeConfig(config);
pass(`driver: ${described.database.driver}`);
pass(`host: ${described.database.host}`);
info(`ssl: ${described.database.ssl} · max connections: ${described.database.max_connections}`);

heading("Connectivity");
let probe;
try {
  probe = await openDatabaseClient(config.database);
  const version = await probe.get("SELECT version() AS version");
  pass("connected");
  info(version.version.split(",")[0]);
} catch (error) {
  fail(`could not connect: ${error.message}`, [
    "Common causes:",
    "  - Wrong password in the connection string.",
    "  - Using the pooler host (port 6543) where the direct host (5432) is needed.",
    "  - The project is paused (Supabase pauses free projects after inactivity).",
    "  - Your IP is not allowed by the database's network restrictions."
  ].join("\n"));
} finally {
  await probe?.close();
}

heading("Migration state before");
let before;
const inspector = await openDatabaseClient(config.database);
try {
  before = await getMigrationStatus(inspector);
  pass(`applied: ${before.applied.length}/${before.total}`);
  if (before.pending.length > 0) {
    info(`pending: ${before.pending.join(", ")}`);
  } else {
    info("nothing pending");
  }
} finally {
  await inspector.close();
}

heading("Applying migrations");
const db = await createDatabase(config.database);
try {
  const after = await getMigrationStatus(db);
  const newlyApplied = after.applied.length - before.applied.length;
  pass(newlyApplied > 0 ? `applied ${newlyApplied} migration(s)` : "already up to date");

  heading("Migration state after");
  if (after.pending.length > 0) {
    fail(`still pending: ${after.pending.join(", ")}`);
  }
  pass(`applied: ${after.applied.length}/${after.total}, nothing pending`);
  for (const row of after.applied) {
    info(`${row.id} — ${row.applied_at}`);
  }

  heading("Schema");
  const tables = await db.all(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`
  );
  const present = new Set(tables.map((row) => row.table_name));
  const missing = REQUIRED_TABLES.filter((name) => !present.has(name));
  if (missing.length > 0) {
    fail(`missing table(s): ${missing.join(", ")}`);
  }
  pass(`${present.size} tables present, including all ${REQUIRED_TABLES.length} required`);

  const indexes = await db.all(
    "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()"
  );
  const indexNames = new Set(indexes.map((row) => row.indexname));
  const missingIndexes = REQUIRED_UNIQUE_INDEXES.filter((entry) => !indexNames.has(entry.index));
  if (missingIndexes.length > 0) {
    fail(`missing idempotency index(es): ${missingIndexes.map((entry) => entry.index).join(", ")}`);
  }
  pass(`${indexNames.size} indexes present, including the idempotency constraints`);

  heading("Production configuration check");
  // The same validation the server runs at boot, against a staging-shaped env.
  const staging = loadConfig({ ...process.env, NODE_ENV: "staging" });
  const problems = validateConfig(staging);
  if (problems.length > 0) {
    fail(`configuration would be rejected at boot:\n        ${problems.join("\n        ")}`);
  }
  pass("a staging/production boot with this DATABASE_URL would be accepted");
  info(`cookies: Secure forced=${staging.security.forceSecureCookies}, trust proxy=${staging.security.trustProxy}`);
  info(`logs: ${staging.logging.level} / ${staging.logging.json ? "json" : "text"}`);

  console.log("\nAll checks passed. Next: npm run test:pg");
} catch (error) {
  fail(error.message);
} finally {
  await db.close();
}
