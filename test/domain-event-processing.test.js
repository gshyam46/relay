import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";
import { DomainEventProcessor } from "../src/modules/events/domainEventProcessor.js";
import { createLeadEventHandlers } from "../src/modules/events/leadEventHandlers.js";

async function fixture(t) {
  const client = await startClient(t);
  const { organization } = await client.register("Lead processing");
  let now = Date.now() + 1000;
  client.services.actionExecutor.now = () => now;
  const { lead } = await client.post("/api/leads", { name: "Processing Lead", email: "lead@example.test", company: "Example", organization_id: organization.id });
  await client.services.domainEventProcessor.processDue({ organization_id: organization.id, limit: 25 });
  return { client, organization, lead, advance(value) { now = value; }, now: () => now };
}
async function reply(f, id = "reply-processing") {
  await f.client.post("/api/inbound-events/mock", { organization_id: f.organization.id, lead_id: f.lead.id,
    channel: "EMAIL", provider_event_id: id, payload: { text: "What does this cost?" } });
  return f.client.db.get("SELECT * FROM domain_events WHERE organization_id=? AND lead_id=? AND type='LeadReplyReceived' ORDER BY created_at,id DESC", [f.organization.id, f.lead.id]);
}
async function process(f, event) { return f.client.services.domainEventProcessor.processOne({ organization_id: f.organization.id, event_id: event.id }); }
async function counts(f) {
  const result = {};
  for (const table of ["intelligence_snapshots", "intelligence_synthesis_runs", "intelligence_recommendation_runs", "next_best_action_plans", "actions"]) {
    result[table] = Number((await f.client.db.get("SELECT COUNT(*) AS n FROM " + table + " WHERE organization_id=? AND lead_id=?", [f.organization.id, f.lead.id])).n);
  }
  return result;
}
function barrier() { let release; const promise = new Promise((resolve) => { release = resolve; }); return { promise, release }; }

test("failed generation stays retryable with a committed snapshot; retry caches unchanged stages and never sends", async (t) => {
  const f = await fixture(t), event = await reply(f);
  const original = f.client.services.synthesisService.synthesisAgent;
  let calls = 0;
  f.client.services.synthesisService.synthesisAgent = { async synthesize() {
    calls++;
    // Parent client reads would reject if model generation ran inside a DB transaction.
    assert.equal((await f.client.db.get("SELECT COUNT(*) AS n FROM organizations")).n, 1);
    throw new Error("private-provider-secret-failure");
  } };
  const failed = await process(f, event);
  assert.equal(failed.status, "RETRY_PENDING");
  assert.equal(failed.attempts, 1);
  assert.equal(failed.last_error_code, "EVENT_PROCESSING_FAILED");
  const detail = await f.client.services.domainEventProcessor.inspect({ organization_id: f.organization.id, event_id: event.id });
  assert.equal(detail.stages.find((s) => s.stage_key === "snapshot").status, "DONE");
  assert.equal(detail.stages.find((s) => s.stage_key === "synthesis").status, "PREPARED");
  assert.equal(JSON.stringify(detail).includes("private-provider"), false);
  f.client.services.synthesisService.synthesisAgent = { async synthesize(input) { calls++; return original.synthesize(input); } };
  assert.equal((await process(f, event)).attempts, 1, "an early retry does not spend another attempt");
  f.advance(Date.parse(failed.next_attempt_at));
  const done = await process(f, event);
  assert.equal(done.status, "PROCESSED");
  assert.equal(done.attempts, 2);
  const before = await counts(f);
  await process(f, event);
  assert.deepEqual(await counts(f), before);
  assert.equal(calls, 2);
  assert.equal((await f.client.db.get("SELECT COUNT(*) AS n FROM action_executions")).n, 0);
  assert.equal((await f.client.db.get("SELECT COUNT(*) AS n FROM audit_logs WHERE event_type='LeadIntelligenceSynthesized'")).n, 1);
});

test("artifact, supersession, audit and stage completion roll back together", async (t) => {
  const f = await fixture(t), event = await reply(f);
  await f.client.db.exec("CREATE TRIGGER fail_synthesis_audit BEFORE INSERT ON audit_logs WHEN NEW.event_type='LeadIntelligenceSynthesized' BEGIN SELECT RAISE(ABORT,'private audit storage error'); END");
  const failed = await process(f, event);
  assert.equal(failed.status, "RETRY_PENDING");
  assert.equal((await f.client.db.get("SELECT COUNT(*) AS n FROM intelligence_synthesis_runs")).n, 0);
  assert.equal((await f.client.db.get("SELECT status FROM domain_event_stages WHERE event_id=? AND stage_key='synthesis'", [event.id])).status, "PREPARED");
  await f.client.db.exec("DROP TRIGGER fail_synthesis_audit");
  f.advance(Date.parse(failed.next_attempt_at));
  assert.equal((await process(f, event)).status, "PROCESSED");
  assert.equal((await f.client.db.get("SELECT COUNT(*) AS n FROM intelligence_synthesis_runs WHERE status='READY'")).n, 1);
});

test("expired generation cannot overwrite a replacement processor's committed result", { timeout: 10000 }, async (t) => {
  const f = await fixture(t), event = await reply(f), entered = barrier(), unblock = barrier();
  const original = f.client.services.synthesisService.synthesisAgent;
  f.client.services.synthesisService.synthesisAgent = { async synthesize(input) { entered.release(); await unblock.promise; return original.synthesize(input); } };
  const old = process(f, event);
  await entered.promise;
  f.client.services.synthesisService.synthesisAgent = original;
  f.advance(f.now() + 120001);
  const replacement = new DomainEventProcessor({ db: f.client.db, contactPolicyService: f.client.services.contactPolicyService,
    now: f.now, handlers: createLeadEventHandlers({ getServices: () => f.client.services }) });
  const done = await replacement.processOne({ organization_id: f.organization.id, event_id: event.id });
  assert.equal(done.status, "PROCESSED");
  const before = await counts(f);
  unblock.release();
  await old;
  assert.deepEqual(await counts(f), before);
  const final = await f.client.db.get("SELECT status,attempts,processing_fence FROM domain_events WHERE id=?", [event.id]);
  assert.equal(final.status, "PROCESSED");
  assert.equal(final.attempts, 2);
  assert.equal(final.processing_fence, 2);
});

test("opt-out during model generation rejects stale output then refreshes restricted intelligence", { timeout: 10000 }, async (t) => {
  const f = await fixture(t), event = await reply(f), entered = barrier(), unblock = barrier();
  const original = f.client.services.synthesisService.synthesisAgent;
  f.client.services.synthesisService.synthesisAgent = { async synthesize(input) { entered.release(); await unblock.promise; return original.synthesize(input); } };
  const running = process(f, event);
  await entered.promise;
  await f.client.post("/api/inbound-events/mock", { organization_id: f.organization.id, lead_id: f.lead.id, channel: "EMAIL",
    provider_event_id: "stop-during-generation", payload: { text: "Stop contacting me. Unsubscribe." } });
  unblock.release();
  const failed = await running;
  assert.equal(failed.status, "RETRY_PENDING");
  assert.equal(failed.last_error_code, "EVENT_INPUT_CHANGED");
  assert.equal((await f.client.db.get("SELECT COUNT(*) AS n FROM intelligence_synthesis_runs")).n, 0);
  f.advance(Date.parse(failed.next_attempt_at));
  assert.equal((await process(f, event)).status, "PROCESSED");
  const lead = await f.client.services.leadsRepository.getLead(f.lead.id);
  const intelligence = await f.client.services.intelligenceService.assessLead(lead);
  assert.ok(intelligence.snapshot.signals.some((signal) => signal.type === "LEAD_OPTED_OUT"));
  const stages = await f.client.services.eventsRepository.listStages(f.organization.id, event.id);
  assert.equal(stages.filter((stage) => stage.status === "SKIPPED").length, 3);
  assert.equal((await f.client.db.get("SELECT COUNT(*) AS n FROM next_best_action_plans")).n, 0);
});

test("initial event completion failure replays one action and one corresponding audit", async (t) => {
  const f = await fixture(t);
  const event = await f.client.services.eventsRepository.publish({ organization_id: f.organization.id, lead_id: f.lead.id, type: "LeadCreated" });
  const before = await counts(f);
  await f.client.db.exec("CREATE TRIGGER fail_event_finish BEFORE UPDATE OF status ON domain_events WHEN NEW.status='PROCESSED' BEGIN SELECT RAISE(ABORT,'finish failed'); END");
  const failed = await process(f, event);
  assert.equal(failed.status, "RETRY_PENDING");
  await f.client.db.exec("DROP TRIGGER fail_event_finish");
  f.advance(Date.parse(failed.next_attempt_at));
  assert.equal((await process(f, event)).status, "PROCESSED");
  assert.deepEqual(await counts(f), before);
  assert.equal((await f.client.db.get("SELECT COUNT(*) AS n FROM audit_logs WHERE event_type='ActionPlanned'")).n, 1);
});

test("unknown events quarantine; exhausted budgets and legacy history cannot be promoted by retry", async (t) => {
  const f = await fixture(t);
  const unknown = await f.client.services.eventsRepository.publish({ organization_id: f.organization.id, type: "UnregisteredOperation" });
  const held = await process(f, unknown);
  assert.equal(held.status, "QUARANTINED");
  assert.equal(held.last_error_code, "EVENT_UNSUPPORTED_TYPE");
  assert.equal(held.can_retry, false);
  const event = await reply(f);
  await f.client.db.run("UPDATE domain_events SET max_attempts=1 WHERE id=?", [event.id]);
  f.client.services.synthesisService.synthesisAgent = { async synthesize() { throw new Error("no provider"); } };
  const exhausted = await process(f, event);
  assert.equal(exhausted.status, "QUARANTINED");
  assert.equal(exhausted.last_error_code, "EVENT_BUDGET_EXHAUSTED");
  assert.equal(exhausted.can_retry, false);
  await assert.rejects(() => f.client.services.domainEventProcessor.review({ organization_id: f.organization.id, event_id: event.id,
    expected_fence: exhausted.processing_fence, decision: "RETRY", evidence_note: "Investigated.", reviewer_user_id: "owner" }), { code: "EVENT_REVIEW_UNAVAILABLE" });
});
