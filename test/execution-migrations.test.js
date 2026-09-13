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
import * as recoveryMigration from "../src/database/migrations/0005_bounded_dispatch_recovery.js";
import { ActionsRepository } from "../src/modules/outbound-automation/actionsRepository.js";
import { ExecutionsRepository } from "../src/modules/outbound-automation/executionsRepository.js";
import { ContactPolicyService } from "../src/modules/contact-policy/contactPolicyService.js";
import { connectTestAdmin, postgresTestContext, safeTestEnvironment, schemaDatabaseConfig, schemaFor } from "../scripts/helpers/testSafety.js";

const PREVIOUS = MIGRATIONS.filter((migration) => migration.id < recoveryMigration.id);
const CURRENT = [...PREVIOUS, recoveryMigration];
const STAMP = "2026-09-11T10:00:00.000Z";
const cleanups = new WeakMap();
function cleanup(t, work) {
  if (!cleanups.has(t)) {
    cleanups.set(t, []);
    t.after(async () => { for (const task of cleanups.get(t).toReversed()) await task(); });
  }
  cleanups.get(t).push(work);
}
async function sqlite(t, file = ":memory:") {
  const db = new SqliteDatabaseClient(file);
  cleanup(t, () => db.close());
  return db;
}
async function tempfile(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lead-execution-upgrade-"));
  cleanup(t, () => rm(directory, { recursive: true, force: true }));
  return path.join(directory, "disposable.sqlite");
}
async function seed(db) {
  await runMigrations(db, { migrations: PREVIOUS });
  await db.run("INSERT INTO organizations (id,name,created_at) VALUES ('org','Upgrade fixture',?)", [STAMP]);
  await db.run("INSERT INTO leads (id,organization_id,name,email,source,status,created_at,updated_at) VALUES ('lead','org','Existing lead','lead@example.test','MANUAL','NEW',?,?)", [STAMP, STAMP]);
}
async function action(db, id, status = "APPROVED") {
  await db.run("INSERT INTO actions (id,organization_id,lead_id,type,status,payload_json,idempotency_key,created_at,updated_at) VALUES (?,'org','lead','SEND_EMAIL',?,'{}',?,?,?)",
    [id, status, id, STAMP, STAMP]);
}
async function attempt(db, actionId, number = 1, status = "STARTED", reference = null, suffix = String(number)) {
  const id = actionId + ":execution:" + suffix;
  await db.run("INSERT INTO action_executions (id,action_id,status,attempt,provider,provider_reference,idempotency_key,error,started_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [id, actionId, status, number, "email-resend", reference, id, status === "FAILED" ? "Historical unclassified error" : null, STAMP, status === "STARTED" ? null : STAMP]);
  return id;
}
async function assertPreserved(db, table, before) {
  const after = await db.all("SELECT * FROM " + table + " ORDER BY id");
  assert.equal(after.length, before.length);
  for (let index = 0; index < before.length; index++) {
    for (const [column, value] of Object.entries(before[index])) assert.deepEqual(after[index][column], value, table + "." + column);
  }
}
async function populatedUpgrade(db) {
  await seed(db);
  for (const [id, status, executionStatus, reference] of [
    ["unattempted", "APPROVED"], ["waiting", "AWAITING_APPROVAL"],
    ["retry-no-attempt", "RETRYING"], ["inflight-no-attempt", "EXECUTING"],
    ["started-empty", "EXECUTING", "STARTED"], ["started-reference", "EXECUTING", "STARTED", "old-provider-reference"],
    ["retry", "RETRYING", "FAILED"], ["approved-after-failure", "APPROVED", "FAILED"],
    ["waiting-after-failure", "AWAITING_APPROVAL", "FAILED"], ["planned-after-complete", "PLANNED", "COMPLETED"],
    ["completed", "COMPLETED", "COMPLETED", "delivered-reference"], ["blocked", "BLOCKED", "FAILED"]
  ]) {
    await action(db, id, status);
    if (executionStatus) await attempt(db, id, 1, executionStatus, reference || null);
  }
  // A pre-existing reviewed envelope remains byte-for-byte historical evidence.
  await db.run("INSERT INTO action_revisions (id,organization_id,action_id,revision,envelope_json,content_hash,sender_config_fingerprint,context_fingerprint,created_at) VALUES ('revision','org','unattempted',1,?,'hash','sender','context',?)", [JSON.stringify({ body: "Reviewed copy" }), STAMP]);
  await db.run("UPDATE actions SET current_revision_id='revision' WHERE id='unattempted'");
  const oldActions = await db.all("SELECT * FROM actions ORDER BY id");
  const oldAttempts = await db.all("SELECT * FROM action_executions ORDER BY id");
  const oldRevisions = await db.all("SELECT * FROM action_revisions ORDER BY id");
  assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), [recoveryMigration.id]);
  await assertPreserved(db, "actions", oldActions);
  await assertPreserved(db, "action_executions", oldAttempts);
  await assertPreserved(db, "action_revisions", oldRevisions);
  const held = await db.all("SELECT id FROM actions WHERE execution_hold_reason = 'LEGACY_OUTCOME_REVIEW_REQUIRED' ORDER BY id");
  assert.deepEqual(held.map((row) => row.id), ["approved-after-failure", "inflight-no-attempt", "planned-after-complete", "retry", "retry-no-attempt", "started-empty", "started-reference", "waiting-after-failure"]);
  for (const row of await db.all("SELECT * FROM actions")) {
    assert.equal(row.max_attempts, 3);
    assert.equal(row.execution_fence, 0);
    for (const column of ["first_dispatch_at", "retry_deadline_at", "next_attempt_at", "active_execution_id"]) assert.equal(row[column], null);
  }
  for (const row of await db.all("SELECT * FROM action_executions")) {
    assert.equal(row.outcome_class, "LEGACY_UNKNOWN");
    for (const column of ["action_revision_id", "envelope_hash", "provider_intent_key", "provider_key_expires_at", "lease_owner", "fence_token", "lease_expires_at", "dispatch_authorized_at", "outcome_at"]) assert.equal(row[column], null);
  }
  assert.equal((await db.all("SELECT * FROM dispatch_resolutions")).length, 0);
  assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), []);
}

test("0005 upgrades populated 0004 without inventing ownership, approval, acceptance or retry eligibility", async (t) => {
  await populatedUpgrade(await sqlite(t));
});

test("0005 refuses conflicting or invalid legacy attempts without DDL, marker, renumbering or deletion", async (t) => {
  for (const invalid of [0, -1, 1.5, "not-a-number", "duplicate"]) {
    const db = await sqlite(t);
    await seed(db); await action(db, "historical");
    await attempt(db, "historical", invalid === "duplicate" ? 1 : invalid);
    if (invalid === "duplicate") await attempt(db, "historical", 1, "STARTED", null, "other");
    const before = await db.all("SELECT * FROM action_executions ORDER BY id");
    await assert.rejects(runMigrations(db, { migrations: CURRENT }), {
      code: "MIGRATION_EXECUTION_REVIEW_REQUIRED",
      message: "Historical execution numbering requires reviewed offline remediation before this upgrade."
    });
    assert.equal(await db.columnExists("actions", "execution_hold_reason"), false);
    assert.equal(await db.columnExists("dispatch_resolutions", "id"), false);
    assert.deepEqual((await getMigrationStatus(db, { migrations: CURRENT })).pending, [recoveryMigration.id]);
    await assertPreserved(db, "action_executions", before);
  }
});

test("0005 interruption rolls back its DDL, holds and marker together", async (t) => {
  const db = await sqlite(t);
  await seed(db); await action(db, "inflight", "EXECUTING"); await attempt(db, "inflight");
  const before = await db.all("SELECT * FROM actions ORDER BY id");
  await assert.rejects(runMigrations(db, { migrations: [...PREVIOUS, {
    id: recoveryMigration.id,
    async up(tx) { await recoveryMigration.up(tx); throw new Error("interrupt after legacy backfill"); }
  }] }), /interrupt after legacy backfill/);
  assert.equal(await db.columnExists("actions", "execution_hold_reason"), false);
  assert.equal(await db.columnExists("dispatch_resolutions", "id"), false);
  await assertPreserved(db, "actions", before);
  assert.deepEqual(await runMigrations(db, { migrations: CURRENT }), [recoveryMigration.id]);
  assert.equal((await db.get("SELECT execution_hold_reason FROM actions WHERE id='inflight'")).execution_hold_reason, "LEGACY_OUTCOME_REVIEW_REQUIRED");
});

async function constraints(db) {
  await seed(db); await action(db, "one"); await action(db, "two");
  await runMigrations(db, { migrations: CURRENT });
  const executions = new ExecutionsRepository(db);
  const first = await executions.createExecution({ action_id: "one", status: "STARTED", attempt: 1, provider: "sandbox", idempotency_key: "first", fence_token: 1 });
  for (const sql of [
    "UPDATE actions SET max_attempts = 0 WHERE id='one'", "UPDATE actions SET max_attempts = 101 WHERE id='one'",
    "UPDATE actions SET execution_fence = -1 WHERE id='one'", "UPDATE action_executions SET fence_token = 0 WHERE id='" + first.id + "'",
    "UPDATE action_executions SET outcome_class = 'ASSUMED_SAFE' WHERE id='" + first.id + "'"
  ]) await assert.rejects(db.run(sql), /check|constraint/i);
  await assert.rejects(executions.createExecution({ action_id: "one", status: "STARTED", attempt: 1, provider: "sandbox", idempotency_key: "duplicate-attempt" }), /unique|constraint/i);
  await assert.rejects(executions.createExecution({ action_id: "one", status: "STARTED", attempt: 2, provider: "sandbox", idempotency_key: "duplicate-fence", fence_token: 1 }), /unique|constraint/i);
  await executions.createExecution({ action_id: "one", status: "STARTED", attempt: 2, provider: "sandbox", idempotency_key: "second", fence_token: 2 });
  assert.equal(await executions.countForAction("one"), 2, "distinct historical STARTED records must remain representable");
  await executions.createExecution({ action_id: "two", status: "STARTED", attempt: 1, provider: "sandbox", idempotency_key: "other-action", fence_token: 1 });
  await assert.rejects(db.run("INSERT INTO dispatch_resolutions (id,organization_id,action_id,action_execution_id,decision,evidence_note,reviewer_user_id,created_at) VALUES ('bad','org','one',?,'ACCEPTED','Checked evidence','reviewer',?)", [first.id, STAMP]), /check|constraint/i);
  await db.run("INSERT INTO dispatch_resolutions (id,organization_id,action_id,action_execution_id,fence_token,decision,evidence_note,provider_reference,reviewer_user_id,created_at) VALUES ('resolution','org','one',?,1,'ACCEPTED','Provider evidence','reference','reviewer',?)", [first.id, STAMP]);
  await assert.rejects(db.run("INSERT INTO dispatch_resolutions (id,organization_id,action_id,action_execution_id,decision,evidence_note,reviewer_user_id,created_at) VALUES ('duplicate','org','one',?,'CLOSE_WITHOUT_RETRY','Close safely','reviewer',?)", [first.id, STAMP]), /unique|constraint/i);
}

test("0005 constraints reject invalid policy, duplicate attempts/fences and conflicting resolutions", async (t) => {
  await constraints(await sqlite(t));
});

test("0005 competing file migrators apply the recovery expansion once", async (t) => {
  const file = await tempfile(t);
  const first = await sqlite(t, file); const second = await sqlite(t, file);
  await seed(first); await action(first, "inflight", "EXECUTING"); await attempt(first, "inflight");
  let applied = 0;
  const migrations = [...PREVIOUS, { id: recoveryMigration.id, async up(tx) { applied++; await recoveryMigration.up(tx); } }];
  const results = await Promise.all([runMigrations(first, { migrations }), runMigrations(second, { migrations })]);
  assert.equal(applied, 1);
  assert.deepEqual(results.flat(), [recoveryMigration.id]);
  assert.equal((await second.get("SELECT execution_hold_reason FROM actions WHERE id='inflight'")).execution_hold_reason, "LEGACY_OUTCOME_REVIEW_REQUIRED");
});

test("0005 upgrade survives restart without resetting holds, retry budget or first-use deadline", async (t) => {
  const file = await tempfile(t);
  const first = await sqlite(t, file);
  await seed(first); await action(first, "retry", "RETRYING"); await attempt(first, "retry", 1, "FAILED");
  await runMigrations(first, { migrations: CURRENT });
  await first.run("UPDATE actions SET max_attempts=2, first_dispatch_at=?, retry_deadline_at=?, next_attempt_at=?, execution_fence=4 WHERE id='retry'",
    [STAMP, "2026-09-11T11:00:00.000Z", "2026-09-11T10:01:00.000Z"]);
  const before = await first.get("SELECT * FROM actions WHERE id='retry'");
  await first.close();
  const second = await sqlite(t, file);
  assert.deepEqual(await runMigrations(second, { migrations: CURRENT }), []);
  assert.deepEqual(await second.get("SELECT * FROM actions WHERE id='retry'"), before);
  // The historical upgrade assertions above remain pinned to 0005; runtime uses the current schema.
  await runMigrations(second);
  assert.deepEqual(await new ActionsRepository(second).nextExecutable(25, "org", "2026-09-12T00:00:00.000Z"), []);
});

test("0005 process exit after backfill leaves no partial expansion or marker", async (t) => {
  const file = await tempfile(t);
  const first = await sqlite(t, file);
  await seed(first); await action(first, "inflight", "EXECUTING"); await attempt(first, "inflight");
  await first.close();
  const moduleUrl = (relative) => pathToFileURL(path.resolve(relative)).href;
  const code = [
    "import {SqliteDatabaseClient} from " + JSON.stringify(moduleUrl("src/database/sqliteClient.js")) + ";",
    "import {runMigrations} from " + JSON.stringify(moduleUrl("src/database/migrate.js")) + ";",
    "import {MIGRATIONS} from " + JSON.stringify(moduleUrl("src/database/migrations/index.js")) + ";",
    "const db=new SqliteDatabaseClient(" + JSON.stringify(file) + ");",
    "await runMigrations(db,{migrations:MIGRATIONS.map(m=>m.id==='0005_bounded_dispatch_recovery'?{id:m.id,async up(tx){await m.up(tx);process.exit(17);}}:m)});"
  ].join("\n");
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], { env: safeTestEnvironment(), stdio: "ignore", windowsHide: true });
    child.once("error", reject); child.once("exit", resolve);
  });
  assert.equal(exitCode, 17);
  const reopened = await sqlite(t, file);
  assert.equal(await reopened.columnExists("actions", "execution_hold_reason"), false);
  assert.deepEqual((await getMigrationStatus(reopened, { migrations: CURRENT })).pending, [recoveryMigration.id]);
  assert.equal((await reopened.get("SELECT status FROM actions WHERE id='inflight'")).status, "EXECUTING");
  assert.deepEqual(await runMigrations(reopened, { migrations: CURRENT }), [recoveryMigration.id]);
});

async function dueCandidates(db) {
  await seed(db); await runMigrations(db, { migrations: CURRENT });
  // Candidate behavior belongs to the current repository, after the historical 0005 upgrade.
  await runMigrations(db);
  const repo = new ActionsRepository(db);
  const ids = ["due", "future", "retry-future", "held", "invalid-format", "invalid-calendar", "valid-leap", "invalid-hour", "invalid-next"];
  for (const id of ids) await action(db, id);
  await db.run("UPDATE actions SET scheduled_at=? WHERE id='future'", ["2026-09-11T10:00:00.001Z"]);
  await db.run("UPDATE actions SET next_attempt_at=? WHERE id='retry-future'", ["2026-09-11T10:00:01.000Z"]);
  await db.run("UPDATE actions SET execution_hold_reason='LEGACY_OUTCOME_REVIEW_REQUIRED' WHERE id='held'");
  for (const [id, value] of [["invalid-format", "zzz"], ["invalid-calendar", "9999-02-29T10:00:00.000Z"], ["valid-leap", "2028-02-29T10:00:00.000Z"], ["invalid-hour", "9999-01-01T24:00:00.000Z"]]) {
    await db.run("UPDATE actions SET scheduled_at=? WHERE id=?", [value, id]);
  }
  await db.run("UPDATE actions SET next_attempt_at='9999-13-01T10:00:00.000Z' WHERE id='invalid-next'");
  assert.deepEqual((await repo.nextExecutable(25, "org", STAMP)).map((row) => row.id), ["due", "invalid-calendar", "invalid-format", "invalid-hour", "invalid-next"]);
  assert.deepEqual(await repo.nextExecutable(25, "foreign", STAMP), []);
  await assert.rejects(repo.nextExecutable(25, "org", "invalid-now"), /canonical UTC/);
  const later = await repo.nextExecutable(25, "org", "2026-09-11T10:00:01.000Z");
  assert.equal(later.some((row) => row.id === "future"), true);
  assert.equal(later.some((row) => row.id === "retry-future"), true);
}

test("due candidates exclude valid future/held work and expose malformed timestamps for an executor hold", async (t) => {
  await dueCandidates(await sqlite(t));
});


test("exact repository mutations require the owning workspace gate and preserve other attempts and provider references", async (t) => {
  const db = await sqlite(t); await seed(db); await runMigrations(db, { migrations: CURRENT });
  await action(db, "action");
  await db.run("INSERT INTO organizations (id,name,created_at) VALUES ('foreign','Other workspace',?)", [STAMP]);
  const repository = new ExecutionsRepository(db);
  const first = await repository.createExecution({ action_id: "action", status: "STARTED", attempt: 1, provider: "email-sendgrid", provider_reference: "http-reference-1", idempotency_key: "execution-one", fence_token: 1 });
  const second = await repository.createExecution({ action_id: "action", status: "STARTED", attempt: 2, provider: "email-sendgrid", provider_reference: "http-reference-2", idempotency_key: "execution-two", fence_token: 2 });
  assert.equal(await repository.getExecutionForOrganization(first.id, "foreign"), undefined);
  assert.equal((await repository.listByProviderReference("org", "email-sendgrid", "http-reference-1"))[0].id, first.id);
  assert.deepEqual(await repository.listByProviderReference("foreign", "email-sendgrid", "http-reference-1"), []);
  await assert.rejects(repository.markExecutionCompleted(first.id), /workspace transaction gate/);
  const policy = new ContactPolicyService(db);
  await assert.rejects(policy.withWorkspacePolicyTransaction("foreign", (tx) => new ExecutionsRepository(tx).markExecutionCompleted(first.id)), /workspace transaction gate/);
  await assert.rejects(policy.withWorkspacePolicyTransaction("org", (tx) => new ExecutionsRepository(tx).markCompleted("action")), /exact execution identity/);
  await policy.withWorkspacePolicyTransaction("org", async (tx) => {
    const scoped = new ExecutionsRepository(tx);
    await scoped.markExecutionCompleted(first.id, { providerReference: "webhook-message-id", completedAt: STAMP });
    await scoped.markExecutionFailed(first.id, { error: "Late contradictory failure", completedAt: STAMP });
  });
  const delivered = await repository.getExecution(first.id);
  assert.equal(delivered.outcome_class, "DELIVERED");
  assert.equal(delivered.status, "COMPLETED");
  assert.equal(delivered.provider_reference, "http-reference-1");
  assert.equal((await repository.getExecution(second.id)).status, "STARTED", "older callback cannot mutate the later attempt");
  await db.run("UPDATE action_executions SET outcome_class='CLOSED_UNRESOLVED' WHERE id=?", [second.id]);
  await policy.withWorkspacePolicyTransaction("org", async (tx) => {
    const scoped = new ExecutionsRepository(tx);
    await scoped.markExecutionCompleted(second.id); await scoped.markExecutionFailed(second.id);
  });
  assert.equal((await repository.getExecution(second.id)).outcome_class, "CLOSED_UNRESOLVED");
  await assert.rejects(repository.createExecution({ action_id: "action", status: "STARTED", attempt: 1, provider: "email-sendgrid", idempotency_key: "execution-one", fence_token: 7 }), /different attempt/);
});

const pgContext = postgresTestContext();
const pgSkip = pgContext ? false : "Requires the explicit disposable PostgreSQL test runner";
async function postgres(t) {
  const schema = schemaFor(pgContext.runId, "adapter");
  const admin = await connectTestAdmin(pgContext);
  try { await admin.exec('CREATE SCHEMA "' + schema + '"'); } finally { await admin.close(); }
  cleanup(t, async () => {
    const admin = await connectTestAdmin(pgContext);
    try { await admin.exec('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'); } finally { await admin.close(); }
  });
  const config = schemaDatabaseConfig(pgContext, schema);
  const db = await openDatabaseClient(config);
  cleanup(t, () => db.close());
  return { db, config };
}

test("postgres 0005: populated upgrade preserves history and imposes conservative legacy holds", { skip: pgSkip }, async (t) => {
  await populatedUpgrade((await postgres(t)).db);
});

test("postgres 0005: constraints preserve distinct attempts while refusing collisions", { skip: pgSkip }, async (t) => {
  await constraints((await postgres(t)).db);
});

test("postgres 0005: due SQL excludes canonical future times and safely surfaces malformed input", { skip: pgSkip }, async (t) => {
  await dueCandidates((await postgres(t)).db);
});

test("postgres 0005: concurrent deploys apply once and failed backfill transaction rolls back", { skip: pgSkip }, async (t) => {
  const { db, config } = await postgres(t);
  await seed(db); await action(db, "inflight", "EXECUTING"); await attempt(db, "inflight");
  await assert.rejects(runMigrations(db, { migrations: [...PREVIOUS, {
    id: recoveryMigration.id, async up(tx) { await recoveryMigration.up(tx); throw new Error("interrupted recovery migration"); }
  }] }), /interrupted recovery migration/);
  assert.equal(await db.columnExists("actions", "execution_hold_reason"), false);
  const other = await openDatabaseClient(config); cleanup(t, () => other.close());
  let applied = 0;
  const migrations = [...PREVIOUS, { id: recoveryMigration.id, async up(tx) { applied++; await recoveryMigration.up(tx); } }];
  const result = await Promise.all([runMigrations(db, { migrations }), runMigrations(other, { migrations })]);
  assert.equal(applied, 1);
  assert.deepEqual(result.flat(), [recoveryMigration.id]);
});
