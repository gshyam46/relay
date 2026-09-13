import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { SqliteDatabaseClient } from "../src/database/sqliteClient.js";
import { openDatabaseClient } from "../src/database/database.js";
import { runMigrations, getMigrationStatus } from "../src/database/migrate.js";
import { MIGRATIONS } from "../src/database/migrations/index.js";
import { connectTestAdmin, postgresTestContext, safeTestEnvironment, schemaDatabaseConfig, schemaFor } from "../scripts/helpers/testSafety.js";

const cleanupByTest = new WeakMap();

function onCleanup(t, cleanup) {
  let callbacks = cleanupByTest.get(t);
  if (!callbacks) {
    callbacks = [];
    cleanupByTest.set(t, callbacks);
    t.after(async () => { for (const callback of callbacks.toReversed()) await callback(); });
  }
  callbacks.push(cleanup);
}

async function sqlite(t, file = ":memory:") {
  const db = new SqliteDatabaseClient(file);
  onCleanup(t, () => db.close());
  return db;
}

async function temporaryDatabase(t) {
  const folder = await mkdtemp(path.join(os.tmpdir(), "lead-migrations-"));
  onCleanup(t, () => rm(folder, { recursive: true, force: true }));
  return path.join(folder, "isolated.sqlite");
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixtures() {
  return [
    { id: "0001_fixture", up: (tx) => tx.exec("CREATE TABLE fixture_records (id TEXT PRIMARY KEY, value TEXT NOT NULL)") },
    { id: "0002_fixture", up: (tx) => tx.run("INSERT INTO fixture_records VALUES ('second', 'preserved')") }
  ];
}

test("migration status on an empty database executes SELECT only and creates no ledger", async (t) => {
  const db = await sqlite(t);
  const reads = [];
  const readonly = {
    kind: db.kind,
    get: (sql, params) => { reads.push(sql); return db.get(sql, params); },
    all: (sql, params) => { reads.push(sql); return db.all(sql, params); }
  };
  const status = await getMigrationStatus(readonly);
  assert.equal(status.initialized, false);
  assert.equal(status.compatible, true);
  assert.deepEqual(status.pending, MIGRATIONS.map((item) => item.id));
  assert.ok(reads.every((sql) => /^SELECT /i.test(sql)));
  assert.deepEqual(await db.all("SELECT name FROM sqlite_master WHERE type = 'table'"), []);
});

test("fresh installation applies ordered versions once and read-only status preserves the schema", async (t) => {
  const db = await sqlite(t);
  assert.deepEqual(await runMigrations(db), MIGRATIONS.map((item) => item.id));
  const before = await db.all("SELECT name, sql FROM sqlite_master ORDER BY name");
  const status = await getMigrationStatus(db);
  assert.equal(status.initialized, true);
  assert.equal(status.compatible, true);
  assert.deepEqual(status.pending, []);
  assert.deepEqual(await runMigrations(db), []);
  assert.deepEqual(await db.all("SELECT name, sql FROM sqlite_master ORDER BY name"), before);
});

test("malformed migration registries refuse before any database operation", async () => {
  const untouched = new Proxy({}, { get() { throw new Error("Database must not be accessed"); } });
  const good = fixtures();
  for (const migrations of [
    [],
    [good[0], good[0]],
    [good[1], good[0]],
    [{ id: "0001", up() {} }],
    [{ id: "0000_bad", up() {} }],
    [{ id: "0001_bad" }],
    [{ id: "0001_first", up() {} }, { id: "0001_second", up() {} }]
  ]) {
    await assert.rejects(runMigrations(untouched, { migrations }), /Migration registry/);
    await assert.rejects(getMigrationStatus(untouched, { migrations }), /Migration registry/);
  }
  for (const lockTimeoutMs of [0, -1, Infinity, 1.5, 60001, "100"]) {
    await assert.rejects(runMigrations(untouched, { lockTimeoutMs }), /lockTimeoutMs/);
  }
});

test("unknown newer history and a gap are reported incompatible and refuse repairs", async (t) => {
  for (const appliedId of ["0099_future", "0002_fixture"]) {
    const db = await sqlite(t);
    await db.exec("CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
    await db.run("INSERT INTO schema_migrations VALUES (?, 'old')", [appliedId]);
    let invoked = false;
    const migrations = fixtures().map((item) => ({ ...item, up() { invoked = true; } }));
    const status = await getMigrationStatus(db, { migrations });
    assert.equal(status.compatible, false);
    assert.equal(status.outOfOrder, true);
    assert.deepEqual(status.unknown, appliedId === "0099_future" ? [appliedId] : []);
    await assert.rejects(runMigrations(db, { migrations }), { code: "MIGRATION_HISTORY_INCOMPATIBLE" });
    assert.equal(invoked, false);
    assert.deepEqual((await db.all("SELECT id FROM schema_migrations")).map((row) => ({ ...row })), [{ id: appliedId }]);
    assert.equal(await db.get("SELECT name FROM sqlite_master WHERE name = 'fixture_records'"), undefined);
  }
});

test("each migration and marker roll back together while earlier committed data survives", async (t) => {
  const db = await sqlite(t);
  const migrations = fixtures();
  migrations[1] = {
    ...migrations[1],
    async up(tx) {
      await tx.exec("CREATE TABLE interrupted (value TEXT)");
      await tx.run("INSERT INTO fixture_records VALUES ('second', 'uncommitted')");
      throw new Error("interrupted migration");
    }
  };
  await assert.rejects(runMigrations(db, { migrations }), /interrupted migration/);
  assert.deepEqual((await getMigrationStatus(db, { migrations })).applied.map((row) => row.id), ["0001_fixture"]);
  assert.equal(await db.get("SELECT name FROM sqlite_master WHERE name = 'interrupted'"), undefined);
  assert.deepEqual(await db.all("SELECT * FROM fixture_records"), []);
  assert.deepEqual(await runMigrations(db, { migrations: fixtures() }), ["0002_fixture"]);
  assert.deepEqual((await db.all("SELECT * FROM fixture_records")).map((row) => ({ ...row })), [{ id: "second", value: "preserved" }]);
});

test("marker insertion failure also rolls back migration DDL and data", async (t) => {
  const db = await sqlite(t);
  const migrations = fixtures();
  await runMigrations(db, { migrations: migrations.slice(0, 1) });
  await db.exec("CREATE TRIGGER reject_marker BEFORE INSERT ON schema_migrations BEGIN SELECT RAISE(ABORT, 'marker rejected'); END");
  await assert.rejects(runMigrations(db, { migrations }), /marker rejected/);
  assert.deepEqual(await db.all("SELECT * FROM fixture_records"), []);
  assert.deepEqual((await getMigrationStatus(db, { migrations })).applied.map((row) => row.id), ["0001_fixture"]);
  await db.exec("DROP TRIGGER reject_marker");
  assert.deepEqual(await runMigrations(db, { migrations }), ["0002_fixture"]);
});

test("pre-runner missing authorization fields refuses before baseline DDL and preserves every record", async (t) => {
  for (const [table, columns] of [["users", ["role", "password_hash"]], ["actions", ["approval_requirement", "execution_mode", "provider"]]]) {
    for (const absentColumn of columns) {
      const db = await sqlite(t);
      const definition = columns.filter((column) => column !== absentColumn).map((column) => column + " TEXT").join(", ");
      await db.exec("CREATE TABLE " + table + " (id TEXT PRIMARY KEY, " + definition + ")");
      await db.run("INSERT INTO " + table + " (id) VALUES ('preserved')");
      const before = await db.all("SELECT name, sql FROM sqlite_master ORDER BY name");
      const records = await db.all("SELECT * FROM " + table);
      await assert.rejects(runMigrations(db), { code: "MIGRATION_LEGACY_REVIEW_REQUIRED" });
      assert.deepEqual(await db.all("SELECT name, sql FROM sqlite_master ORDER BY name"), before);
      assert.deepEqual(await db.all("SELECT * FROM " + table), records);
      assert.equal((await getMigrationStatus(db)).initialized, false);
    }
  }
});

test("legacy pre-runner records survive adoption of baseline and forward version", async (t) => {
  const db = await sqlite(t);
  await db.exec("CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL)");
  await db.run("INSERT INTO organizations VALUES ('legacy-org', 'Retained business', '2026-01-01')");
  assert.equal((await getMigrationStatus(db)).initialized, false);
  await runMigrations(db);
  assert.deepEqual({ ...await db.get("SELECT * FROM organizations") }, {
    id: "legacy-org", name: "Retained business", created_at: "2026-01-01"
  });
  assert.deepEqual((await getMigrationStatus(db)).pending, []);
});

async function markedOlderSchema(db) {
  await runMigrations(db, { migrations: [MIGRATIONS[0]] });
  await db.run("INSERT INTO organizations VALUES ('org-old', 'Historical business', '2026-01-01')");
  await db.run(
    "INSERT INTO users (id, organization_id, name, email, created_at) VALUES ('user-old', 'org-old', 'Previous owner', 'owner@example.test', '2026-01-01')"
  );
  await db.run(
    "INSERT INTO leads (id, organization_id, name, email, source, status, created_at, updated_at) VALUES ('lead-old', 'org-old', 'Existing lead', ' Lead@Example.Test ', 'CSV', 'OPTED_OUT', '2026-01-01', '2026-01-01')"
  );
  for (const status of ["APPROVED", "PLANNED", "AWAITING_APPROVAL", "RETRYING", "EXECUTING", "COMPLETED", "FAILED"]) {
    await db.run(
      "INSERT INTO actions (id, organization_id, lead_id, type, status, payload_json, idempotency_key, created_at, updated_at) VALUES (?, 'org-old', 'lead-old', 'SEND_EMAIL', ?, '{}', ?, '2026-01-01', '2026-01-01')",
      [status, status, status]
    );
  }
  // Explicit synthetic prior schema: core tables and the applied baseline
  // marker exist, but extension fields were absent. This does not assert that
  // any production deployment was observed in this state.
  await db.exec("DROP INDEX idx_intelligence_snapshot_idempotency; DROP INDEX idx_actions_next_best_action_plan");
  const absent = {
    leads: ["normalized_email", "normalized_phone", "import_batch_id", "import_row_id", "source_metadata_json"],
    actions: ["next_best_action_plan_id", "approval_requirement", "execution_mode", "provider", "last_error"],
    callbacks: ["organization_id", "lead_id", "action_execution_id", "status", "provider_reference"],
    intelligence_snapshots: ["version", "status", "pipeline_version", "input_fingerprint", "readiness_status", "readiness_score"],
    inbound_events: ["confidence", "reason", "suggested_next_step"],
    channel_messages: ["classification_event_type", "classification_confidence", "suggested_next_step"],
    follow_up_tasks: ["escalated"],
    users: ["password_hash", "role"]
  };
  for (const [table, columns] of Object.entries(absent)) {
    for (const column of columns) await db.exec("ALTER TABLE " + table + " DROP COLUMN " + column);
  }
}

async function assertUpgrade(db) {
  assert.deepEqual((await getMigrationStatus(db)).pending, MIGRATIONS.slice(1).map((migration) => migration.id));
  assert.deepEqual(await runMigrations(db), MIGRATIONS.slice(1).map((migration) => migration.id));
  const lead = await db.get("SELECT * FROM leads WHERE id = 'lead-old'");
  assert.equal(lead.status, "OPTED_OUT");
  assert.equal(lead.normalized_email, "lead@example.test");
  assert.equal(lead.normalized_phone, null);
  assert.equal(lead.source_metadata_json, "{}");
  const user = await db.get("SELECT * FROM users WHERE id = 'user-old'");
  assert.equal(user.role, "UNASSIGNED");
  assert.equal(user.password_hash, null);
  for (const id of ["APPROVED", "PLANNED", "AWAITING_APPROVAL", "RETRYING"]) {
    const action = await db.get("SELECT * FROM actions WHERE id = ?", [id]);
    assert.equal(action.status, "BLOCKED");
    assert.equal(action.approval_requirement, "REQUIRED");
    assert.match(action.last_error, /Legacy action authorization/);
  }
  for (const id of ["EXECUTING", "COMPLETED", "FAILED"]) {
    assert.equal((await db.get("SELECT status FROM actions WHERE id = ?", [id])).status, id);
  }
  assert.equal(await db.columnExists("intelligence_snapshots", "input_fingerprint"), true);
  assert.equal(await db.columnExists("inbound_events", "suggested_next_step"), true);
  assert.equal(await db.columnExists("channel_messages", "classification_confidence"), true);
  assert.equal(await db.columnExists("follow_up_tasks", "escalated"), true);
  assert.deepEqual(await runMigrations(db), []);
}

test("populated marked baseline receives forward repairs without inventing owner or send approval", async (t) => {
  const db = await sqlite(t);
  await markedOlderSchema(db);
  await assertUpgrade(db);
});

test("current baseline upgrade leaves existing roles, approvals, content and statuses unchanged", async (t) => {
  const db = await sqlite(t);
  await runMigrations(db, { migrations: [MIGRATIONS[0]] });
  await db.run("INSERT INTO organizations VALUES ('current', 'Current business', '2026-01-01')");
  await db.run("INSERT INTO users (id, organization_id, name, email, role, created_at) VALUES ('current-user', 'current', 'Owner', 'current@example.test', 'OWNER', '2026-01-01')");
  await db.run("INSERT INTO leads (id, organization_id, name, source, status, created_at, updated_at) VALUES ('current-lead', 'current', 'Lead', 'MANUAL', 'NEW', '2026-01-01', '2026-01-01')");
  await db.run("INSERT INTO actions (id, organization_id, lead_id, type, status, payload_json, idempotency_key, approval_requirement, created_at, updated_at) VALUES ('current-action', 'current', 'current-lead', 'SEND_EMAIL', 'APPROVED', '{\"body\":\"Existing text\"}', 'current-action', 'REQUIRED', '2026-01-01', '2026-01-01')");
  const action = await db.get("SELECT * FROM actions");
  const user = await db.get("SELECT * FROM users");
  await runMigrations(db);
  const upgradedAction = await db.get("SELECT * FROM actions");
  for (const [key, value] of Object.entries(action)) assert.deepEqual(upgradedAction[key], value, key);
  assert.equal(upgradedAction.current_revision_id, null);
  assert.deepEqual({ ...await db.get("SELECT * FROM users") }, { ...user, auth_revision: 0 });
});

test("competing SQLite migrators read history under their lock and invoke each migration once", async (t) => {
  const file = await temporaryDatabase(t);
  const first = await sqlite(t, file);
  const second = await sqlite(t, file);
  const entered = deferred();
  const release = deferred();
  let invokes = 0;
  const migrations = [{
    id: "0001_race",
    async up(tx) {
      invokes++;
      await tx.exec("CREATE TABLE race_records (value TEXT)");
      await tx.run("INSERT INTO race_records VALUES ('once')");
      entered.resolve();
      await release.promise;
    }
  }];
  const one = runMigrations(first, { migrations });
  await entered.promise;
  const two = runMigrations(second, { migrations, lockTimeoutMs: 2000 });
  release.resolve();
  const results = await Promise.all([one, two]);
  assert.equal(invokes, 1);
  assert.equal(results.flat().length, 1);
  assert.deepEqual((await first.all("SELECT * FROM race_records")).map((row) => ({ ...row })), [{ value: "once" }]);
});

test("migration lock timeout fails without changing schema and a later retry succeeds", async (t) => {
  const file = await temporaryDatabase(t);
  const first = await sqlite(t, file);
  const second = await sqlite(t, file);
  const entered = deferred();
  const release = deferred();
  const holding = first.transaction(async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  try {
    await assert.rejects(runMigrations(second, { migrations: fixtures(), lockTimeoutMs: 25 }), /busy|locked|timeout/i);
  } finally {
    release.resolve();
    await holding;
  }
  assert.equal((await getMigrationStatus(second, { migrations: fixtures() })).initialized, false);
  assert.deepEqual(await runMigrations(second, { migrations: fixtures() }), ["0001_fixture", "0002_fixture"]);
});

test("process exit during migration rolls back its writes and marker on reopen", async (t) => {
  const file = await temporaryDatabase(t);
  const clientUrl = pathToFileURL(path.resolve("src/database/sqliteClient.js")).href;
  const migrateUrl = pathToFileURL(path.resolve("src/database/migrate.js")).href;
  const source = [
    "import { SqliteDatabaseClient } from " + JSON.stringify(clientUrl) + ";",
    "import { runMigrations } from " + JSON.stringify(migrateUrl) + ";",
    "const db = new SqliteDatabaseClient(" + JSON.stringify(file) + ");",
    "await runMigrations(db, { migrations: [",
    "{ id:'0001_fixture', up:tx=>tx.exec('CREATE TABLE fixture_records (id TEXT PRIMARY KEY, value TEXT NOT NULL)') },",
    "{ id:'0002_fixture', up:async tx=>{ await tx.exec('CREATE TABLE interrupted (value TEXT)'); await tx.run(\"INSERT INTO fixture_records VALUES ('lost', 'uncommitted')\"); process.exit(27); } }",
    "] });"
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "--eval", source], {
    windowsHide: true, env: safeTestEnvironment(), stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  assert.equal(code, 27, stderr);
  const db = await sqlite(t, file);
  assert.equal(await db.get("SELECT name FROM sqlite_master WHERE name = 'interrupted'"), undefined);
  assert.deepEqual(await db.all("SELECT * FROM fixture_records"), []);
  assert.deepEqual((await getMigrationStatus(db, { migrations: fixtures() })).applied.map((row) => row.id), ["0001_fixture"]);
  assert.deepEqual(await runMigrations(db, { migrations: fixtures() }), ["0002_fixture"]);
});

const pgContext = postgresTestContext();
const pgSkip = pgContext ? false : "Requires the explicit disposable PostgreSQL test runner";

async function postgres(t) {
  const schema = schemaFor(pgContext.runId, "adapter");
  const admin = await connectTestAdmin(pgContext);
  try { await admin.exec('CREATE SCHEMA "' + schema + '"'); } finally { await admin.close(); }
  t.after(async () => {
    const cleanup = await connectTestAdmin(pgContext);
    try { await cleanup.exec('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'); } finally { await cleanup.close(); }
  });
  const config = schemaDatabaseConfig(pgContext, schema);
  const db = await openDatabaseClient(config);
  t.after(() => db.close());
  return { db, config };
}

test("postgres migrations: populated marked baseline upgrades safely", { skip: pgSkip }, async (t) => {
  const { db } = await postgres(t);
  await markedOlderSchema(db);
  await assertUpgrade(db);
});

test("postgres migrations: two connections serialize migration execution and honor lock timeout", { skip: pgSkip }, async (t) => {
  const { db, config } = await postgres(t);
  const other = await openDatabaseClient(config);
  t.after(() => other.close());
  const entered = deferred();
  const release = deferred();
  const migrations = fixtures();
  const first = runMigrations(db, { migrations: [{
    ...migrations[0],
    async up(tx) { await migrations[0].up(tx); entered.resolve(); await release.promise; }
  }] });
  await entered.promise;
  try {
    await assert.rejects(runMigrations(other, { migrations, lockTimeoutMs: 25 }), /lock timeout/i);
  } finally { release.resolve(); await first; }
  const applied = await Promise.all([
    runMigrations(db, { migrations }),
    runMigrations(other, { migrations })
  ]);
  assert.equal(applied.flat().length, 1);
  assert.deepEqual((await db.all("SELECT * FROM fixture_records")).map((row) => ({ ...row })), [{ id: "second", value: "preserved" }]);
});

test("postgres migrations: rollback preserves prior migration and leaves no interrupted marker", { skip: pgSkip }, async (t) => {
  const { db } = await postgres(t);
  const migrations = fixtures();
  await assert.rejects(runMigrations(db, { migrations: [
    migrations[0],
    { ...migrations[1], async up(tx) { await migrations[1].up(tx); await tx.exec("CREATE TABLE interrupted (value TEXT)"); throw new Error("migration interrupted"); } }
  ] }), /migration interrupted/);
  assert.deepEqual(await db.all("SELECT * FROM fixture_records"), []);
  assert.equal(await db.columnExists("interrupted", "value"), false);
  assert.deepEqual((await getMigrationStatus(db, { migrations })).applied.map((row) => row.id), ["0001_fixture"]);
  assert.deepEqual(await runMigrations(db, { migrations }), ["0002_fixture"]);
});
