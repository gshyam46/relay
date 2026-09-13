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
import * as receiptMigration from "../src/database/migrations/0006_durable_webhook_receipts.js";
import { connectTestAdmin, postgresTestContext, schemaDatabaseConfig, schemaFor } from "../scripts/helpers/testSafety.js";

const PREVIOUS = MIGRATIONS.filter((migration) => migration.id < receiptMigration.id);
const CURRENT = [...PREVIOUS, receiptMigration];
const STAMP = "2026-09-11T10:00:00.000Z";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const cleanups = new WeakMap();
function cleanup(t, task) {
  if (!cleanups.has(t)) {
    cleanups.set(t, []);
    t.after(async () => { for (const work of cleanups.get(t).toReversed()) await work(); });
  }
  cleanups.get(t).push(task);
}
async function sqlite(t, file = ":memory:") {
  const db = new SqliteDatabaseClient(file); cleanup(t, () => db.close()); return db;
}
async function temporaryFile(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lead-webhook-upgrade-"));
  cleanup(t, () => rm(directory, { recursive: true, force: true }));
  return path.join(directory, "disposable.sqlite");
}
async function seed(db) {
  await runMigrations(db, { migrations: PREVIOUS });
  await db.run("INSERT INTO organizations (id,name,created_at) VALUES ('org','Receipt upgrade fixture',?)", [STAMP]);
  await db.run("INSERT INTO organizations (id,name,created_at) VALUES ('foreign','Independent workspace',?)", [STAMP]);
  await db.run("INSERT INTO leads (id,organization_id,name,email,source,status,created_at,updated_at) VALUES ('lead','org','Existing lead','fixture@example.test','MANUAL','OPTED_OUT',?,?)", [STAMP, STAMP]);
  await db.run("INSERT INTO actions (id,organization_id,lead_id,type,status,payload_json,idempotency_key,created_at,updated_at) VALUES ('action','org','lead','SEND_EMAIL','COMPLETED','{}','action',?,?)", [STAMP, STAMP]);
  await db.run("INSERT INTO action_executions (id,action_id,status,attempt,provider,provider_reference,idempotency_key,started_at,completed_at,outcome_class) VALUES ('execution','action','COMPLETED',1,'email-sendgrid','http-reference','execution',?,?,'DELIVERED')", [STAMP, STAMP]);
  for (const [id, status, body, organization] of [
    ["completed", "COMPLETED", JSON.stringify({ provider: "sendgrid", revision_id: "old-revision" }), "org"],
    ["partial", "RECEIVED", JSON.stringify({ details: "Ancillary work might be incomplete" }), "org"],
    ["malformed", "FAILED", "not-json historical bytes", null]
  ]) {
    await db.run("INSERT INTO callbacks (id,organization_id,lead_id,action_id,action_execution_id,provider_event_id,status,provider_reference,payload_json,received_at) VALUES (?,?,'lead','action','execution',?,?,NULL,?,?)", [id, organization, "original-global:" + id, status, body, STAMP]);
  }
  for (const [id, type, body] of [["inbound-optout", "OPT_OUT", "unparseable original inbound bytes"], ["inbound-reply", "INTERESTED", JSON.stringify({ text: "Synthetic reply" })]]) {
    await db.run("INSERT INTO inbound_events (id,organization_id,lead_id,channel,provider,provider_event_id,event_type,payload_json,received_at,created_at) VALUES (?,'org','lead','EMAIL','sendgrid',?,?,?,?,?)", [id, id, type, body, STAMP, STAMP]);
  }
  await db.run("INSERT INTO audit_logs (id,organization_id,lead_id,action_id,event_type,message,metadata_json,created_at) VALUES ('audit','org','lead','action','ExecutionCallbackAncillaryFailed','Historical failure','{}',?)", [STAMP]);
}
async function snapshot(db) {
  const result = {};
  for (const table of ["callbacks", "inbound_events", "audit_logs", "actions", "action_executions", "leads"]) result[table] = await db.all("SELECT * FROM " + table + " ORDER BY id");
  return result;
}
async function preserve(db, before) {
  for (const [table, rows] of Object.entries(before)) {
    const after = await db.all("SELECT * FROM " + table + " ORDER BY id");
    assert.equal(after.length, rows.length);
    for (let index = 0; index < rows.length; index++) for (const [column, value] of Object.entries(rows[index])) assert.deepEqual(after[index][column], value, table + "." + column);
  }
}
async function upgrade(db) {
  await seed(db);
  const before = await snapshot(db);
  assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), [receiptMigration.id]);
  await preserve(db, before);
  for (const table of ["callbacks", "inbound_events"]) {
    for (const row of await db.all("SELECT * FROM " + table)) {
      assert.equal(row.webhook_receipt_id, null);
      assert.equal(row.effects_status, "LEGACY_UNKNOWN");
      assert.equal(row.effects_completed_at, null);
      if (table === "callbacks") { assert.equal(row.core_applied, null); assert.equal(row.action_applied, null); }
    }
  }
  assert.deepEqual(await db.all("SELECT * FROM webhook_receipts"), []);
  assert.deepEqual(await db.all("SELECT * FROM webhook_receipt_reviews"), []);
  assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), []);
}
async function receipt(db, id, overrides = {}) {
  const row = {
    id, organization_id: "org", provider: "sendgrid", connection_key: "channel_email", provider_event_id: id,
    event_kind: "SENDGRID_EVENT", normalized_input_json: JSON.stringify({ event: "delivered", fixture: true }),
    verification_kind: "SIGNED_PROVIDER", received_at: STAMP, updated_at: STAMP, ...overrides
  };
  row.payload_hash = overrides.payload_hash || hash(row.normalized_input_json || "purged");
  row.identity_hash = overrides.identity_hash || hash(JSON.stringify([row.organization_id, row.provider, row.connection_key, row.event_kind, row.provider_event_id]));
  await db.run("INSERT INTO webhook_receipts (" + Object.keys(row).join(",") + ") VALUES (" + Object.keys(row).map(() => "?").join(",") + ")", Object.values(row));
  return db.get("SELECT * FROM webhook_receipts WHERE id = ?", [id]);
}

test("0006 preserves populated 0005 domain history without fabricating receipts, completion or replay", async (t) => {
  await upgrade(await sqlite(t));
});

async function constraintChecks(db) {
  await seed(db); await runMigrations(db, { migrations: CURRENT });
  const row = await receipt(db, "receipt");
  assert.equal(row.processing_state, "RECEIVED"); assert.equal(row.mandatory_policy_status, "PENDING");
  assert.equal(row.max_attempts, 5); assert.equal(row.attempts, 0); assert.equal(row.processing_fence, 0);
  for (const column of ["first_processing_at", "retry_deadline_at", "next_attempt_at", "lease_owner", "lease_expires_at", "processed_at", "payload_purged_at"]) assert.equal(row[column], null);
  for (const patch of ["processing_state='LOST'", "mandatory_policy_status='IGNORED'", "attempts=-1", "max_attempts=0", "max_attempts=101", "processing_fence=-1", "normalization_version=0", "verification_kind='UNVERIFIED'", "payload_hash='not-a-hash'", "identity_hash='" + "Z".repeat(64) + "'", "event_kind='delivered'"]) {
    await assert.rejects(db.run("UPDATE webhook_receipts SET " + patch + " WHERE id='receipt'"), /check|constraint/i);
  }
  await db.run("UPDATE callbacks SET webhook_receipt_id='receipt',core_applied=1,action_applied=0,effects_status='PENDING' WHERE id='completed'");
  await assert.rejects(db.run("UPDATE callbacks SET webhook_receipt_id='receipt' WHERE id='partial'"), /unique|constraint/i);
  await assert.rejects(db.run("UPDATE callbacks SET core_applied=2 WHERE id='completed'"), /check|constraint/i);
  await assert.rejects(db.run("UPDATE callbacks SET webhook_receipt_id='missing' WHERE id='partial'"), /foreign|constraint/i);
  await db.run("UPDATE inbound_events SET webhook_receipt_id='receipt',effects_status='PENDING' WHERE id='inbound-reply'");
  await assert.rejects(db.run("UPDATE inbound_events SET webhook_receipt_id='receipt' WHERE id='inbound-optout'"), /unique|constraint/i);
  await assert.rejects(db.run("UPDATE inbound_events SET effects_status='SKIPPED' WHERE id='inbound-reply'"), /check|constraint/i);
  await db.run("INSERT INTO webhook_receipt_reviews (id,organization_id,receipt_id,expected_fence,decision,evidence_note,reviewer_user_id,created_at) VALUES ('review','org','receipt',0,'RETRY','Investigated transient failure','owner',?)", [STAMP]);
  await assert.rejects(db.run("INSERT INTO webhook_receipt_reviews (id,organization_id,receipt_id,expected_fence,decision,evidence_note,reviewer_user_id,created_at) VALUES ('conflict','org','receipt',0,'CLOSE','Different command','owner',?)", [STAMP]), /unique|constraint/i);
  for (const patch of ["decision='APPROVE'", "expected_fence=-1", "evidence_note=' '", "reviewer_user_id=' '"]) await assert.rejects(db.run("UPDATE webhook_receipt_reviews SET " + patch + " WHERE id='review'"), /check|constraint/i);
}

test("0006 enforces receipt policy, digest, projection link and exact-fence review constraints", async (t) => {
  await constraintChecks(await sqlite(t));
});

async function digestIdentity(db) {
  await seed(db); await runMigrations(db, { migrations: CURRENT });
  const providerId = "消".repeat(2048);
  const original = await receipt(db, "long", { provider_event_id: providerId });
  await assert.rejects(receipt(db, "same", { provider_event_id: providerId }), /unique|constraint/i);
  await receipt(db, "other-tenant", { organization_id: "foreign", provider_event_id: providerId });
  await receipt(db, "other-kind", { event_kind: "INBOUND_MESSAGE", provider_event_id: providerId });
  await receipt(db, "other-provider", { provider: "synthetic", provider_event_id: providerId });
  await receipt(db, "other-connection", { connection_key: "different-logical-account", provider_event_id: providerId });
  assert.equal((await db.get("SELECT COUNT(*) AS count FROM webhook_receipts")).count, 5);
  assert.equal(original.provider_event_id, providerId);
  assert.equal(original.identity_hash.length, 64);
}

test("0006 hashes long Unicode identity without coupling independent tenant/provider/ingress namespaces", async (t) => {
  await digestIdentity(await sqlite(t));
});

test("0006 payload tombstones keep identity and prohibit purging unresolved work", async (t) => {
  const db = await sqlite(t); await seed(db); await runMigrations(db, { migrations: CURRENT });
  const before = await receipt(db, "body");
  for (const state of ["RECEIVED", "PROCESSING", "RETRY_PENDING", "QUARANTINED"]) {
    await db.run("UPDATE webhook_receipts SET processing_state=? WHERE id='body'", [state]);
    await assert.rejects(db.run("UPDATE webhook_receipts SET normalized_input_json=NULL,payload_purged_at=? WHERE id='body'", [STAMP]), /check|constraint/i);
  }
  for (const state of ["PROCESSED", "DISMISSED"]) {
    const id = state.toLowerCase(); await receipt(db, id, { processing_state: state, mandatory_policy_status: "DONE" });
    await db.run("UPDATE webhook_receipts SET normalized_input_json=NULL,payload_purged_at=? WHERE id=?", [STAMP, id]);
    assert.equal((await db.get("SELECT normalized_input_json FROM webhook_receipts WHERE id=?", [id])).normalized_input_json, null);
  }
  assert.equal((await db.get("SELECT identity_hash FROM webhook_receipts WHERE id='body'")).identity_hash, before.identity_hash);
  assert.equal((await db.get("SELECT normalized_input_json FROM webhook_receipts WHERE id='body'")).normalized_input_json, before.normalized_input_json);
});

test("0006 failed expansion and marker leave all legacy columns/data recoverable", async (t) => {
  const db = await sqlite(t); await seed(db); const before = await snapshot(db);
  await assert.rejects(runMigrations(db, { migrations: [...PREVIOUS, { id: receiptMigration.id,
    async up(tx) { await receiptMigration.up(tx); throw new Error("Interrupted receipt migration"); }
  }] }), /Interrupted receipt migration/);
  assert.equal(await db.columnExists("callbacks", "effects_status"), false);
  assert.equal(await db.columnExists("webhook_receipts", "id"), false);
  await preserve(db, before);
  assert.deepEqual((await getMigrationStatus(db, { migrations: CURRENT })).pending, [receiptMigration.id]);
  await db.exec("CREATE TRIGGER reject_receipt_marker BEFORE INSERT ON schema_migrations WHEN NEW.id='0006_durable_webhook_receipts' BEGIN SELECT RAISE(ABORT,'synthetic marker failure'); END");
  await assert.rejects(runMigrations(db, { migrations: CURRENT }), /synthetic marker failure/);
  assert.equal(await db.columnExists("inbound_events", "effects_status"), false);
  await db.exec("DROP TRIGGER reject_receipt_marker");
  assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), [receiptMigration.id]);
});

test("0006 competing migrators and restart never enqueue unknown historical work", async (t) => {
  const file = await temporaryFile(t), first = await sqlite(t, file), second = await sqlite(t, file);
  await seed(first);
  let applied = 0;
  const migrations = [...PREVIOUS, { id: receiptMigration.id, async up(tx) { applied++; await receiptMigration.up(tx); } }];
  const results = await Promise.all([runMigrations(first, { migrations }), runMigrations(second, { migrations })]);
  assert.equal(applied, 1); assert.deepEqual(results.flat(), [receiptMigration.id]);
  await first.close(); await second.close();
  const reopened = await sqlite(t, file);
  assert.deepEqual(await runMigrations(reopened, { migrations: CURRENT }), []);
  assert.equal((await reopened.get("SELECT COUNT(*) AS count FROM webhook_receipts")).count, 0);
  assert.equal((await reopened.get("SELECT COUNT(*) AS count FROM callbacks WHERE effects_status='LEGACY_UNKNOWN' AND webhook_receipt_id IS NULL")).count, 3);
});

const pgContext = postgresTestContext();
const pgSkip = pgContext ? false : "Requires the explicit disposable PostgreSQL test runner";
async function postgres(t) {
  const schema = schemaFor(pgContext.runId, "adapter"), admin = await connectTestAdmin(pgContext);
  try { await admin.exec('CREATE SCHEMA "' + schema + '"'); } finally { await admin.close(); }
  cleanup(t, async () => { const admin = await connectTestAdmin(pgContext); try { await admin.exec('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'); } finally { await admin.close(); } });
  const db = await openDatabaseClient(schemaDatabaseConfig(pgContext, schema)); cleanup(t, () => db.close()); return db;
}
for (const [name, run] of [["populated legacy upgrade", upgrade], ["projection/counter/review constraints", constraintChecks], ["long UTF-8 digest identity", digestIdentity]]) {
  test("postgres 0006: " + name, { skip: pgSkip }, async (t) => { await run(await postgres(t)); });
}
