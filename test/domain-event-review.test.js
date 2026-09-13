import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database/database.js";
import { LeadsRepository } from "../src/modules/data-foundation/leadsRepository.js";
import { EventsRepository } from "../src/modules/events/eventsRepository.js";
import { ContactPolicyService } from "../src/modules/contact-policy/contactPolicyService.js";
import { createLeadEventHandlers } from "../src/modules/events/leadEventHandlers.js";
import { WebhookInboxService, assertReceiptOwnership } from "../src/modules/webhook-inbox/webhookInboxService.js";
import { DomainEventProcessor } from "../src/modules/events/domainEventProcessor.js";

function barrier() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

test("failure persistence rechecks current lease after waiting for the workspace gate", async (t) => {
  const db = await createDatabase(":memory:");
  t.after(() => db.close());
  const organization = await new LeadsRepository(db).createOrganization({ name: "Synthetic event expiry" });
  const events = new EventsRepository(db);
  const event = await events.publish({ organization_id: organization.id, type: "SyntheticReview", payload: { source: "preserve me" } });
  const gate = new ContactPolicyService(db), entered = barrier(), unblock = barrier();
  let now = Date.parse("2026-09-11T10:00:00.000Z"), gateCalls = 0;
  const processor = new DomainEventProcessor({ db, now: () => now, random: () => 0,
    contactPolicyService: {
      async withWorkspacePolicyTransaction(organizationId, work) {
        if (++gateCalls === 2) { entered.release(); await unblock.promise; }
        return gate.withWorkspacePolicyTransaction(organizationId, work);
      }
    },
    handlers: { SyntheticReview: async () => { throw new Error("Transient synthetic model failure"); } }
  });
  const processing = processor.processOne({ organization_id: organization.id, event_id: event.id });
  await entered.promise;
  now += 120001;
  unblock.release();
  const result = await processing;
  assert.equal(result.status, "PROCESSING", "an owner that expired while waiting cannot persist a retry or clear its reclaimable lease");
  const expired = await events.getForOrganization(organization.id, event.id);
  assert.equal(expired.payload_json, event.payload_json);
  assert.equal(expired.payload_hash, event.payload_hash);
  assert.equal(expired.attempts, 1);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM audit_logs WHERE event_type='LeadProcessingDeferred'")).n, 0);
  const replacement = new DomainEventProcessor({ db, now: () => now, handlers: { SyntheticReview: async () => {} } });
  const done = await replacement.processOne({ organization_id: organization.id, event_id: event.id });
  assert.equal(done.status, "PROCESSED");
  assert.equal(done.attempts, 2);
  assert.equal(done.processing_fence, 2);
});

test("inherited object properties are unsupported event types, never successful handlers", async (t) => {
  const db = await createDatabase(":memory:");
  t.after(() => db.close());
  const organization = await new LeadsRepository(db).createOrganization({ name: "Synthetic handler registry" });
  const events = new EventsRepository(db);
  const processor = new DomainEventProcessor({ db, handlers: {} });
  for (const type of ["toString", "constructor"]) {
    const event = await events.publish({ organization_id: organization.id, type, payload: { source: "keep original" } });
    const result = await processor.processOne({ organization_id: organization.id, event_id: event.id });
    assert.equal(result.status, "QUARANTINED", "only explicitly registered handler types can finish an event");
    assert.equal(result.last_error_code, "EVENT_UNSUPPORTED_TYPE");
    assert.equal(result.can_retry, false);
    const row = await events.getForOrganization(organization.id, event.id);
    assert.equal(row.payload_json, event.payload_json);
    assert.equal(row.payload_hash, event.payload_hash);
  }
});

async function policyFixture(t) {
  const db = await createDatabase(":memory:");
  t.after(() => db.close());
  const leads = new LeadsRepository(db), events = new EventsRepository(db), gate = new ContactPolicyService(db);
  const organization = await leads.createOrganization({ name: "Synthetic planning policy" });
  let now = Date.parse("2026-09-11T10:00:00.000Z");
  const processor = new DomainEventProcessor({ db, now: () => now, random: () => 0,
    handlers: createLeadEventHandlers({ getServices: () => ({}) }) });
  const eventFor = (lead, type) => events.publish({ organization_id: organization.id, lead_id: lead.id, type, payload: {} });
  const process = (event) => processor.processOne({ organization_id: organization.id, event_id: event.id });
  return { db, leads, events, gate, organization, processor, eventFor, process, now: () => now, advance(value) { now = value; } };
}

test("reimported shared identities retain intelligence but skip contact actions and reply recommendations", async (t) => {
  const f = await policyFixture(t);
  for (const scope of ["ALL", "EMAIL"]) {
    const email = scope.toLowerCase() + "@example.test";
    const original = await f.leads.createLead({ organization_id: f.organization.id, name: "Original", email, phone: "+14155550101" });
    if (scope === "ALL") {
      await f.gate.restrictLead({ organization_id: f.organization.id, lead_id: original.id,
        reason: "OPT_OUT", source: "INBOUND_EVENT", source_event_id: "original-opt-out", channel: "ALL" });
    } else {
      await f.gate.restrictContact({ organization_id: f.organization.id, contact: { kind: "EMAIL", value: email },
        reason: "UNSUBSCRIBE", source: "PROVIDER_EVENT", source_event_id: "provider-unsubscribe", channel: "EMAIL" });
    }
    const duplicate = await f.leads.createLead({ organization_id: f.organization.id, name: "Reimported duplicate", email, phone: "+14155550202" });
    assert.equal(duplicate.status, "NEW", "a duplicate has its own lifecycle, independent of the durable contact restriction");
    assert.equal((await f.gate.inspectLead({ organization_id: f.organization.id, lead_id: duplicate.id })).restricted, true);
    const created = await f.eventFor(duplicate, "LeadCreated");
    assert.equal((await f.process(created)).status, "PROCESSED");
    const createdStages = await f.events.listStages(f.organization.id, created.id);
    assert.equal(createdStages.find((s) => s.stage_key === "snapshot").status, "DONE");
    assert.equal(createdStages.find((s) => s.stage_key === "initial_action").status, "SKIPPED");
    assert.equal((await f.db.get("SELECT COUNT(*) AS n FROM actions WHERE lead_id=?", [duplicate.id])).n, 0);
    const reply = await f.eventFor(duplicate, "LeadReplyReceived");
    assert.equal((await f.process(reply)).status, "PROCESSED", "restricted processing must not require any model stage wiring");
    const replyStages = await f.events.listStages(f.organization.id, reply.id);
    assert.equal(replyStages.find((s) => s.stage_key === "snapshot").status, "DONE");
    for (const name of ["synthesis", "recommendation", "plan"]) assert.equal(replyStages.find((s) => s.stage_key === name).status, "SKIPPED");
    const stableStages = JSON.stringify(replyStages);
    await f.process(reply);
    assert.equal(JSON.stringify(await f.events.listStages(f.organization.id, reply.id)), stableStages);
    assert.equal((await f.db.get("SELECT COUNT(*) AS n FROM action_executions")).n, 0);
  }
});

test("pending workspace policy defers initial planning; resolving harmless receipt retries the same event within its frozen budget", async (t) => {
  const f = await policyFixture(t);
  const lead = await f.leads.createLead({ organization_id: f.organization.id, name: "Pending policy", email: "pending@example.test" });
  const inbox = new WebhookInboxService({ db: f.db, now: f.now, handlers: {
    EXECUTION_CALLBACK: async (_, { receipt }) => f.gate.withWorkspacePolicyTransaction(receipt.organization_id, async (tx) => {
      await assertReceiptOwnership(tx, receipt);
      await tx.run("UPDATE webhook_receipts SET mandatory_policy_status='DONE' WHERE id=?", [receipt.id]);
    })
  } });
  const received = await inbox.receive({ organization_id: f.organization.id, provider: "synthetic", connection_key: "application",
    event_kind: "EXECUTION_CALLBACK", provider_event_id: "pending-review", verification_kind: "LOCAL_TEST", input: { event: "harmless" } });
  const event = await f.eventFor(lead, "LeadCreated");
  const deferred = await f.process(event);
  assert.equal(deferred.status, "RETRY_PENDING");
  assert.equal(deferred.last_error_code, "EVENT_POLICY_PENDING");
  assert.equal(deferred.attempts, 1);
  assert.equal((await f.db.get("SELECT COUNT(*) AS n FROM actions WHERE lead_id=?", [lead.id])).n, 0);
  assert.equal((await f.db.get("SELECT COUNT(*) AS n FROM action_executions")).n, 0);
  assert.equal((await f.process(event)).attempts, 1, "early processing cannot consume another attempt");
  assert.equal((await inbox.processOne(f.organization.id, received.row.id)).row.processing_state, "PROCESSED");
  f.advance(Date.parse(deferred.next_attempt_at));
  const done = await f.process(event);
  assert.equal(done.status, "PROCESSED");
  assert.equal(done.attempts, 2);
  assert.equal(done.max_attempts, deferred.max_attempts);
  assert.equal(done.first_processing_at, deferred.first_processing_at);
  assert.equal(done.retry_deadline_at, deferred.retry_deadline_at);
  const persisted = await f.events.getForOrganization(f.organization.id, event.id);
  assert.equal(persisted.payload_json, event.payload_json);
  assert.equal(persisted.payload_hash, event.payload_hash);
  assert.equal((await f.db.get("SELECT COUNT(*) AS n FROM actions WHERE lead_id=?", [lead.id])).n, 1);
  await f.process(event);
  assert.equal((await f.db.get("SELECT COUNT(*) AS n FROM actions WHERE lead_id=?", [lead.id])).n, 1);
});
