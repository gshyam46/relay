import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDatabase, openDatabaseClient } from "../src/database/database.js";
import { EventsRepository } from "../src/modules/events/eventsRepository.js";
import { LeadsRepository } from "../src/modules/data-foundation/leadsRepository.js";
import { ContactPolicyService } from "../src/modules/contact-policy/contactPolicyService.js";
import { connectTestAdmin, postgresTestContext, schemaDatabaseConfig, schemaFor } from "../scripts/helpers/testSafety.js";

const START = Date.parse("2026-09-11T10:00:00.000Z");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const cleanups = new WeakMap();
function cleanup(t, work) {
  if (!cleanups.has(t)) { cleanups.set(t, []); t.after(async () => { for (const fn of cleanups.get(t).toReversed()) await fn(); }); }
  cleanups.get(t).push(work);
}
async function fixture(t, target = ":memory:") {
  const db = await createDatabase(target); cleanup(t, () => db.close());
  const leads = new LeadsRepository(db);
  const org = await leads.createOrganization({ name: "Scoped event fixture" });
  const foreign = await leads.createOrganization({ name: "Other workspace" });
  const lead = await leads.createLead({ organization_id: org.id, name: "Synthetic lead", email: "events@example.test" });
  return { db, org, foreign, lead, repo: new EventsRepository(db), gate: new ContactPolicyService(db), target };
}
function publish(f, payload = { reason: "Synthetic" }) {
  return f.repo.publish({ organization_id: f.org.id, lead_id: f.lead.id, type: "LeadCreated", payload });
}
function scoped(f, work, organizationId = f.org.id) {
  return f.gate.withWorkspacePolicyTransaction(organizationId, (tx) => work(new EventsRepository(tx), tx));
}
function claim(f, event, options = {}) {
  return scoped(f, (repo) => repo.claimInTransaction({ organization_id: f.org.id, event_id: event.id, owner: "worker-a", now: START, ...options }));
}

async function ownershipChecks(f) {
  const event = await publish(f), owned = await claim(f, event);
  assert.equal(owned.attempts, 1); assert.equal(owned.processing_fence, 1); assert.ok(Object.isFrozen(owned));
  assert.equal(owned.processing_version, 1); assert.equal(owned.payload_hash, hash(owned.payload_json));
  await assert.rejects(f.repo.markProcessed(event.id), { code: "EVENT_CLAIM_REQUIRED" });
  await assert.rejects(f.repo.markFailed(event.id, new Error("unsafe legacy write")), { code: "EVENT_CLAIM_REQUIRED" });
  await assert.rejects(scoped(f, (repo) => repo.finish({ ...owned }, START)), { code: "EVENT_CLAIM_REQUIRED" });
  const selected = await f.repo.getForOrganization(f.org.id, event.id);
  await assert.rejects(scoped(f, (repo) => repo.finish(selected, START)), { code: "EVENT_CLAIM_REQUIRED" });
  await assert.rejects(scoped(f, (repo) => repo.assertOwnership(owned, START), f.foreign.id), /matching workspace transaction/);
  await assert.rejects(f.repo.finish(owned, START), /matching workspace transaction/);
  const done = await scoped(f, async (repo) => {
    await repo.upsertStage(owned, { stage_key: "snapshot", input_fingerprint: hash("context"), status: "DONE", artifact_type: "snapshot", artifact_id: "synthetic-snapshot", now: START });
    return repo.finish(owned, START);
  });
  assert.equal(done.status, "PROCESSED"); assert.equal(done.attempts, 1);
  assert.equal(done.lease_owner, null); assert.equal(done.lease_expires_at, null);
  assert.equal((await f.repo.listStages(f.org.id, event.id)).length, 1);
  assert.deepEqual(await f.repo.listStages(f.foreign.id, event.id), []);
  assert.equal(await f.repo.getForOrganization(f.foreign.id, event.id), undefined);
}
test("managed event completion requires the exact scoped claim, never a copied row or bare event ID", async (t) => ownershipChecks(await fixture(t)));

test("simultaneous claim requests consume one attempt and one owner", async (t) => {
  const f = await fixture(t), event = await publish(f);
  const claims = await Promise.all([claim(f, event), claim(f, event, { owner: "worker-b" })]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal((await f.repo.getForOrganization(f.org.id, event.id)).attempts, 1);
  assert.equal(await scoped(f, (repo) => repo.claimInTransaction({ organization_id: f.foreign.id, event_id: event.id, owner: "foreign", now: START }), f.foreign.id), null);
});


async function independentClaims(t, f) {
  const second = await openDatabaseClient(f.target); cleanup(t, () => second.close());
  const secondGate = new ContactPolicyService(second), event = await publish(f);
  const results = await Promise.all([
    claim(f, event),
    secondGate.withWorkspacePolicyTransaction(f.org.id, (tx) => new EventsRepository(tx).claimInTransaction({
      organization_id: f.org.id, event_id: event.id, owner: "second-connection", now: START
    }))
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal((await new EventsRepository(second).getForOrganization(f.org.id, event.id)).attempts, 1);
  assert.equal((await f.repo.getForOrganization(f.org.id, event.id)).processing_fence, 1);
}
test("independent SQLite connections acquire one persisted event claim", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lead-event-claim-")); cleanup(t, () => rm(directory, { recursive: true, force: true }));
  await independentClaims(t, await fixture(t, path.join(directory, "disposable.sqlite")));
});

async function expiredChecks(f) {
  const event = await publish(f), first = await claim(f, event, { leaseMs: 100 });
  await assert.rejects(scoped(f, (repo) => repo.finish(first, START + 100)), { code: "EVENT_CLAIM_LOST" });
  const second = await claim(f, event, { owner: "worker-b", now: START + 100, leaseMs: 100 });
  assert.equal(second.attempts, 2); assert.equal(second.processing_fence, 2);
  await assert.rejects(scoped(f, (repo) => repo.upsertStage(first, { stage_key: "snapshot", input_fingerprint: hash("old"), status: "DONE", now: START + 101 })), { code: "EVENT_CLAIM_LOST" });
  await assert.rejects(scoped(f, (repo) => repo.fail(first, { now: START + 101, status: "QUARANTINED", error_code: "OLD_FAILURE" })), { code: "EVENT_CLAIM_LOST" });
  assert.equal((await scoped(f, (repo) => repo.finish(second, START + 101))).status, "PROCESSED");
}
test("expired event owner cannot commit a stage or failure after a new claim takes over", async (t) => expiredChecks(await fixture(t)));

test("stage, artifact and final cursor use one rollback boundary and changed context preserves cursor identity", async (t) => {
  const f = await fixture(t), event = await publish(f), owned = await claim(f, event);
  await assert.rejects(scoped(f, async (repo, tx) => {
    await tx.run("UPDATE organizations SET name='Partial effect' WHERE id=?", [f.org.id]);
    await repo.upsertStage(owned, { stage_key: "snapshot", input_fingerprint: hash("first"), status: "DONE", artifact_type: "snapshot", artifact_id: "first-version", now: START });
    await repo.finish(owned, START);
    throw new Error("synthetic final transaction failure");
  }), /synthetic final transaction/);
  assert.equal((await new LeadsRepository(f.db).getOrganization(f.org.id)).name, "Scoped event fixture");
  assert.deepEqual(await f.repo.listStages(f.org.id, event.id), []);
  assert.equal((await f.repo.getForOrganization(f.org.id, event.id)).status, "PROCESSING");
  const first = await scoped(f, (repo) => repo.upsertStage(owned, { stage_key: "snapshot", input_fingerprint: hash("first"), status: "DONE", artifact_type: "snapshot", artifact_id: "first-version", now: START }));
  const duplicate = await scoped(f, (repo) => repo.upsertStage(owned, { stage_key: "snapshot", input_fingerprint: hash("first"), status: "PREPARED", now: START + 1 }));
  assert.equal(duplicate.id, first.id); assert.equal(duplicate.status, "DONE"); assert.equal(duplicate.completed_at, first.completed_at);
  const changed = await scoped(f, (repo) => repo.upsertStage(owned, { stage_key: "snapshot", input_fingerprint: hash("changed"), status: "PREPARED", now: START + 2 }));
  assert.equal(changed.id, first.id); assert.equal(changed.status, "PREPARED"); assert.equal(changed.artifact_id, null);
  assert.equal((await f.repo.listStages(f.org.id, event.id)).length, 1);
});

test("retry schedule and frozen attempt/deadline limits survive restart and cannot be replenished", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lead-event-retry-")); cleanup(t, () => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "disposable.sqlite"), f = await fixture(t, file), event = await publish(f);
  const first = await claim(f, event, { maxAttempts: 2, retryWindowMs: 10000, leaseMs: 1000 });
  const waiting = await scoped(f, (repo) => repo.fail(first, { now: START + 1, next_attempt_at: START + 500, error_code: "MODEL_UNAVAILABLE" }));
  assert.equal(waiting.status, "RETRY_PENDING");
  assert.deepEqual(await f.repo.listDue({ organization_id: f.org.id, now: START + 499 }), []);
  await f.db.close();
  const reopened = await openDatabaseClient(file); cleanup(t, () => reopened.close());
  f.db = reopened; f.repo = new EventsRepository(reopened); f.gate = new ContactPolicyService(reopened);
  const second = await claim(f, event, { now: START + 500, maxAttempts: 100, retryWindowMs: 99999999, leaseMs: 1000 });
  assert.equal(second.max_attempts, 2); assert.equal(second.retry_deadline_at, first.retry_deadline_at); assert.equal(second.first_processing_at, first.first_processing_at);
  const exhausted = await scoped(f, (repo) => repo.fail(second, { now: START + 501, next_attempt_at: START + 999, error_code: "MODEL_UNAVAILABLE" }));
  assert.equal(exhausted.status, "QUARANTINED"); assert.equal(exhausted.last_error_code, "EVENT_BUDGET_EXHAUSTED");
  assert.equal(exhausted.attempts, 2);
  assert.deepEqual(await f.repo.listDue({ organization_id: f.org.id, now: START + 1000 }), []);
});

test("malformed future dates and immutable payload changes are quarantined once while legacy rows remain untouched", async (t) => {
  const f = await fixture(t), badDate = await publish(f), badPayload = await publish(f);
  await f.db.run("UPDATE domain_events SET next_attempt_at='9999-02-30T00:00:00.000Z' WHERE id=?", [badDate.id]);
  await f.db.run("UPDATE domain_events SET payload_json='changed bytes' WHERE id=?", [badPayload.id]);
  const stamp = new Date(START).toISOString();
  await f.db.run("INSERT INTO domain_events (id,organization_id,type,payload_json,status,attempts,created_at) VALUES ('legacy',?,'LeadCreated','legacy bytes','PENDING',0,?)", [f.org.id, stamp]);
  const due = await f.repo.listDue({ organization_id: f.org.id, now: START, limit: 10 });
  assert.deepEqual(new Set(due.map((row) => row.id)), new Set([badDate.id, badPayload.id]));
  assert.equal(await claim(f, badDate), null); assert.equal(await claim(f, badPayload), null);
  assert.equal((await f.repo.getForOrganization(f.org.id, badDate.id)).last_error_code, "INVALID_EVENT_TIME");
  assert.equal((await f.repo.getForOrganization(f.org.id, badPayload.id)).last_error_code, "INVALID_EVENT_PAYLOAD");
  assert.deepEqual(await f.repo.listDue({ organization_id: f.org.id, now: START }), []);
  assert.equal(await claim(f, { id: "legacy" }), null);
  const legacy = await f.repo.getForOrganization(f.org.id, "legacy");
  assert.equal(legacy.status, "PENDING"); assert.equal(legacy.attempts, 0); assert.equal(legacy.payload_json, "legacy bytes");
});

test("claimed payload cannot be changed after preparation even when another writer replaces its checksum", async (t) => {
  const f = await fixture(t), event = await publish(f), owned = await claim(f, event);
  const replacement = JSON.stringify({ reason: "Different command" });
  await f.db.run("UPDATE domain_events SET payload_json=?,payload_hash=? WHERE id=?", [replacement, hash(replacement), event.id]);
  await assert.rejects(scoped(f, (repo) => repo.finish(owned, START)), { code: "INVALID_EVENT_PAYLOAD" });
  assert.equal((await f.repo.getForOrganization(f.org.id, event.id)).status, "PROCESSING");
});

test("suppression stops WAITING_EXECUTION once, increments owner revision and preserves active execution facts", async (t) => {
  const f = await fixture(t), stamp = new Date(START).toISOString();
  await f.db.run("INSERT INTO campaigns (id,organization_id,name,status,created_at,updated_at) VALUES ('campaign',?,'Campaign','ACTIVE',?,?)", [f.org.id, stamp, stamp]);
  await f.db.run("INSERT INTO sequences (id,organization_id,campaign_id,name,status,created_at,updated_at) VALUES ('sequence',?,'campaign','Sequence','ACTIVE',?,?)", [f.org.id, stamp, stamp]);
  await f.db.run("INSERT INTO sequence_steps (id,organization_id,sequence_id,step_order,type,title,payload_json,created_at,updated_at) VALUES ('step',?,'sequence',0,'SEND_EMAIL','Step','{}',?,?)", [f.org.id, stamp, stamp]);
  await f.db.run("INSERT INTO workflow_runs (id,organization_id,campaign_id,sequence_id,lead_id,status,current_step_order,idempotency_key,created_at,updated_at,processing_version,revision,scheduler_hold_reason) VALUES ('run',?,'campaign','sequence',?,'WAITING_EXECUTION',0,'run',?,?,1,3,'PRESERVED_HOLD')", [f.org.id, f.lead.id, stamp, stamp]);
  await f.db.run("INSERT INTO actions (id,organization_id,lead_id,type,status,payload_json,idempotency_key,created_at,updated_at,workflow_run_id,sequence_step_id) VALUES ('action',?,?,'SEND_EMAIL','EXECUTING','{}','action',?,?,'run','step')", [f.org.id, f.lead.id, stamp, stamp]);
  await f.db.run("INSERT INTO action_executions (id,action_id,status,attempt,provider,idempotency_key,started_at,outcome_class) VALUES ('execution','action','STARTED',1,'synthetic','execution',?,'ACCEPTED')", [stamp]);
  const command = { organization_id: f.org.id, contact: { kind: "EMAIL", value: f.lead.email }, channel: "EMAIL", reason: "UNSUBSCRIBE", source: "PROVIDER_EVENT", source_event_id: "policy-stop" };
  await f.gate.restrictContact(command); await f.gate.restrictContact(command);
  const run = await f.db.get("SELECT * FROM workflow_runs WHERE id='run'");
  assert.equal(run.status, "STOPPED"); assert.equal(run.revision, 4); assert.equal(run.scheduler_hold_reason, "PRESERVED_HOLD");
  assert.equal((await f.db.get("SELECT * FROM actions WHERE id='action'")).status, "EXECUTING");
  assert.equal((await f.db.get("SELECT * FROM action_executions WHERE id='execution'")).outcome_class, "ACCEPTED");
});

const context = postgresTestContext(), pgSkip = context ? false : "Requires explicit disposable PostgreSQL runner";
async function postgres(t) {
  const schema = schemaFor(context.runId, "adapter"), admin = await connectTestAdmin(context);
  try { await admin.exec('CREATE SCHEMA "' + schema + '"'); } finally { await admin.close(); }
  cleanup(t, async () => { const admin = await connectTestAdmin(context); try { await admin.exec('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'); } finally { await admin.close(); } });
  return fixture(t, schemaDatabaseConfig(context, schema));
}
for (const [name, check] of [["exact claim authority", ownershipChecks], ["expired ownership takeover", expiredChecks]]) {
  test("postgres domain events: " + name, { skip: pgSkip }, async (t) => check(await postgres(t)));
}

test("postgres domain events: independent clients acquire one persisted claim", { skip: pgSkip }, async (t) => independentClaims(t, await postgres(t)));
