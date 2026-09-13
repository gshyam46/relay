import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SqliteDatabaseClient } from "../src/database/sqliteClient.js";
import { openDatabaseClient } from "../src/database/database.js";
import { runMigrations, getMigrationStatus } from "../src/database/migrate.js";
import { MIGRATIONS } from "../src/database/migrations/index.js";
import * as migration from "../src/database/migrations/0007_scheduler_event_recovery.js";
import { connectTestAdmin, postgresTestContext, schemaDatabaseConfig, schemaFor } from "../scripts/helpers/testSafety.js";

const PREVIOUS = MIGRATIONS.filter((item) => item.id < migration.id);
const CURRENT = [...PREVIOUS, migration];
const STAMP = "2026-09-11T10:00:00.000Z";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const cleanups = new WeakMap();
function cleanup(t, work) {
  if (!cleanups.has(t)) { cleanups.set(t, []); t.after(async () => { for (const fn of cleanups.get(t).toReversed()) await fn(); }); }
  cleanups.get(t).push(work);
}
async function sqlite(t, file = ":memory:") {
  const db = new SqliteDatabaseClient(file); cleanup(t, () => db.close()); return db;
}
async function seed(db) {
  await runMigrations(db, { migrations: PREVIOUS });
  await db.run("INSERT INTO organizations (id,name,created_at) VALUES ('org','Scheduler fixture',?)", [STAMP]);
  await db.run("INSERT INTO leads (id,organization_id,name,source,status,created_at,updated_at) VALUES ('lead','org','Existing lead','MANUAL','OPTED_OUT',?,?)", [STAMP, STAMP]);
  await db.run("INSERT INTO campaigns (id,organization_id,name,status,created_at,updated_at) VALUES ('campaign','org','Existing campaign','ACTIVE',?,?)", [STAMP, STAMP]);
  await db.run("INSERT INTO sequences (id,organization_id,campaign_id,name,status,created_at,updated_at) VALUES ('sequence','org','campaign','Existing sequence','ACTIVE',?,?)", [STAMP, STAMP]);
  await db.run("INSERT INTO sequence_steps (id,organization_id,sequence_id,step_order,type,title,payload_json,created_at,updated_at) VALUES ('step','org','sequence',0,'SEND_EMAIL','Existing step','{}',?,?)", [STAMP, STAMP]);
  for (const [id, status, attempts, payload] of [
    ["pending", "PENDING", 0, "{}"], ["partial", "PENDING", 0, '{"partially_applied":true}'],
    ["failed", "FAILED", 3, "invalid historical bytes"], ["processed", "PROCESSED", 1, "{}"],
    ["bad-counter", "FAILED", -3, "{}"]
  ]) await db.run("INSERT INTO domain_events (id,organization_id,lead_id,type,payload_json,status,attempts,last_error,created_at,processed_at) VALUES (?,'org','lead','LeadCreated',?,?,?,'original private failure',?,?)", [id, payload, status, attempts, STAMP, status === "PROCESSED" ? STAMP : null]);
  for (const status of ["ACTIVE", "WAITING", "WAITING_APPROVAL", "BLOCKED", "COMPLETED", "STOPPED"]) {
    await db.run("INSERT INTO workflow_runs (id,organization_id,campaign_id,sequence_id,lead_id,status,current_step_order,next_run_at,idempotency_key,created_at,updated_at,completed_at) VALUES (?,'org','campaign','sequence','lead',?,0,?,?,?, ?,?)",
      [status, status, "historical ambiguous due time", status, STAMP, STAMP, ["COMPLETED", "STOPPED"].includes(status) ? STAMP : null]);
  }
  await db.run("INSERT INTO actions (id,organization_id,lead_id,type,status,payload_json,idempotency_key,created_at,updated_at) VALUES ('action','org','lead','SEND_EMAIL','COMPLETED',?,'old-action',?,?)",
    [JSON.stringify({ workflow_run_id: "ACTIVE", sequence_step_id: "step" }), STAMP, STAMP]);
  await db.run("INSERT INTO audit_logs (id,organization_id,lead_id,event_type,message,metadata_json,created_at) VALUES ('audit','org','lead','ActionPlanned','Old side effect','{}',?)", [STAMP]);
}
async function snapshot(db) {
  const result = {};
  for (const table of ["domain_events", "workflow_runs", "actions", "audit_logs", "leads"]) result[table] = await db.all("SELECT * FROM " + table + " ORDER BY id");
  return result;
}
async function preserve(db, original) {
  for (const [table, rows] of Object.entries(original)) {
    const current = await db.all("SELECT * FROM " + table + " ORDER BY id");
    assert.equal(current.length, rows.length);
    for (let i = 0; i < rows.length; i++) for (const [column, value] of Object.entries(rows[i])) assert.deepEqual(current[i][column], value, table + "." + column);
  }
}
async function upgrade(db) {
  await seed(db); const before = await snapshot(db);
  assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), [migration.id]);
  await preserve(db, before);
  for (const event of await db.all("SELECT * FROM domain_events")) {
    assert.equal(event.processing_version, 0);
    assert.equal(event.processing_hold_reason, event.status === "PROCESSED" ? null : "LEGACY_EVENT_REVIEW_REQUIRED");
    for (const column of ["payload_hash", "updated_at", "first_processing_at", "retry_deadline_at", "next_attempt_at", "lease_owner", "lease_expires_at"]) assert.equal(event[column], null);
    assert.equal(event.processing_fence, 0);
  }
  for (const run of await db.all("SELECT * FROM workflow_runs")) {
    assert.equal(run.processing_version, 0); assert.equal(run.revision, 0);
    assert.equal(run.scheduler_hold_reason, ["COMPLETED", "STOPPED"].includes(run.status) ? null : "LEGACY_SCHEDULE_REVIEW_REQUIRED");
    assert.equal(run.step_anchor_at, null); assert.equal(run.paused_at, null);
  }
  const action = await db.get("SELECT * FROM actions WHERE id='action'");
  assert.equal(action.workflow_run_id, null); assert.equal(action.sequence_step_id, null);
  for (const table of ["domain_event_stages", "domain_event_reviews", "scheduler_workspaces"]) assert.equal((await db.get("SELECT COUNT(*) AS n FROM " + table)).n, 0);
  assert.equal((await db.get("SELECT * FROM scheduler_state")).id, "default");
  assert.equal((await db.get("SELECT * FROM scheduler_state")).last_organization_id, null);
  assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), []);
}
test("0007 preserves populated event/run history and holds ambiguous legacy work without fabricated cursors", async (t) => upgrade(await sqlite(t)));

async function constraints(db) {
  await seed(db); await runMigrations(db, { migrations: CURRENT });
  await db.run("INSERT INTO domain_events (id,organization_id,type,payload_json,status,created_at,updated_at,processing_version,payload_hash) VALUES ('managed','org','LeadCreated','{}','PENDING',?,?,1,?)", [STAMP, STAMP, digest("{}")]);
  for (const patch of ["processing_version=2", "payload_hash=NULL", "payload_hash='invalid'", "status='FAILED'", "attempts=-1", "max_attempts=0", "max_attempts=101", "processing_fence=-1", "updated_at=NULL"]) {
    await assert.rejects(db.run("UPDATE domain_events SET " + patch + " WHERE id='managed'"), /check|constraint/i);
  }
  await db.run("INSERT INTO domain_event_stages (id,organization_id,event_id,stage_key,input_fingerprint,status,prepared_at) VALUES ('stage','org','managed','snapshot',?,'PREPARED',?)", [digest("input"), STAMP]);
  await assert.rejects(db.run("UPDATE domain_event_stages SET status='DONE' WHERE id='stage'"), /check|constraint/i);
  await assert.rejects(db.run("UPDATE domain_event_stages SET input_fingerprint='bad' WHERE id='stage'"), /check|constraint/i);
  await assert.rejects(db.run("UPDATE domain_event_stages SET artifact_type='snapshot' WHERE id='stage'"), /check|constraint/i);
  await assert.rejects(db.run("INSERT INTO domain_event_stages (id,organization_id,event_id,stage_key,input_fingerprint,status,prepared_at) VALUES ('duplicate','org','managed','snapshot',?,'PREPARED',?)", [digest("input"), STAMP]), /unique|constraint/i);
  await assert.rejects(db.run("UPDATE domain_event_stages SET event_id='missing' WHERE id='stage'"), /foreign|constraint/i);
  await db.run("INSERT INTO domain_event_reviews (id,organization_id,event_id,expected_fence,decision,evidence_note,reviewer_user_id,created_at) VALUES ('review','org','managed',0,'CLOSE','Inspected synthetic evidence','owner',?)", [STAMP]);
  for (const patch of ["expected_fence=-1", "decision='RESET'", "evidence_note=' '", "reviewer_user_id=''"]) await assert.rejects(db.run("UPDATE domain_event_reviews SET " + patch + " WHERE id='review'"), /check|constraint/i);
  await assert.rejects(db.run("INSERT INTO domain_event_reviews (id,organization_id,event_id,expected_fence,decision,evidence_note,reviewer_user_id,created_at) VALUES ('duplicate-review','org','managed',0,'RETRY','Different intent','owner',?)", [STAMP]), /unique|constraint/i);
  await db.run("INSERT INTO scheduler_workspaces (organization_id) VALUES ('org')");
  for (const patch of ["visit_fence=-1", "next_phase=-1", "next_phase=6"]) await assert.rejects(db.run("UPDATE scheduler_workspaces SET " + patch + " WHERE organization_id='org'"), /check|constraint/i);
  await assert.rejects(db.run("INSERT INTO scheduler_workspaces (organization_id) VALUES ('missing')"), /foreign|constraint/i);
  await assert.rejects(db.run("INSERT INTO scheduler_state (id,updated_at) VALUES ('other',?)", [STAMP]), /check|constraint/i);
  await db.run("UPDATE actions SET workflow_run_id='ACTIVE',sequence_step_id='step' WHERE id='action'");
  await assert.rejects(db.run("UPDATE actions SET workflow_run_id='missing' WHERE id='action'"), /foreign|constraint/i);
  await assert.rejects(db.run("INSERT INTO actions (id,organization_id,lead_id,type,status,payload_json,idempotency_key,created_at,updated_at,workflow_run_id,sequence_step_id) VALUES ('duplicate-action','org','lead','SEND_EMAIL','PLANNED','{}','duplicate-action',?,?,'ACTIVE','step')", [STAMP, STAMP]), /unique|constraint/i);
  for (const patch of ["revision=-1", "processing_version=2"]) await assert.rejects(db.run("UPDATE workflow_runs SET " + patch + " WHERE id='ACTIVE'"), /check|constraint/i);
}
test("0007 constrains managed ownership, stage/review identity, scheduler cursors and typed action links", async (t) => constraints(await sqlite(t)));

test("0007 expansion and migration marker failure roll back schema and legacy holds together", async (t) => {
  const db = await sqlite(t); await seed(db); const before = await snapshot(db);
  await assert.rejects(runMigrations(db, { migrations: [...PREVIOUS, { id: migration.id, async up(tx) { await migration.up(tx); throw new Error("synthetic interrupted upgrade"); } }] }), /synthetic interrupted/);
  await preserve(db, before);
  assert.equal(await db.columnExists("domain_events", "processing_version"), false);
  assert.equal(await db.columnExists("scheduler_state", "id"), false);
  assert.equal(await db.columnExists("workflow_runs", "revision"), false);
  assert.deepEqual((await getMigrationStatus(db, { migrations: CURRENT })).pending, [migration.id]);
  await db.exec("CREATE TRIGGER reject_scheduler_marker BEFORE INSERT ON schema_migrations WHEN NEW.id='0007_scheduler_event_recovery' BEGIN SELECT RAISE(ABORT,'synthetic marker failure'); END");
  await assert.rejects(runMigrations(db, { migrations: CURRENT }), /synthetic marker failure/);
  await preserve(db, before);
  assert.equal(await db.columnExists("actions", "workflow_run_id"), false);
  await db.exec("DROP TRIGGER reject_scheduler_marker");
  assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), [migration.id]);
});

test("0007 competing migrations seed one persistent scheduler and never replay legacy events on restart", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lead-scheduler-migration-")); cleanup(t, () => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "disposable.sqlite"), first = await sqlite(t, file), second = await sqlite(t, file);
  await seed(first);
  const applied = await Promise.all([runMigrations(first, { migrations: CURRENT }), runMigrations(second, { migrations: CURRENT })]);
  assert.deepEqual(applied.flat(), [migration.id]);
  await first.close(); await second.close();
  const reopened = await sqlite(t, file);
  assert.equal((await reopened.get("SELECT COUNT(*) AS n FROM scheduler_state")).n, 1);
  assert.equal((await reopened.get("SELECT COUNT(*) AS n FROM domain_event_stages")).n, 0);
  assert.equal((await reopened.get("SELECT COUNT(*) AS n FROM domain_events WHERE processing_version=1")).n, 0);
  assert.deepEqual(await runMigrations(reopened, { migrations: CURRENT }), []);
});

const context = postgresTestContext();
const pgSkip = context ? false : "Requires explicit disposable PostgreSQL runner";
async function postgres(t) {
  const schema = schemaFor(context.runId, "adapter"), admin = await connectTestAdmin(context);
  try { await admin.exec('CREATE SCHEMA "' + schema + '"'); } finally { await admin.close(); }
  cleanup(t, async () => { const admin = await connectTestAdmin(context); try { await admin.exec('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'); } finally { await admin.close(); } });
  const db = await openDatabaseClient(schemaDatabaseConfig(context, schema)); cleanup(t, () => db.close()); return db;
}
for (const [name, check] of [["populated legacy preservation", upgrade], ["managed and scheduler constraints", constraints]]) {
  test("postgres 0007: " + name, { skip: pgSkip }, async (t) => check(await postgres(t)));
}
