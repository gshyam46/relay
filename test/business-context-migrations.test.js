import test from "node:test";
import assert from "node:assert/strict";
import { SqliteDatabaseClient } from "../src/database/sqliteClient.js";
import { openDatabaseClient } from "../src/database/database.js";
import { runMigrations, getMigrationStatus } from "../src/database/migrate.js";
import { MIGRATIONS } from "../src/database/migrations/index.js";
import * as migration from "../src/database/migrations/0009_business_context.js";
import { BusinessContextService } from "../src/modules/business-context/businessContextService.js";
import { emptyEnquiry, emptyProfile } from "../src/modules/business-context/businessContextContract.js";
import { connectTestAdmin, postgresTestContext, schemaDatabaseConfig, schemaFor } from "../scripts/helpers/testSafety.js";

const PREVIOUS = MIGRATIONS.filter(item => item.id < migration.id), CURRENT = [...PREVIOUS, migration];
const STAMP = "2026-09-12T10:00:00.000Z";
async function sqlite(t) { const db = new SqliteDatabaseClient(":memory:"); t.after(() => db.close()); return db; }
async function seed(db) {
  await runMigrations(db, { migrations: PREVIOUS });
  for (const [org, owner, lead] of [["org", "owner", "lead"], ["other", "other-owner", "other-lead"]]) {
    await db.run("INSERT INTO organizations(id,name,created_at) VALUES (?,?,?)", [org, "Synthetic " + org, STAMP]);
    await db.run("INSERT INTO users(id,organization_id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,'historical exact hash','OWNER',?)", [owner, org, "Synthetic", owner + "@example.test", STAMP]);
    await db.run("INSERT INTO leads(id,organization_id,name,source,status,created_at,updated_at) VALUES (?,?,?,'MANUAL','OPTED_OUT',?,?)", [lead, org, "Historical lead", STAMP, STAMP]);
  }
  await db.run("INSERT INTO audit_logs(id,organization_id,lead_id,event_type,message,metadata_json,created_at) VALUES ('audit','org','lead','ExistingAudit','Historical evidence','{}',?)", [STAMP]);
  await db.run("INSERT INTO workspace_dispatch_controls(organization_id,revision,paused,daily_attempt_limit,unresolved_limit,reason,updated_at,updated_by) VALUES ('org',3,1,30,1,'Historical pause',?,'owner')", [STAMP]);
}
const PRESERVED = ["organizations", "users", "leads", "audit_logs", "workspace_dispatch_controls", "auth_rate_buckets", "schema_migrations"];
async function snapshot(db) {
  return Object.fromEntries(await Promise.all(PRESERVED.map(async table => [table, await db.all("SELECT * FROM " + table)])));
}
async function preserved(db, before) {
  for (const [table, rows] of Object.entries(before)) {
    const current = await db.all("SELECT * FROM " + table);
    assert.deepEqual(table === "schema_migrations" ? current.filter(row => row.id !== migration.id) : current, rows, table);
  }
}
async function upgrade(db) {
  await seed(db); const before = await snapshot(db);
  assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), [migration.id]);
  await preserved(db, before);
  for (const table of ["business_profile_revisions", "lead_enquiry_revisions"]) assert.equal((await db.get("SELECT count(*) n FROM " + table)).n, 0);
  assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), []);
  await preserved(db, before);
}
async function constraints(db) {
  await seed(db); await runMigrations(db, { migrations: CURRENT });
  const insertProfile = patch => {
    const row = { organization_id: "org", revision: 1, schema_version: 1, profile_json: "{}", reason: "Reviewed", created_at: STAMP, created_by: "owner", ...patch };
    return db.run("INSERT INTO business_profile_revisions(organization_id,revision,schema_version,profile_json,reason,created_at,created_by) VALUES (?,?,?,?,?,?,?)", Object.values(row));
  };
  for (const patch of [{ organization_id: "missing" }, { created_by: "other-owner" }, { revision: 0 }, { revision: 2147483648 }, { schema_version: 2 }, { reason: " " }, { profile_json: "x".repeat(32769) }, { profile_json: "\u20ac".repeat(12000) }]) await assert.rejects(insertProfile(patch), /constraint|foreign|check|range/i);
  await insertProfile({});
  await assert.rejects(insertProfile({}), /constraint|unique|duplicate/i);
  const insertEnquiry = patch => {
    const row = { organization_id: "org", lead_id: "lead", revision: 1, schema_version: 1, enquiry_json: "{}", reason: "Reviewed", created_at: STAMP, created_by: "owner", ...patch };
    return db.run("INSERT INTO lead_enquiry_revisions(organization_id,lead_id,revision,schema_version,enquiry_json,reason,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)", Object.values(row));
  };
  for (const patch of [{ lead_id: "other-lead" }, { created_by: "other-owner" }, { lead_id: "missing" }, { schema_version: 3 }, { revision: -1 }, { enquiry_json: "x".repeat(32769) }]) await assert.rejects(insertEnquiry(patch), /constraint|foreign|check/i);
  await insertEnquiry({});
  await assert.rejects(insertEnquiry({}), /constraint|unique|duplicate/i);
}
test("0009 populated upgrade preserves previous state and invents no business/enquiry records", async t => upgrade(await sqlite(t)));
test("0009 enforces scoped actor/lead references, version bounds, uniqueness and actual JSON byte limits", async t => constraints(await sqlite(t)));
test("0009 interrupted migration and failed ledger write roll back new schema without changing history", async t => {
  const db = await sqlite(t); await seed(db); const before = await snapshot(db);
  await assert.rejects(runMigrations(db, { migrations: [...PREVIOUS, { id: migration.id, async up(tx) { await migration.up(tx); throw new Error("Synthetic interrupted 0009"); } }] }), /Synthetic interrupted/);
  await preserved(db, before);
  assert.equal(await db.columnExists("business_profile_revisions", "organization_id"), false);
  assert.equal(await db.columnExists("lead_enquiry_revisions", "lead_id"), false);
  await db.exec("CREATE TRIGGER reject_context_marker BEFORE INSERT ON schema_migrations WHEN NEW.id='0009_business_context' BEGIN SELECT RAISE(ABORT,'synthetic ledger failure'); END");
  await assert.rejects(runMigrations(db, { migrations: CURRENT }), /synthetic ledger failure/);
  await preserved(db, before);
  assert.deepEqual((await getMigrationStatus(db, { migrations: CURRENT })).pending, [migration.id]);
  await db.exec("DROP TRIGGER reject_context_marker");
  assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), [migration.id]);
});

const context = postgresTestContext();
async function postgres(t) {
  const schema = schemaFor(context.runId, "adapter"), admin = await connectTestAdmin(context);
  try { await admin.exec('CREATE SCHEMA "' + schema + '"'); } finally { await admin.close(); }
  const db = await openDatabaseClient(schemaDatabaseConfig(context, schema));
  t.after(async () => { await db.close(); const cleanup = await connectTestAdmin(context); try { await cleanup.exec('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'); } finally { await cleanup.close(); } });
  return { db, schema };
}
test("postgres0009 preserves populated history without inventing context", { skip: context ? false : "Requires explicit disposable PostgreSQL runner" }, async t => upgrade((await postgres(t)).db));
test("postgres0009 enforces composite tenant keys and exact snapshot bounds", { skip: context ? false : "Requires explicit disposable PostgreSQL runner" }, async t => constraints((await postgres(t)).db));
test("postgres0009 competing independent connections serialize context revisions and preserve exact money", { skip: context ? false : "Requires explicit disposable PostgreSQL runner" }, async t => {
  const { db, schema } = await postgres(t); await seed(db); await runMigrations(db, { migrations: CURRENT });
  const other = await openDatabaseClient(schemaDatabaseConfig(context, schema)); t.after(() => other.close());
  const services = [new BusinessContextService(db), new BusinessContextService(other)];
  const outcomes = await Promise.allSettled(services.map((service, index) => service.updateProfile({ organization_id: "org", actor: { id: "owner", role: "OWNER" }, expected_revision: 0, reason: "Synthetic concurrent correction", profile: { ...emptyProfile(), business_name: "Synthetic " + index, offerings: ["Tables"] } })));
  assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(outcomes.find(item => item.status === "rejected").reason.code, "BUSINESS_CONTEXT_STALE");
  assert.equal((await db.get("SELECT count(*) n FROM audit_logs WHERE event_type='BusinessProfileUpdated'")).n, 1);
  const enquiry = emptyEnquiry();
  enquiry.budget = { state: "KNOWN", value: { currency: "KWD", minimum: "9007199254740993.123", maximum: "9007199254740993.124" }, provenance: { assertion: "CUSTOMER_STATED", source_type: "MANUAL", source_reference: "Synthetic precision fixture", observed_at: null } };
  await services[0].updateEnquiry({ organization_id: "org", lead_id: "lead", actor: { id: "owner", role: "OWNER" }, expected_revision: 0, reason: "Synthetic exact money", enquiry });
  const stored = await services[1].getEnquiry({ organization_id: "org", lead_id: "lead" });
  assert.equal(stored.enquiry.budget.value.minimum_minor, "9007199254740993123");
  assert.equal(stored.enquiry.budget.value.maximum_minor, "9007199254740993124");
});
