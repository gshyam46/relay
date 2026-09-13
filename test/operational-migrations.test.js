import test from "node:test";
import assert from "node:assert/strict";
import { SqliteDatabaseClient } from "../src/database/sqliteClient.js";
import { openDatabaseClient } from "../src/database/database.js";
import { runMigrations, getMigrationStatus } from "../src/database/migrate.js";
import { MIGRATIONS } from "../src/database/migrations/index.js";
import * as migration from "../src/database/migrations/0008_operational_controls.js";
import { connectTestAdmin, postgresTestContext, schemaDatabaseConfig, schemaFor } from "../scripts/helpers/testSafety.js";

const PREVIOUS = MIGRATIONS.filter((item) => item.id < migration.id), CURRENT = [...PREVIOUS, migration];
const STAMP = "2026-09-11T10:00:00.000Z";
async function sqlite(t) { const db = new SqliteDatabaseClient(":memory:"); t.after(() => db.close()); return db; }
async function seed(db) {
  await runMigrations(db, { migrations: PREVIOUS });
  await db.run("INSERT INTO organizations(id,name,created_at) VALUES ('org','Synthetic workspace',?)", [STAMP]);
  await db.run("INSERT INTO users(id,organization_id,name,email,password_hash,role,created_at) VALUES ('owner','org','Synthetic owner','owner@example.test','historical exact hash','OWNER',?)", [STAMP]);
  await db.run("INSERT INTO sessions(id,user_id,organization_id,created_at,expires_at) VALUES ('session','owner','org',?,?)", [STAMP, "2026-10-11T10:00:00.000Z"]);
  await db.run("INSERT INTO leads(id,organization_id,name,source,status,created_at,updated_at) VALUES ('lead','org','Existing opted out lead','MANUAL','OPTED_OUT',?,?)", [STAMP, STAMP]);
  await db.run("INSERT INTO audit_logs(id,organization_id,lead_id,event_type,message,metadata_json,created_at) VALUES ('audit','org','lead','ExistingAudit','Historical evidence','{}',?)", [STAMP]);
}
async function snapshot(db) {
  const result = {};
  for (const table of ["organizations", "users", "sessions", "leads", "audit_logs", "schema_migrations"]) result[table] = await db.all("SELECT * FROM " + table + " ORDER BY id");
  return result;
}
async function preserved(db, before) {
  for (const [table, rows] of Object.entries(before)) {
    const current = await db.all("SELECT * FROM " + table + " ORDER BY id");
    assert.deepEqual(table === "schema_migrations" ? current.filter((row) => row.id !== migration.id) : current, rows, table);
  }
}
async function upgrade(db) {
  await seed(db); const before = await snapshot(db);
  assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), [migration.id]); await preserved(db, before);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM workspace_dispatch_controls")).n, 0);
  assert.deepEqual((await db.all("SELECT id,updated_at FROM auth_admission_state")).map((row) => ({ ...row })), [{ id: "default", updated_at: "1970-01-01T00:00:00.000Z" }]);
  const buckets = await db.all("SELECT * FROM auth_rate_buckets ORDER BY operation"); assert.equal(buckets.length, 2);
  for (const [index, operation] of ["LOGIN", "REGISTER"].entries()) {
    assert.deepEqual({ ...buckets[index] }, { operation, bucket_kind: "GLOBAL", identity_hash: "0".repeat(64), window_started_at: "1970-01-01T00:00:00.000Z", reset_at: "1970-01-01T00:00:00.000Z", attempts: 0 });
  }
  await db.run("UPDATE auth_rate_buckets SET attempts=7 WHERE operation='LOGIN'");
  assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), []);
  assert.equal((await db.get("SELECT attempts FROM auth_rate_buckets WHERE operation='LOGIN'")).attempts, 7);
}
test("0008 preserves historical account/session/contact evidence and seeds only zero-use global controls", async (t) => upgrade(await sqlite(t)));

async function constraints(db) {
  await seed(db); await runMigrations(db, { migrations: CURRENT });
  for (const patch of ["operation='OTHER'", "bucket_kind='OTHER'", "identity_hash='x'", "identity_hash='" + "f".repeat(64) + "'", "attempts=-1"]) await assert.rejects(db.run("UPDATE auth_rate_buckets SET " + patch + " WHERE operation='LOGIN'"), /check|constraint/i);
  await assert.rejects(db.run("INSERT INTO auth_admission_state(id,updated_at) VALUES ('other',?)", [STAMP]), /check|constraint/i);
  await db.run("INSERT INTO workspace_dispatch_controls(organization_id,revision,paused,daily_attempt_limit,unresolved_limit,reason,updated_at,updated_by) VALUES ('org',1,0,100,2,'Synthetic reviewed controls',?,'owner')", [STAMP]);
  for (const patch of ["revision=0", "paused=2", "daily_attempt_limit=0", "daily_attempt_limit=1001", "unresolved_limit=0", "unresolved_limit=11", "reason=' '", "reason='" + "x".repeat(2001) + "'", "updated_by='missing'"]) await assert.rejects(db.run("UPDATE workspace_dispatch_controls SET " + patch + " WHERE organization_id='org'"), /check|constraint|foreign/i);
  await assert.rejects(db.run("INSERT INTO workspace_dispatch_controls(organization_id,revision,paused,daily_attempt_limit,unresolved_limit,reason,updated_at,updated_by) VALUES ('missing',1,0,100,2,'Synthetic',?,'owner')", [STAMP]), /foreign|constraint/i);
}
test("0008 constrains rate identities and typed owner dispatch controls", async (t) => constraints(await sqlite(t)));

test("0008 interrupted DDL and failed ledger write roll back auth and controls together", async (t) => {
  const db = await sqlite(t); await seed(db); const before = await snapshot(db);
  await assert.rejects(runMigrations(db, { migrations: [...PREVIOUS, { id: migration.id, async up(tx) { await migration.up(tx); throw new Error("Synthetic interruption"); } }] }), /Synthetic interruption/);
  await preserved(db, before);
  for (const table of ["auth_admission_state", "auth_rate_buckets", "workspace_dispatch_controls"]) assert.equal(await db.columnExists(table, table === "workspace_dispatch_controls" ? "organization_id" : table === "auth_rate_buckets" ? "operation" : "id"), false);
  await db.exec("CREATE TRIGGER reject_operational_marker BEFORE INSERT ON schema_migrations WHEN NEW.id='0008_operational_controls' BEGIN SELECT RAISE(ABORT,'synthetic marker failure'); END");
  await assert.rejects(runMigrations(db, { migrations: CURRENT }), /synthetic marker failure/); await preserved(db, before);
  assert.deepEqual((await getMigrationStatus(db, { migrations: CURRENT })).pending, [migration.id]);
  assert.equal(await db.columnExists("workspace_dispatch_controls", "organization_id"), false);
  await db.exec("DROP TRIGGER reject_operational_marker"); assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), [migration.id]);
});

const context = postgresTestContext();
async function postgres(t) {
  const schema = schemaFor(context.runId, "adapter"), admin = await connectTestAdmin(context);
  try { await admin.exec('CREATE SCHEMA "' + schema + '"'); } finally { await admin.close(); }
  const db = await openDatabaseClient(schemaDatabaseConfig(context, schema));
  t.after(async () => { await db.close(); const admin = await connectTestAdmin(context); try { await admin.exec('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'); } finally { await admin.close(); } });
  return db;
}
test("postgres0008 preserves history and durable admission state", { skip: context ? false : "Requires explicit disposable PostgreSQL runner" }, async (t) => upgrade(await postgres(t)));
test("postgres0008 enforces typed operational constraints", { skip: context ? false : "Requires explicit disposable PostgreSQL runner" }, async (t) => constraints(await postgres(t)));
