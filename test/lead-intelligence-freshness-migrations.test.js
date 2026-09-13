import test from "node:test";
import assert from "node:assert/strict";
import { SqliteDatabaseClient } from "../src/database/sqliteClient.js";
import { openDatabaseClient } from "../src/database/database.js";
import { runMigrations } from "../src/database/migrate.js";
import { MIGRATIONS } from "../src/database/migrations/index.js";
import * as migration from "../src/database/migrations/0013_intelligence_freshness.js";
import { ContactPolicyService } from "../src/modules/contact-policy/contactPolicyService.js";
import { FreshnessRepository } from "../src/modules/lead-intelligence/freshnessRepository.js";
import { connectTestAdmin, postgresTestContext, schemaDatabaseConfig, schemaFor } from "../scripts/helpers/testSafety.js";
const previous = MIGRATIONS.filter(item => item.id < migration.id), current = [...previous, migration], stamp = "2026-01-02T00:00:00.000Z";
async function sqlite(t) { const db = new SqliteDatabaseClient(":memory:"); t.after(() => db.close()); return db; }
async function seed(db) {
  await runMigrations(db, { migrations: previous });
  await db.run("INSERT INTO organizations(id,name,created_at) VALUES ('org','Synthetic',?)", [stamp]);
  await db.run("INSERT INTO leads(id,organization_id,name,source,status,created_at,updated_at) VALUES ('lead','org','Legacy','CSV','SUPPRESSED',?,?)", [stamp, stamp]);
  await db.run("INSERT INTO intelligence_snapshots(id,organization_id,lead_id,input_fingerprint,summary,score,next_best_action,evidence_json,created_at) VALUES ('old','org','lead','original-input','Original analysis',0,'CREATE_HUMAN_TASK','[]',?)", [stamp]);
}
async function upgrade(db) {
  await seed(db); const before = await db.get("SELECT * FROM intelligence_snapshots WHERE id='old'"), lead = await db.get("SELECT * FROM leads");
  assert.deepEqual(await runMigrations(db, { migrations: current }), [migration.id]);
  const after = await db.get("SELECT * FROM intelligence_snapshots WHERE id='old'"); assert.equal(after.freshness_json, null); delete after.freshness_json; assert.deepEqual(after, before); assert.deepEqual(await db.get("SELECT * FROM leads"), lead);
  assert.equal(Number((await db.get("SELECT count(*) n FROM workspace_freshness_clocks")).n), 0); assert.deepEqual(await runMigrations(db, { migrations: current }), []);
}
async function constraints(db) {
  await seed(db); await runMigrations(db, { migrations: current });
  await assert.rejects(db.run("UPDATE intelligence_snapshots SET freshness_json=? WHERE id='old'", ["x".repeat(262145)]), /constraint|check/i);
  await assert.rejects(db.run("UPDATE intelligence_snapshots SET freshness_json=? WHERE id='old'", [String.fromCodePoint(0x20AC).repeat(87382)]), /constraint|check/i);
  await assert.rejects(db.run("INSERT INTO workspace_freshness_clocks(organization_id,high_water_at) VALUES ('missing',?)", [stamp]), /constraint|foreign/i);
  await assert.rejects(db.run("INSERT INTO workspace_freshness_clocks(organization_id,high_water_at) VALUES ('org','invalid')"), /constraint|check/i);
  await new ContactPolicyService(db).withWorkspacePolicyTransaction("org", tx => new FreshnessRepository(tx).effectiveTime("org", Date.parse(stamp)));
  await assert.rejects(db.run("INSERT INTO workspace_freshness_clocks(organization_id,high_water_at) VALUES ('org',?)", [stamp]), /constraint|unique|duplicate/i);
}
test("0013 preserves historical fingerprints and starts with no fabricated freshness clock", async t => upgrade(await sqlite(t)));
test("0013 bounds assessment UTF8 bytes and scopes one workspace clock", async t => constraints(await sqlite(t)));
test("0013 interrupted DDL and failed migration marker roll back schema and history together", async t => {
  const db = await sqlite(t); await seed(db); const before = await db.get("SELECT * FROM intelligence_snapshots WHERE id='old'");
  await assert.rejects(runMigrations(db, { migrations: [...previous, { id: migration.id, async up(tx) { await migration.up(tx); throw new Error("Synthetic interrupted freshness migration"); } }] }), /Synthetic interrupted/);
  assert.equal(await db.columnExists("intelligence_snapshots", "freshness_json"), false); assert.equal(await db.columnExists("workspace_freshness_clocks", "high_water_at"), false); assert.deepEqual(await db.get("SELECT * FROM intelligence_snapshots WHERE id='old'"), before);
  await db.exec("CREATE TRIGGER reject_freshness_marker BEFORE INSERT ON schema_migrations WHEN NEW.id='0013_intelligence_freshness' BEGIN SELECT RAISE(ABORT,'synthetic freshness marker failure'); END");
  await assert.rejects(runMigrations(db, { migrations: current }), /synthetic freshness marker failure/); assert.equal(await db.columnExists("intelligence_snapshots", "freshness_json"), false);
  await db.exec("DROP TRIGGER reject_freshness_marker"); assert.deepEqual(await runMigrations(db, { migrations: current }), [migration.id]);
});
const context = postgresTestContext();
async function postgres(t) {
  const schema = schemaFor(context.runId, "freshness"), admin = await connectTestAdmin(context); try { await admin.exec('CREATE SCHEMA "' + schema + '"'); } finally { await admin.close(); }
  const db = await openDatabaseClient(schemaDatabaseConfig(context, schema)); t.after(async () => { await db.close(); const cleanup = await connectTestAdmin(context); try { await cleanup.exec('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'); } finally { await cleanup.close(); } }); return { db, schema };
}
test("postgres0013 preserves populated prior snapshots", { skip: context ? false : "Requires explicit disposable PostgreSQL runner" }, async t => upgrade((await postgres(t)).db));
test("postgres0013 enforces byte bounds and workspace ownership", { skip: context ? false : "Requires explicit disposable PostgreSQL runner" }, async t => constraints((await postgres(t)).db));
test("postgres0013 independent connections preserve highest observed time after domain rejection", { skip: context ? false : "Requires explicit disposable PostgreSQL runner" }, async t => {
  const { db, schema } = await postgres(t); await seed(db); await runMigrations(db, { migrations: current }); const other = await openDatabaseClient(schemaDatabaseConfig(context, schema)); t.after(() => other.close());
  const later = Date.parse(stamp) + 100000, earlier = Date.parse(stamp);
  await Promise.allSettled([new ContactPolicyService(db).withWorkspacePolicyTransaction("org", async tx => { await new FreshnessRepository(tx).effectiveTime("org", later); await tx.run("UPDATE leads SET name='Rollback' WHERE id='lead'"); throw new Error("Rejected after time observation"); }), new ContactPolicyService(other).withWorkspacePolicyTransaction("org", tx => new FreshnessRepository(tx).effectiveTime("org", earlier))]);
  assert.equal((await db.get("SELECT high_water_at FROM workspace_freshness_clocks")).high_water_at, new Date(later).toISOString()); assert.equal((await db.get("SELECT name FROM leads")).name, "Legacy");
});
