import test from "node:test";
import assert from "node:assert/strict";
import { SqliteDatabaseClient } from "../src/database/sqliteClient.js";
import { openDatabaseClient } from "../src/database/database.js";
import { runMigrations } from "../src/database/migrate.js";
import { MIGRATIONS } from "../src/database/migrations/index.js";
import * as migration from "../src/database/migrations/0011_import_identity_resolution.js";
import { connectTestAdmin, postgresTestContext, schemaDatabaseConfig, schemaFor } from "../scripts/helpers/testSafety.js";
import { ImportIdentityService } from "../src/modules/data-foundation/importIdentityService.js";
import { ImportsService } from "../src/modules/data-foundation/importsService.js";
import { ImportsRepository } from "../src/modules/data-foundation/importsRepository.js";
import { LeadsRepository } from "../src/modules/data-foundation/leadsRepository.js";
const PREVIOUS = MIGRATIONS.filter(item => item.id < migration.id), CURRENT = [...PREVIOUS, migration], stamp = "2026-09-12T10:00:00.000Z";
async function sqlite(t) { const db = new SqliteDatabaseClient(":memory:"); t.after(() => db.close()); return db; }
async function seed(db) {
  await runMigrations(db, { migrations: PREVIOUS });
  for (const prefix of ["one", "two"]) {
    await db.run("INSERT INTO organizations(id,name,created_at) VALUES (?,?,?)", [prefix, "Synthetic", stamp]);
    await db.run("INSERT INTO users(id,organization_id,name,email,role,created_at) VALUES (?,?,?,?,'OWNER',?)", [prefix + "-owner", prefix, "Synthetic", prefix + "@example.test", stamp]);
    await db.run("INSERT INTO leads(id,organization_id,name,source,status,created_at,updated_at) VALUES (?,?,'Existing','SYNTHETIC','OPTED_OUT',?,?)", [prefix + "-lead", prefix, stamp, stamp]);
    await db.run("INSERT INTO domain_events(id,organization_id,lead_id,type,payload_json,status,created_at) VALUES (?,?,?,'Historical','{}','PROCESSED',?)", [prefix + "-event", prefix, prefix + "-lead", stamp]);
    await db.run("INSERT INTO import_batches(id,organization_id,filename,adapter_type,source_metadata_json,state,idempotency_key,summary_json,created_at,updated_at,contract_version,review_revision,frozen_selection_json,commit_revision) VALUES (?,?,'source.csv','CSV','{}','COMMITTED',?,'{}',?,?,2,1,?,1)", [prefix + "-batch", prefix, prefix + "-key", stamp, stamp, JSON.stringify([prefix + "-row"])]);
    await db.run("INSERT INTO import_rows(id,organization_id,import_id,row_number,raw_row_json,raw_cells_json,mapped_values_json,normalized_values_json,validation_state,selected,committed,commit_state,hold_reason,duplicate_candidates_json,created_at,updated_at) VALUES (?,?,?,2,'{}','[]','{}','{}','VALID',1,0,'HELD','DUPLICATE_REVIEW_REQUIRED','[]',?,?)", [prefix + "-row", prefix, prefix + "-batch", stamp, stamp]);
    await db.run("INSERT INTO import_row_outcomes(organization_id,import_id,import_row_id,review_revision,state,hold_reason,created_at) VALUES (?,?,?,1,'HELD','DUPLICATE_REVIEW_REQUIRED',?)", [prefix, prefix + "-batch", prefix + "-row", stamp]);
  }
}
async function snapshot(db) { const data = {}; for (const table of ["organizations", "users", "leads", "domain_events", "import_batches", "import_rows", "import_row_outcomes", "audit_logs"]) data[table] = await db.all("SELECT * FROM " + table); return data; }
async function upgrade(db) {
  await seed(db); const before = await snapshot(db);
  assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), [migration.id]); assert.deepEqual(await snapshot(db), before);
  assert.equal((await db.get("SELECT count(*) n FROM import_identity_resolutions")).n, 0); assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), []);
}
async function constraints(db) {
  await seed(db); await runMigrations(db, { migrations: CURRENT });
  const insert = patch => {
    const row = { id: "resolution", organization_id: "one", import_id: "one-batch", import_row_id: "one-row", review_revision: 1, review_token: "a".repeat(64), request_hash: "b".repeat(64), decision: "LINK_EXISTING", classification: "SAME_ENQUIRY", target_lead_id: "one-lead", lead_id: "one-lead", event_id: null, reason: "Owner checked duplicate", review_snapshot_json: "{}", created_at: stamp, created_by: "one-owner", ...patch };
    return db.run("INSERT INTO import_identity_resolutions(" + Object.keys(row).join(",") + ") VALUES (" + Object.keys(row).map(() => "?").join(",") + ")", Object.values(row));
  };
  for (const patch of [{ organization_id: "two" }, { import_id: "two-batch" }, { import_row_id: "two-row" }, { target_lead_id: "two-lead", lead_id: "two-lead" }, { created_by: "two-owner" }, { review_revision: 0 }, { review_revision: 1.5 }, { decision: "MERGE" }, { classification: "REPEATED_ENQUIRY" }, { target_lead_id: null }, { lead_id: null }, { event_id: "one-event" }, { review_token: "" }, { request_hash: "x".repeat(65) }, { reason: " " }, { reason: "x".repeat(2001) }, { review_snapshot_json: "x".repeat(524289) }, { decision: "CREATE_SEPARATE", classification: "DISTINCT_ENQUIRY", target_lead_id: null, event_id: "two-event" }]) await assert.rejects(insert(patch), /foreign|check|constraint/i);
  await insert({}); await assert.rejects(insert({ id: "second" }), /unique|duplicate|constraint/i);
  // A separate enquiry has its own unique event and lead; linking another row to that lead remains legal.
  await insert({ id: "other-resolution", organization_id: "two", import_id: "two-batch", import_row_id: "two-row", decision: "CREATE_SEPARATE", classification: "SHARED_CONTACT", target_lead_id: null, lead_id: "two-lead", event_id: "two-event", created_by: "two-owner" });
}
test("0011 adds an empty identity ledger while preserving populated held outcomes and source history", async t => upgrade(await sqlite(t)));
test("0011 enforces scoped association, decision combinations, exact row identity and bounded snapshots", async t => constraints(await sqlite(t)));
test("0011 interrupted DDL and migration marker failures roll back the entire addition", async t => {
  const db = await sqlite(t); await seed(db); const before = await snapshot(db);
  await assert.rejects(runMigrations(db, { migrations: [...PREVIOUS, { id: migration.id, async up(tx) { await migration.up(tx); throw new Error("Synthetic interrupted identity DDL"); } }] }), /Synthetic interrupted/);
  assert.deepEqual(await snapshot(db), before); assert.equal(await db.columnExists("import_identity_resolutions", "id"), false);
  await db.exec("CREATE TRIGGER reject_identity_marker BEFORE INSERT ON schema_migrations WHEN NEW.id='0011_import_identity_resolution' BEGIN SELECT RAISE(ABORT,'synthetic identity marker failure'); END");
  await assert.rejects(runMigrations(db, { migrations: CURRENT }), /synthetic identity marker failure/);
  assert.deepEqual(await snapshot(db), before); assert.equal(await db.columnExists("import_identity_resolutions", "id"), false);
  await db.exec("DROP TRIGGER reject_identity_marker"); assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), [migration.id]);
});
const context = postgresTestContext();
async function postgres(t) {
  const schema = schemaFor(context.runId, "identity"), admin = await connectTestAdmin(context);
  try { await admin.exec('CREATE SCHEMA "' + schema + '"'); } finally { await admin.close(); }
  const db = await openDatabaseClient(schemaDatabaseConfig(context, schema));
  t.after(async () => { await db.close(); const cleanup = await connectTestAdmin(context); try { await cleanup.exec('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'); } finally { await cleanup.close(); } });
  return { db, schema };
}
test("postgres0011 preserves populated previous migration history", { skip: context ? false : "Requires explicit disposable PostgreSQL runner" }, async t => upgrade((await postgres(t)).db));
test("postgres0011 enforces scoped identity and source ownership", { skip: context ? false : "Requires explicit disposable PostgreSQL runner" }, async t => constraints((await postgres(t)).db));
test("postgres0011 competing connections persist one identity resolution", { skip: context ? false : "Requires explicit disposable PostgreSQL runner" }, async t => {
  const { db, schema } = await postgres(t); await seed(db); await runMigrations(db, { migrations: CURRENT });
  // Current runtime services require all application migrations; frozen0011 upgrade checks remain scoped above.
  await runMigrations(db);
  const other = await openDatabaseClient(schemaDatabaseConfig(context, schema)); t.after(() => other.close());
  await new LeadsRepository(db).createLead({ organization_id: "one", name: "Existing", email: "shared@example.test" });
  const actor = { id: "one-owner", role: "OWNER" }, imports = new ImportsService({ importsRepository: new ImportsRepository(db) });
  const batch = await imports.previewCsv({ organization_id: "one", actor, filename: "race.csv", csv_text: "Name,Email\nShared,shared@example.test", mapping: { name: 0, email: 1 }, options: { date_format: "ISO", default_currency: null, assertion: "OPERATOR_OBSERVED" }, default_phone_region: "INTERNATIONAL_ONLY" });
  const inputs = { organization_id: "one", import_id: batch.import_id, import_row_id: batch.rows[0].id, actor }, services = [db, other].map(connection => new ImportIdentityService(connection));
  const review = await services[0].review(inputs), command = { ...inputs, review_token: review.review_token, decision: "CREATE_SEPARATE", classification: "SHARED_CONTACT", target_lead_id: null, reason: "Reviewed shared address and separate enquiry" };
  const results = await Promise.all(services.map(service => service.resolve(command)));
  assert.equal(results[0].resolution.id, results[1].resolution.id); assert.equal((await db.get("SELECT count(*) n FROM import_identity_resolutions")).n, 1);
});
