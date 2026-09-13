import test from "node:test";
import assert from "node:assert/strict";
import { SqliteDatabaseClient } from "../src/database/sqliteClient.js";
import { openDatabaseClient } from "../src/database/database.js";
import { runMigrations } from "../src/database/migrate.js";
import { MIGRATIONS } from "../src/database/migrations/index.js";
import * as migration from "../src/database/migrations/0012_lead_data_management.js";
import { LeadDataService } from "../src/modules/data-foundation/leadDataService.js";
import { connectTestAdmin, postgresTestContext, schemaDatabaseConfig, schemaFor } from "../scripts/helpers/testSafety.js";
const PREVIOUS = MIGRATIONS.filter(item => item.id < migration.id), CURRENT = [...PREVIOUS, migration], stamp = "2026-09-12T10:00:00.000Z";
async function sqlite(t) { const db = new SqliteDatabaseClient(":memory:"); t.after(() => db.close()); return db; }
async function seed(db) {
  await runMigrations(db, { migrations: PREVIOUS });
  for (const org of ["one", "two"]) {
    await db.run("INSERT INTO organizations(id,name,created_at) VALUES (?,?,?)", [org, "Synthetic", stamp]);
    await db.run("INSERT INTO users(id,organization_id,name,email,role,created_at) VALUES (?,?,?,?,'OWNER',?)", [org + "-owner", org, "Synthetic", org + "@example.test", stamp]);
    await db.run("INSERT INTO leads(id,organization_id,name,email,normalized_email,source,status,created_at,updated_at) VALUES (?,?,'Historical','historical@example.test','historical@example.test','CSV','SUPPRESSED',?,?)", [org + "-lead", org, stamp, stamp]);
  }
}
async function snapshot(db) { const data = {}; for (const table of ["organizations", "users", "leads", "domain_events", "contact_restrictions", "import_rows", "import_row_outcomes", "import_identity_resolutions", "audit_logs"]) data[table] = await db.all("SELECT * FROM " + table); return data; }
async function checkPreserved(db, before) { for (const [table, rows] of Object.entries(before)) { const now = await db.all("SELECT * FROM " + table); assert.equal(now.length, rows.length); for (let index = 0; index < rows.length; index++) for (const [key, value] of Object.entries(rows[index])) assert.deepEqual(now[index][key], value, table + "." + key); } }
async function upgrade(db) {
  await seed(db); const before = await snapshot(db); assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), [migration.id]); await checkPreserved(db, before);
  for (const lead of await db.all("SELECT * FROM leads")) { assert.equal(lead.data_revision, 0); assert.equal(lead.archived_at, null); assert.equal(lead.status, "SUPPRESSED"); }
  assert.equal((await db.get("SELECT count(*) n FROM lead_data_changes")).n, 0); assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), []);
}
async function constraints(db) {
  await seed(db); await runMigrations(db, { migrations: CURRENT });
  const insert = patch => { const row = { id: "change", organization_id: "one", lead_id: "one-lead", expected_revision: 0, revision: 1, kind: "CORRECT", before_json: "{}", after_json: "{}", review_token: "a".repeat(64), request_hash: "b".repeat(64), reason: "Owner correction", effects_json: "{}", created_at: stamp, created_by: "one-owner", ...patch }; return db.run("INSERT INTO lead_data_changes(" + Object.keys(row).join(",") + ") VALUES(" + Object.keys(row).map(() => "?").join(",") + ")", Object.values(row)); };
  for (const patch of [{ organization_id: "two" }, { lead_id: "two-lead" }, { created_by: "two-owner" }, { expected_revision: -1, revision: 0 }, { expected_revision: 0.5, revision: 1.5 }, { expected_revision: 2147483647, revision: 2147483648 }, { revision: 2 }, { kind: "DELETE" }, { review_token: null }, { review_token: "g".repeat(64) }, { request_hash: "x" }, { kind: "ARCHIVE" }, { reason: " " }, { reason: "x".repeat(2001) }, { before_json: "x".repeat(524289) }, { after_json: "x".repeat(524289) }, { effects_json: "x".repeat(1048577) }]) await assert.rejects(insert(patch), /foreign|check|constraint/i);
  await insert({}); await assert.rejects(insert({ id: "another" }), /unique|duplicate|constraint/i);
  await insert({ id: "archive", expected_revision: 1, revision: 2, kind: "ARCHIVE", review_token: null });
  await insert({ id: "restore", expected_revision: 2, revision: 3, kind: "RESTORE", review_token: null });
  for (const revision of [-1, 0.5, 2147483648]) await assert.rejects(db.run("UPDATE leads SET data_revision=? WHERE id='one-lead'", [revision]), /check|constraint/i);
}
test("0012 preserves populated identity/status/source and starts unarchived revision0 without invented history", async t => upgrade(await sqlite(t)));
test("0012 bounds immutable correction snapshots and effects with scoped ownership and revision identity", async t => constraints(await sqlite(t)));
test("0012 DDL and failed migration marker roll back columns and ledger together", async t => {
  const db = await sqlite(t); await seed(db); const before = await snapshot(db);
  await assert.rejects(runMigrations(db, { migrations: [...PREVIOUS, { id: migration.id, async up(tx) { await migration.up(tx); throw new Error("Synthetic interrupted data migration"); } }] }), /Synthetic interrupted/); await checkPreserved(db, before);
  assert.equal(await db.columnExists("leads", "data_revision"), false); assert.equal(await db.columnExists("lead_data_changes", "id"), false);
  await db.exec("CREATE TRIGGER reject_data_marker BEFORE INSERT ON schema_migrations WHEN NEW.id='0012_lead_data_management' BEGIN SELECT RAISE(ABORT,'synthetic data marker failure'); END");
  await assert.rejects(runMigrations(db, { migrations: CURRENT }), /synthetic data marker failure/); await checkPreserved(db, before); assert.equal(await db.columnExists("leads", "archived_at"), false);
  await db.exec("DROP TRIGGER reject_data_marker"); assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), [migration.id]);
});
const context = postgresTestContext();
async function postgres(t) {
  const schema = schemaFor(context.runId, "lead_data"), admin = await connectTestAdmin(context); try { await admin.exec('CREATE SCHEMA "' + schema + '"'); } finally { await admin.close(); }
  const db = await openDatabaseClient(schemaDatabaseConfig(context, schema));
  t.after(async () => { await db.close(); const cleanup = await connectTestAdmin(context); try { await cleanup.exec('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'); } finally { await cleanup.close(); } }); return { db, schema };
}
test("postgres0012 preserves populated prior data on upgrade", { skip: context ? false : "Requires explicit disposable PostgreSQL runner" }, async t => upgrade((await postgres(t)).db));
test("postgres0012 enforces immutable scoped revision and bounded snapshots", { skip: context ? false : "Requires explicit disposable PostgreSQL runner" }, async t => constraints((await postgres(t)).db));
test("postgres0012 independent connections replay exactly one correction", { skip: context ? false : "Requires explicit disposable PostgreSQL runner" }, async t => {
  const { db, schema } = await postgres(t); await seed(db); await runMigrations(db, { migrations: CURRENT }); const other = await openDatabaseClient(schemaDatabaseConfig(context, schema)); t.after(() => other.close());
  const services = [db, other].map(connection => new LeadDataService(connection)), input = { organization_id: "one", lead_id: "one-lead", expected_revision: 0, actor: { id: "one-owner", role: "OWNER" }, values: { name: "Corrected", email: "historical@example.test", phone: null, company: null }, default_phone_region: "INTERNATIONAL_ONLY" };
  const preview = await services[0].preview(input), command = { ...input, review_token: preview.review_token, reason: "Owner corrected historical record" };
  const results = await Promise.all(services.map(service => service.update(command))); assert.equal(results[0].change.id, results[1].change.id); assert.equal((await db.get("SELECT count(*) n FROM lead_data_changes")).n, 1);
});
