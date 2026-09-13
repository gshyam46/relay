import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { SqliteDatabaseClient } from "../src/database/sqliteClient.js";
import { openDatabaseClient } from "../src/database/database.js";
import { runMigrations, getMigrationStatus } from "../src/database/migrate.js";
import { MIGRATIONS } from "../src/database/migrations/index.js";
import * as migration from "../src/database/migrations/0010_reviewed_import.js";
import { ImportsService } from "../src/modules/data-foundation/importsService.js";
import { ImportsRepository } from "../src/modules/data-foundation/importsRepository.js";
import { connectTestAdmin, postgresTestContext, schemaDatabaseConfig, schemaFor } from "../scripts/helpers/testSafety.js";

const PREVIOUS = MIGRATIONS.filter(item => item.id < migration.id), CURRENT = [...PREVIOUS, migration], STAMP = "2026-09-12T10:00:00.000Z";
async function sqlite(t) { const db = new SqliteDatabaseClient(":memory:"); t.after(() => db.close()); return db; }
async function seed(db) {
  await runMigrations(db, { migrations: PREVIOUS });
  for (const [org, owner, batch, row, lead, event] of [["org", "owner", "batch", "row", "lead", "event"], ["other", "other-owner", "other-batch", "other-row", "other-lead", "other-event"]]) {
    await db.run("INSERT INTO organizations(id,name,created_at) VALUES (?,?,?)", [org, "Synthetic " + org, STAMP]);
    await db.run("INSERT INTO users(id,organization_id,name,email,role,created_at) VALUES (?,?,?,?,'OWNER',?)", [owner, org, "Synthetic owner", owner + "@example.test", STAMP]);
    await db.run("INSERT INTO import_batches(id,organization_id,filename,adapter_type,source_metadata_json,state,idempotency_key,summary_json,created_at,updated_at) VALUES (?,?,?,'CSV','{}','READY_TO_COMMIT',?,'{}',?,?)", [batch, org, "old-source.csv", batch + "-key", STAMP, STAMP]);
    await db.run("INSERT INTO import_rows(id,import_id,organization_id,row_number,raw_row_json,mapped_values_json,normalized_values_json,validation_state,duplicate_candidates_json,created_at,updated_at) VALUES (?,?,?,2,?,'{}','{}','VALID','[]',?,?)", [row, batch, org, JSON.stringify({ Name: "Historical source" }), STAMP, STAMP]);
    await db.run("INSERT INTO leads(id,organization_id,name,source,status,created_at,updated_at) VALUES (?,?,?,'MANUAL','OPTED_OUT',?,?)", [lead, org, "Historical lead", STAMP, STAMP]);
    await db.run("INSERT INTO domain_events(id,organization_id,lead_id,type,payload_json,status,created_at) VALUES (?,?,?,'HistoricalEvent','{}','PROCESSED',?)", [event, org, lead, STAMP]);
  }
  await db.run("UPDATE import_batches SET state='COMMITTED',committed_at=? WHERE id='other-batch'", [STAMP]);
  await db.run("UPDATE import_rows SET committed=1,selected=1,created_lead_id='other-lead' WHERE id='other-row'");
}
const TABLES = ["organizations", "users", "import_batches", "import_rows", "import_issues", "leads", "domain_events", "audit_logs", "schema_migrations"];
async function snapshot(db) { const result = {}; for (const table of TABLES) result[table] = await db.all("SELECT * FROM " + table + " ORDER BY id"); return result; }
async function preserved(db, before) {
  for (const [table, rows] of Object.entries(before)) {
    let current = await db.all("SELECT * FROM " + table + " ORDER BY id");
    if (table === "schema_migrations") current = current.filter(row => row.id !== migration.id);
    assert.equal(current.length, rows.length, table);
    for (let i = 0; i < rows.length; i++) for (const [key, value] of Object.entries(rows[i])) assert.deepEqual(current[i][key], value, table + "." + key);
  }
}
async function upgrade(db) {
  await seed(db);
  const unicode = "  " + String.fromCodePoint(201) + "lodie  ", largeName = "Legacy" + "x".repeat(40000);
  await db.run("UPDATE leads SET name=?,company=' AcME ' WHERE id='lead'", [unicode]);
  await db.run("UPDATE leads SET name=?,company=' Old workshop ' WHERE id='other-lead'", [largeName]);
  for (let index = 0; index < 201; index++) await db.run("INSERT INTO leads(id,organization_id,name,company,source,status,created_at,updated_at) VALUES (?,'org',?,' Pages ','MANUAL','NEW',?,?)", ["legacy-page-" + String(index).padStart(3, "0"), "Legacy NAME " + index, STAMP, STAMP]);
  const before = await snapshot(db);
  assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), [migration.id]); await preserved(db, before);
  const digest = (name, company) => createHash("sha256").update(name.trim().toLowerCase() + "|" + company.trim().toLowerCase()).digest("hex");
  assert.equal((await db.get("SELECT normalized_name_company_key FROM leads WHERE id='lead'")).normalized_name_company_key, digest(unicode, "Acme"));
  assert.equal((await db.get("SELECT normalized_name_company_key FROM leads WHERE id='other-lead'")).normalized_name_company_key, digest(largeName, "Old workshop"));
  assert.equal((await db.get("SELECT normalized_name_company_key FROM leads WHERE id='legacy-page-200'")).normalized_name_company_key, digest("Legacy NAME 200", "Pages"));
  assert.equal((await db.get("SELECT count(*) n FROM leads WHERE length(normalized_name_company_key)=64")).n, 203);
  for (const row of await db.all("SELECT * FROM import_batches")) { assert.equal(row.contract_version, 0); assert.equal(row.review_revision, 0); assert.equal(row.frozen_selection_json, null); assert.equal(row.created_by, null); }
  assert.equal((await db.get("SELECT count(*) n FROM import_row_outcomes")).n, 0); assert.equal((await db.get("SELECT count(*) n FROM import_row_corrections")).n, 0);
  assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), []); await preserved(db, before);
}
async function constraints(db) {
  await seed(db); await runMigrations(db, { migrations: CURRENT });
  const insertOutcome = patch => {
    const row = { organization_id: "org", import_id: "batch", import_row_id: "row", review_revision: 1, state: "COMMITTED", lead_id: "lead", event_id: "event", hold_reason: null, created_at: STAMP, ...patch };
    return db.run("INSERT INTO import_row_outcomes(organization_id,import_id,import_row_id,review_revision,state,lead_id,event_id,hold_reason,created_at) VALUES (?,?,?,?,?,?,?,?,?)", Object.values(row));
  };
  for (const patch of [{ organization_id: "other" }, { import_id: "other-batch" }, { import_row_id: "other-row" }, { lead_id: "other-lead" }, { event_id: "other-event" }, { review_revision: 0 }, { state: "HELD" }, { hold_reason: "DUPLICATE_REVIEW_REQUIRED" }, { event_id: null }]) await assert.rejects(insertOutcome(patch), /foreign|check|constraint/i);
  await insertOutcome({}); await assert.rejects(insertOutcome({}), /unique|duplicate|constraint/i);
  const correction = patch => {
    const row = { id: "correction", organization_id: "org", import_id: "batch", import_row_id: "row", revision: 2, reason: "Reviewed correction", before_json: "{}", after_json: "{}", created_at: STAMP, created_by: "owner", ...patch };
    return db.run("INSERT INTO import_row_corrections(id,organization_id,import_id,import_row_id,revision,reason,before_json,after_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)", Object.values(row));
  };
  for (const patch of [{ created_by: "other-owner" }, { import_row_id: "other-row" }, { import_id: "other-batch" }, { revision: 1 }, { revision: 102 }, { reason: " " }, { before_json: "x".repeat(2097153) }, { after_json: "x".repeat(2097153) }]) await assert.rejects(correction(patch), /foreign|check|constraint/i);
  await correction({}); await assert.rejects(correction({ id: "other-correction" }), /unique|duplicate|constraint/i);
  await assert.rejects(db.run("UPDATE import_rows SET commit_state='UNKNOWN' WHERE id='row'"), /check|constraint/i);
  await assert.rejects(db.run("UPDATE import_batches SET contract_version=3 WHERE id='batch'"), /check|constraint/i);
}

test("0010 preserves populated legacy preview/completed records without invented frozen selections or outcomes", async t => upgrade(await sqlite(t)));
test("0010 constrains scoped row/actor/lead/event ownership, unique outcomes and bounded correction history", async t => constraints(await sqlite(t)));
test("0010 interrupted DDL and failed migration marker roll back columns, tables and ledger together", async t => {
  const db = await sqlite(t); await seed(db); const before = await snapshot(db);
  await assert.rejects(runMigrations(db, { migrations: [...PREVIOUS, { id: migration.id, async up(tx) { await migration.up(tx); throw new Error("Synthetic interrupted import migration"); } }] }), /Synthetic interrupted/);
  await preserved(db, before); assert.equal(await db.columnExists("import_batches", "contract_version"), false); assert.equal(await db.columnExists("leads", "normalized_name_company_key"), false); assert.equal(await db.columnExists("import_row_outcomes", "state"), false);
  await db.exec("CREATE TRIGGER reject_import_marker BEFORE INSERT ON schema_migrations WHEN NEW.id='0010_reviewed_import' BEGIN SELECT RAISE(ABORT,'synthetic migration marker failure'); END");
  await assert.rejects(runMigrations(db, { migrations: CURRENT }), /synthetic migration marker failure/);
  await preserved(db, before); assert.deepEqual((await getMigrationStatus(db, { migrations: CURRENT })).pending, [migration.id]);
  await db.exec("DROP TRIGGER reject_import_marker"); assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), [migration.id]);
});

const context = postgresTestContext();
async function postgres(t) {
  const schema = schemaFor(context.runId, "adapter"), admin = await connectTestAdmin(context);
  try { await admin.exec('CREATE SCHEMA "' + schema + '"'); } finally { await admin.close(); }
  const db = await openDatabaseClient(schemaDatabaseConfig(context, schema));
  t.after(async () => { await db.close(); const cleanup = await connectTestAdmin(context); try { await cleanup.exec('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'); } finally { await cleanup.close(); } });
  return { db, schema };
}
test("postgres0010 preserves populated historical imports without replay", { skip: context ? false : "Requires explicit disposable PostgreSQL runner" }, async t => upgrade((await postgres(t)).db));
test("postgres0010 enforces scoped immutable outcomes and review history", { skip: context ? false : "Requires explicit disposable PostgreSQL runner" }, async t => constraints((await postgres(t)).db));
test("postgres0010 independent connections serialize identical preview and row commit intents", { skip: context ? false : "Requires explicit disposable PostgreSQL runner" }, async t => {
  const { db, schema } = await postgres(t); await seed(db); await runMigrations(db, { migrations: CURRENT });
  // Runtime services require the current application schema; frozen0010 upgrade assertions above stay scoped.
  await runMigrations(db);
  const other = await openDatabaseClient(schemaDatabaseConfig(context, schema)); t.after(() => other.close());
  const services = [db, other].map(connection => new ImportsService({ importsRepository: new ImportsRepository(connection) }));
  const input = { organization_id: "org", actor: { id: "owner", role: "OWNER" }, filename: "concurrent.csv", csv_text: "Name,Email,Budget\nSynthetic,concurrent@example.test,9007199254740993.01", mapping: { name: 0, email: 1, budget_amount: 2 }, options: { date_format: "ISO", default_currency: "INR", assertion: "OPERATOR_OBSERVED" }, default_phone_region: "INTERNATIONAL_ONLY" };
  const previews = await Promise.all(services.map(service => service.previewCsv(input))); assert.equal(previews[0].import_id, previews[1].import_id);
  const command = { organization_id: "org", import_id: previews[0].import_id, actor: input.actor, expected_revision: 1, selected_row_ids: [previews[0].rows[0].id] };
  const done = await Promise.all(services.map(service => service.commitImport(command))); assert.ok(done.every(value => value.state === "COMMITTED"));
  assert.equal((await db.get("SELECT count(*) n FROM import_row_outcomes WHERE import_id=?", [command.import_id])).n, 1);
  const enquiry = await db.get("SELECT enquiry_json FROM lead_enquiry_revisions WHERE organization_id='org'");
  assert.equal(JSON.parse(enquiry.enquiry_json).budget.value.minimum_minor, "900719925474099301");
  assert.equal((await db.get("SELECT count(*) n FROM audit_logs WHERE event_type='ImportCommitted'")).n, 1);
});
