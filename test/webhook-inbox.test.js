import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createDatabase, openDatabaseClient } from "../src/database/database.js";
import { LeadsRepository } from "../src/modules/data-foundation/leadsRepository.js";
import { ContactPolicyService } from "../src/modules/contact-policy/contactPolicyService.js";
import { WebhookInboxService, assertReceiptOwnership, markReceiptProcessedInTransaction } from "../src/modules/webhook-inbox/webhookInboxService.js";

async function fixture(t, options = {}) {
  const db = await createDatabase(":memory:");
  t.after(() => db.close());
  const org = await new LeadsRepository(db).createOrganization({ name: "Inbox fixture" });
  const clock = { value: Date.parse("2026-09-11T10:00:00.000Z") };
  const policy = new ContactPolicyService(db);
  const service = new WebhookInboxService({ db, contactPolicyService: policy, now: () => clock.value, random: () => 1, ...options });
  const command = { organization_id: org.id, provider: "synthetic", connection_key: "application", event_kind: "EXECUTION_CALLBACK",
    provider_event_id: "event-1", verification_kind: "TRUSTED_INTERNAL", input: { event: "COMPLETED", body: "Original reviewed input" } };
  return { db, org, clock, policy, service, command };
}
function completeHandler(f, effect = async () => {}) {
  return async (input, { receipt }) => f.policy.withWorkspacePolicyTransaction(receipt.organization_id, async (tx) => {
    await assertReceiptOwnership(tx, receipt);
    await effect(tx, receipt, input);
    await tx.run("UPDATE webhook_receipts SET mandatory_policy_status='DONE' WHERE id=?", [receipt.id]);
    await markReceiptProcessedInTransaction(tx, receipt);
    return { repaired: true };
  });
}

test("receipt precedes processing and retries the original immutable input after storage failure", async (t) => {
  const f = await fixture(t);
  let attempts = 0, original;
  f.service.handlers.EXECUTION_CALLBACK = async (input, context) => {
    attempts++;
    original = input;
    assert.equal((await f.db.get("SELECT COUNT(*) AS n FROM webhook_receipts")).n, 1);
    if (attempts === 1) throw new Error("secret-key-and-contact-must-not-leak");
    return completeHandler(f)(input, context);
  };
  await assert.rejects(f.service.receiveAndProcess(f.command), (error) => error.code === "EVENT_PROCESSING_FAILED" && !error.message.includes("secret"));
  const first = await f.service.list({ organization_id: f.org.id });
  assert.equal(first.items[0].processing_state, "RETRY_PENDING");
  assert.equal(first.items[0].attempts, 1);
  assert.deepEqual(await f.service.processDue(), { items: [] });
  f.clock.value = Date.parse(first.items[0].next_attempt_at);
  assert.equal((await f.service.processDue()).items[0].processing_state, "PROCESSED");
  assert.deepEqual(original, f.command.input);
  assert.equal((await f.service.receiveAndProcess(f.command)).duplicate, true);
  assert.equal(attempts, 2);
  assert.doesNotMatch(JSON.stringify(await f.db.all("SELECT * FROM audit_logs")), /secret-key/);
});

test("changed replay retains original receipt and one visible conflict while tenant namespaces stay independent", async (t) => {
  const f = await fixture(t);
  f.service.handlers.EXECUTION_CALLBACK = completeHandler(f);
  const first = await f.service.receiveAndProcess(f.command);
  const conflicting = { ...f.command, input: { ...f.command.input, body: "Changed" } };
  await assert.rejects(f.service.receiveAndProcess(conflicting), { code: "RECEIPT_IDENTITY_CONFLICT" });
  await assert.rejects(f.service.receiveAndProcess(conflicting), { code: "RECEIPT_IDENTITY_CONFLICT" });
  assert.equal((await f.db.all("SELECT * FROM webhook_receipts")).length, 2);
  assert.equal((await f.service.list({ organization_id: f.org.id })).items[0].quarantined_reason, "RECEIPT_IDENTITY_CONFLICT");
  assert.equal((await f.service.inspect({ organization_id: f.org.id, receipt_id: first.receipt.id })).processing_state, "PROCESSED");
  const other = await new LeadsRepository(f.db).createOrganization({ name: "Other inbox" });
  assert.equal((await f.service.receiveAndProcess({ ...f.command, organization_id: other.id })).receipt.processing_state, "PROCESSED");
  await assert.rejects(f.service.inspect({ organization_id: other.id, receipt_id: first.receipt.id }), { statusCode: 404 });
});

test("simultaneous processing claims once; an expired old handler cannot write after a new owner finishes", async (t) => {
  const f = await fixture(t);
  let release, entered;
  const blocked = new Promise((r) => { release = r; });
  const ready = new Promise((r) => { entered = r; });
  let calls = 0;
  f.service.handlers.EXECUTION_CALLBACK = async (input, context) => {
    calls++;
    if (calls === 1) { entered(); await blocked; }
    return completeHandler(f)(input, context);
  };
  const active = f.service.receiveAndProcess(f.command);
  await ready;
  const duplicate = await f.service.receiveAndProcess(f.command);
  assert.equal(duplicate.receipt.processing_state, "PROCESSING");
  assert.equal(calls, 1);
  f.clock.value += 60001;
  const second = new WebhookInboxService({ db: f.db, contactPolicyService: f.policy, now: () => f.clock.value, handlers: f.service.handlers });
  assert.equal((await second.processDue()).items[0].processing_state, "PROCESSED");
  release();
  await assert.rejects(active, { code: "INBOX_CLAIM_LOST" });
  assert.equal(calls, 2);
  const row = await f.db.get("SELECT * FROM webhook_receipts");
  assert.equal(row.processing_state, "PROCESSED");
  assert.equal(row.attempts, 2);
  assert.equal(row.processing_fence, 2);
});

test("effect and processed marker roll back together when the final write fails", async (t) => {
  const f = await fixture(t);
  f.service.handlers.EXECUTION_CALLBACK = completeHandler(f, async (tx) => {
    await tx.run("UPDATE organizations SET name='Changed' WHERE id=?", [f.org.id]);
  });
  await f.db.exec("CREATE TRIGGER fail_finish BEFORE UPDATE OF processing_state ON webhook_receipts WHEN NEW.processing_state='PROCESSED' BEGIN SELECT RAISE(ABORT,'synthetic finish failure'); END;");
  await assert.rejects(f.service.receiveAndProcess(f.command));
  assert.equal((await f.db.get("SELECT name FROM organizations WHERE id=?", [f.org.id])).name, "Inbox fixture");
  const row = await f.db.get("SELECT * FROM webhook_receipts");
  assert.equal(row.mandatory_policy_status, "PENDING");
  assert.equal(row.processing_state, "RETRY_PENDING");
});

test("attempt exhaustion remains held and cannot be replenished through owner review", async (t) => {
  const f = await fixture(t, { policy: { maxAttempts: 2 } });
  f.service.handlers.EXECUTION_CALLBACK = async () => { throw new Error("storage unavailable"); };
  const first = await f.service.receiveAndProcess(f.command, { throwOnProcessingError: false });
  f.clock.value = Date.parse(first.receipt.next_attempt_at);
  const exhausted = (await f.service.processDue()).items[0];
  assert.equal(exhausted.processing_state, "QUARANTINED");
  assert.equal(exhausted.quarantined_reason, "PROCESSING_BUDGET_EXHAUSTED");
  assert.equal(exhausted.can_retry, false);
  const input = { organization_id: f.org.id, receipt_id: exhausted.id, expected_fence: exhausted.processing_fence,
    evidence_note: "Inspected synthetic failure.", reviewer_user_id: "reviewer" };
  await assert.rejects(f.service.review({ ...input, decision: "RETRY" }), { code: "RECEIPT_RETRY_UNAVAILABLE" });
  await assert.rejects(f.service.review({ ...input, decision: "CLOSE" }), { code: "POLICY_EFFECT_PENDING" });
  assert.equal((await f.db.get("SELECT COUNT(*) AS n FROM webhook_receipt_reviews")).n, 0);
});

test("owner review uses the displayed fence, is idempotent, preserves limits and never invokes a handler", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  f.service.handlers.EXECUTION_CALLBACK = async (_, { receipt }) => {
    calls++;
    await f.policy.withWorkspacePolicyTransaction(f.org.id, async (tx) => {
      await assertReceiptOwnership(tx, receipt);
      await tx.run("UPDATE webhook_receipts SET mandatory_policy_status='DONE' WHERE id=?", [receipt.id]);
    });
    throw Object.assign(new Error("missing record"), { statusCode: 404 });
  };
  const started = await f.service.receiveAndProcess(f.command, { throwOnProcessingError: false });
  const base = { organization_id: f.org.id, receipt_id: started.receipt.id, reviewer_user_id: "owner",
    expected_fence: started.receipt.processing_fence, evidence_note: "Inspected the missing source record." };
  await assert.rejects(f.service.review({ ...base, expected_fence: 99, decision: "RETRY" }), { code: "STALE_RECEIPT_REVIEW" });
  const retry = await f.service.review({ ...base, decision: "RETRY" });
  assert.equal(retry.attempts, 1);
  assert.equal(retry.processing_fence, base.expected_fence + 1);
  assert.equal((await f.service.review({ ...base, decision: "RETRY" })).duplicate, true);
  assert.equal(calls, 1);
  const closed = await f.service.review({ ...base, expected_fence: retry.processing_fence, decision: "CLOSE" });
  assert.equal(closed.processing_state, "DISMISSED");
  assert.equal((await f.service.list({ organization_id: f.org.id })).total, 0);
  assert.equal((await f.service.inspect({ organization_id: f.org.id, receipt_id: closed.id })).reviews.length, 2);
  assert.equal((await f.service.receiveAndProcess(f.command)).receipt.processing_state, "DISMISSED");
  assert.equal(calls, 1);
});

test("retention purges only terminal bodies and a purged tombstone still deduplicates", async (t) => {
  const f = await fixture(t);
  f.service.handlers.EXECUTION_CALLBACK = completeHandler(f);
  const completed = await f.service.receiveAndProcess(f.command);
  f.service.handlers.EXECUTION_CALLBACK = async () => { throw new Error("retain unresolved body"); };
  await f.service.receiveAndProcess({ ...f.command, provider_event_id: "pending" }, { throwOnProcessingError: false });
  f.clock.value += 31 * 86400000;
  assert.equal((await f.service.purgeProcessedPayloads()).purged, 1);
  const terminal = await f.db.get("SELECT * FROM webhook_receipts WHERE id=?", [completed.receipt.id]);
  assert.equal(terminal.normalized_input_json, null);
  assert.ok(terminal.payload_hash);
  assert.ok((await f.db.get("SELECT normalized_input_json FROM webhook_receipts WHERE provider_event_id='pending'")).normalized_input_json);
  assert.equal((await f.service.receiveAndProcess(f.command)).duplicate, true);
});

test("receipt payload limits and source validation refuse before persistence", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.service.receiveAndProcess({ ...f.command, event_kind: "SEND_EMAIL" }), { statusCode: 400 });
  await assert.rejects(f.service.receiveAndProcess({ ...f.command, input: { text: "x".repeat(256 * 1024) } }), { statusCode: 413 });
  await assert.rejects(f.service.receiveAndProcess({ ...f.command, verification_kind: "BODY_SAYS_AUTHENTICATED" }), { statusCode: 400 });
  assert.equal((await f.db.get("SELECT COUNT(*) AS n FROM webhook_receipts")).n, 0);
});

test("stop drains an admitted processor and refuses new receipt processing", async (t) => {
  const f = await fixture(t);
  let release, entered;
  const blocked = new Promise((r) => { release = r; });
  const ready = new Promise((r) => { entered = r; });
  f.service.handlers.EXECUTION_CALLBACK = async (input, context) => { entered(); await blocked; return completeHandler(f)(input, context); };
  const active = f.service.receiveAndProcess(f.command);
  await ready;
  f.service.stopAccepting();
  let drained = false;
  const drain = f.service.drain().then(() => { drained = true; });
  await assert.rejects(f.service.receiveAndProcess(f.command), { code: "INBOX_DRAINING" });
  assert.equal(drained, false);
  release();
  await active;
  await drain;
  assert.equal(drained, true);
});

test("persisted unprocessed receipt is recovered after database restart without provider redelivery", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lead-inbox-restart-"));
  const file = path.join(directory, "owned.sqlite");
  let db;
  try {
    db = await createDatabase(file);
    const org = await new LeadsRepository(db).createOrganization({ name: "Inbox restart" });
    let policy = new ContactPolicyService(db);
    let service = new WebhookInboxService({ db, contactPolicyService: policy });
    const command = { organization_id: org.id, provider: "synthetic", connection_key: "application", event_kind: "EXECUTION_CALLBACK",
      provider_event_id: "restart", verification_kind: "TRUSTED_INTERNAL", input: { event: "COMPLETED" } };
    const received = await service.receive(command);
    await db.close();
    db = await openDatabaseClient(file);
    policy = new ContactPolicyService(db);
    service = new WebhookInboxService({ db, contactPolicyService: policy });
    service.handlers.EXECUTION_CALLBACK = completeHandler({ policy });
    const result = await service.processDue();
    assert.equal(result.items[0].id, received.row.id);
    assert.equal(result.items[0].processing_state, "PROCESSED");
    assert.equal((await db.get("SELECT COUNT(*) AS n FROM webhook_receipts")).n, 1);
  } finally {
    if (db) await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an expired failing processor cannot quarantine its abandoned claim", async (t) => {
  const f = await fixture(t);
  f.service.handlers.EXECUTION_CALLBACK = async () => {
    f.clock.value += 60001;
    throw Object.assign(new Error("late malformed result"), { statusCode: 400 });
  };
  const first = await f.service.receiveAndProcess(f.command, { throwOnProcessingError: false });
  assert.equal(first.receipt.processing_state, "PROCESSING");
  assert.equal(first.receipt.quarantined_reason, null);
  f.service.handlers.EXECUTION_CALLBACK = completeHandler(f);
  const repaired = (await f.service.processDue()).items[0];
  assert.equal(repaired.processing_state, "PROCESSED");
  assert.equal(repaired.attempts, 2);
});
