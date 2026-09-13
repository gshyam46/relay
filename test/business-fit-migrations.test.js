import test from "node:test";
import assert from "node:assert/strict";
import { SqliteDatabaseClient } from "../src/database/sqliteClient.js";
import { openDatabaseClient } from "../src/database/database.js";
import { runMigrations } from "../src/database/migrate.js";
import { MIGRATIONS } from "../src/database/migrations/index.js";
import * as migration from "../src/database/migrations/0014_business_fit.js";
import { emptyProfile } from "../src/modules/business-context/businessContextContract.js";
import { connectTestAdmin, postgresTestContext, schemaDatabaseConfig, schemaFor } from "../scripts/helpers/testSafety.js";
const previous = MIGRATIONS.filter(item => item.id < migration.id), current = [...previous, migration], stamp = "2026-01-02T00:00:00.000Z";
async function sqlite(t) { const db = new SqliteDatabaseClient(":memory:"); t.after(() => db.close()); return db; }
async function seed(db) {
  await runMigrations(db, { migrations: previous });
  await db.run("INSERT INTO organizations(id,name,created_at) VALUES ('org','Synthetic',?)", [stamp]);
  await db.run("INSERT INTO users(id,organization_id,name,email,password_hash,role,created_at) VALUES ('owner','org','Owner','owner@example.test','synthetic','OWNER',?)", [stamp]);
  await db.run("INSERT INTO leads(id,organization_id,name,source,status,created_at,updated_at) VALUES ('lead','org','Legacy','CSV','SUPPRESSED',?,?)", [stamp, stamp]);
  await db.run("INSERT INTO intelligence_snapshots(id,organization_id,lead_id,input_fingerprint,summary,score,next_best_action,evidence_json,created_at) VALUES ('old','org','lead','original-input','Original analysis',0,'CREATE_HUMAN_TASK','[]',?)", [stamp]);
  await db.run("INSERT INTO business_profile_revisions(organization_id,revision,schema_version,profile_json,reason,created_at,created_by) VALUES ('org',1,1,?,'Original',?,'owner')", [JSON.stringify({ ...emptyProfile(), offerings: ["Synthetic desks"] }), stamp]);
}
async function upgrade(db) {
  await seed(db);
  const before = await db.get("SELECT * FROM intelligence_snapshots WHERE id='old'");
  const profile = await db.get("SELECT * FROM business_profile_revisions");
  assert.deepEqual(await runMigrations(db, { migrations: current }), [migration.id]);
  const after = await db.get("SELECT * FROM intelligence_snapshots WHERE id='old'");
  assert.equal(after.business_fit_json, null); delete after.business_fit_json; assert.deepEqual(after, before);
  const updatedProfile = await db.get("SELECT * FROM business_profile_revisions");
  assert.equal(updatedProfile.fit_criteria_json, null); delete updatedProfile.fit_criteria_json; assert.deepEqual(updatedProfile, profile);
  assert.deepEqual(await runMigrations(db, { migrations: current }), []);
}
async function constraints(db) {
  await seed(db); await runMigrations(db, { migrations: current });
  for (const [table, column, max] of [["business_profile_revisions", "fit_criteria_json",32768], ["intelligence_snapshots","business_fit_json",131072]]) {
    for (const value of ["x", "x".repeat(max+1), String.fromCodePoint(0x20AC).repeat(Math.floor(max/3)+1)]) {
      await assert.rejects(db.run("UPDATE " + table + " SET " + column + "=?", [value]), /constraint|check/i);
    }
    await db.run("UPDATE " + table + " SET " + column + "=?", ["{}"]);
    await db.run("UPDATE " + table + " SET " + column + "=NULL");
  }
}
test("0014 preserves historical profiles, snapshots and fingerprints without fabricated fit", async t => upgrade(await sqlite(t)));
test("0014 bounds nullable criteria and assessments by UTF8 byte size", async t => constraints(await sqlite(t)));
test("0014 interrupted DDL and failed marker roll back both new columns", async t => {
  const db = await sqlite(t); await seed(db);
  await assert.rejects(runMigrations(db, { migrations: [...previous, { id: migration.id, async up(tx) { await migration.up(tx); throw new Error("Synthetic interrupted fit migration"); } }] }), /Synthetic interrupted/);
  assert.equal(await db.columnExists("intelligence_snapshots", "business_fit_json"), false);
  assert.equal(await db.columnExists("business_profile_revisions", "fit_criteria_json"), false);
  await db.exec("CREATE TRIGGER reject_fit_marker BEFORE INSERT ON schema_migrations WHEN NEW.id='0014_business_fit' BEGIN SELECT RAISE(ABORT,'synthetic fit marker failure'); END");
  await assert.rejects(runMigrations(db, { migrations: current }), /synthetic fit marker failure/);
  assert.equal(await db.columnExists("business_profile_revisions", "fit_criteria_json"), false);
  await db.exec("DROP TRIGGER reject_fit_marker");
  assert.deepEqual(await runMigrations(db, { migrations: current }), [migration.id]);
});
const context = postgresTestContext();
async function postgres(t) {
  const schema = schemaFor(context.runId, "fit"), admin = await connectTestAdmin(context);
  try { await admin.exec('CREATE SCHEMA "' + schema + '"'); } finally { await admin.close(); }
  const db = await openDatabaseClient(schemaDatabaseConfig(context, schema));
  t.after(async () => { await db.close(); const cleanup = await connectTestAdmin(context); try { await cleanup.exec('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'); } finally { await cleanup.close(); } });
  return db;
}
test("postgres0014 preserves populated prior profiles and snapshots", {skip: context ? false : "Requires explicit disposable PostgreSQL runner"}, async t => upgrade(await postgres(t)));
test("postgres0014 enforces nullable UTF8 storage bounds", {skip: context ? false : "Requires explicit disposable PostgreSQL runner"}, async t => constraints(await postgres(t)));
