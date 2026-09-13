import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";

async function review(client, id, body) {
  const response = await client.rawFetch("/api/domain-events/" + id + "/review", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

test("domain recovery views paginate and bind owner, tenant, actor and exact fence without exposing payloads", async (t) => {
  const client = await startClient(t), owner = await client.register("Domain review");
  const service = client.services.domainEventProcessor;
  for (const type of ["UnknownOne", "UnknownTwo"]) {
    const event = await client.services.eventsRepository.publish({ organization_id: owner.organization.id, type, payload: { secret: "private-source-record" } });
    await service.processOne({ organization_id: owner.organization.id, event_id: event.id });
  }
  const first = await client.get("/api/domain-events?limit=1");
  assert.equal(first.total, 2); assert.equal(first.has_more, true);
  const item = first.items[0];
  const detail = await client.get("/api/domain-events/" + item.id);
  assert.equal(detail.payload_json, undefined); assert.equal(detail.lease_owner, undefined); assert.equal(detail.last_error, undefined);
  assert.equal(JSON.stringify(detail).includes("private-source-record"), false);
  const input = { expected_fence: detail.processing_fence, decision: "CLOSE", evidence_note: "Checked the unsupported event source.", reviewer_user_id: "forged" };
  assert.equal((await review(client, item.id, { ...input, expected_fence: 999 })).status, 409);
  const original = await client.db.get("SELECT payload_json,payload_hash,attempts,max_attempts,retry_deadline_at FROM domain_events WHERE id=?", [item.id]);
  assert.equal((await review(client, item.id, input)).status, 200);
  assert.equal((await review(client, item.id, input)).body.duplicate, true);
  assert.equal((await review(client, item.id, { ...input, evidence_note: "Different decision." })).status, 409);
  assert.deepEqual(await client.db.get("SELECT payload_json,payload_hash,attempts,max_attempts,retry_deadline_at FROM domain_events WHERE id=?", [item.id]), original);
  assert.equal((await client.db.get("SELECT reviewer_user_id FROM domain_event_reviews WHERE event_id=?", [item.id])).reviewer_user_id, owner.user.id);
  const other = await client.register("Foreign domain review");
  assert.equal((await client.get("/api/domain-events?state=ALL")).total, 0);
  assert.equal((await client.rawFetch("/api/domain-events/" + item.id)).status, 404);
  assert.equal((await review(client, item.id, input)).status, 404);
  await client.db.run("UPDATE users SET role='VIEWER' WHERE id=?", [other.user.id]);
  assert.equal((await client.rawFetch("/api/domain-events")).status, 403);
  assert.equal((await review(client, item.id, input)).status, 403);
});

test("owner retry clears only a managed processing hold and normal worker repairs original input", async (t) => {
  const client = await startClient(t), owner = await client.register("Domain retry");
  const service = client.services.domainEventProcessor;
  let failing = true, calls = 0;
  service.handlers.ActionCompleted = async (event) => { calls++; assert.deepEqual(JSON.parse(event.payload_json), { original: true });
    if (failing) throw Object.assign(new Error("Missing local dependency"), { statusCode: 422 }); };
  const event = await client.services.eventsRepository.publish({ organization_id: owner.organization.id, type: "ActionCompleted", payload: { original: true } });
  const held = await service.processOne({ organization_id: owner.organization.id, event_id: event.id });
  assert.equal(held.status, "QUARANTINED"); assert.equal(held.can_retry, true);
  failing = false;
  const decision = await review(client, event.id, { expected_fence: held.processing_fence, decision: "RETRY", evidence_note: "Repaired local dependency." });
  assert.equal(decision.status, 200); assert.equal(calls, 1);
  const queued = await client.db.get("SELECT * FROM domain_events WHERE id=?", [event.id]);
  assert.equal(queued.processing_hold_reason, null);
  assert.equal(queued.attempts, 1);
  await client.post("/api/worker/run", {});
  const done = await client.get("/api/domain-events/" + event.id);
  assert.equal(done.status, "PROCESSED"); assert.equal(done.attempts, 2); assert.equal(calls, 2);
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM action_executions")).n, 0);
});

test("legacy event closure preserves history and cannot waive an independent pending webhook policy", async (t) => {
  const client = await startClient(t), owner = await client.register("Legacy event review");
  await client.db.run("INSERT INTO domain_events (id,organization_id,type,payload_json,status,attempts,created_at,last_error,processing_hold_reason) VALUES (?,?,?,?,?,?,?,?,?)",
    ["legacy-domain", owner.organization.id, "LeadCreated", "{old broken input", "FAILED", 2, new Date().toISOString(), "private historical failure", "LEGACY_EVENT_REVIEW_REQUIRED"]);
  const pending = await client.services.webhookInbox.receive({ organization_id: owner.organization.id, provider: "local", connection_key: "application",
    event_kind: "INBOUND_MESSAGE", provider_event_id: "unresolved-policy", verification_kind: "TRUSTED_INTERNAL", input: { text: "stop" } });
  const detail = await client.get("/api/domain-events/legacy-domain");
  assert.equal(detail.processing_version, 0); assert.equal(detail.can_retry, false); assert.equal(detail.can_close, true);
  assert.equal(detail.last_error, undefined);
  assert.equal((await review(client, "legacy-domain", { expected_fence: 0, decision: "RETRY", evidence_note: "Cannot infer old effects." })).status, 409);
  assert.equal((await review(client, "legacy-domain", { expected_fence: 0, decision: "CLOSE", evidence_note: "Archived after inspected historical review." })).status, 200);
  assert.equal((await client.db.get("SELECT mandatory_policy_status FROM webhook_receipts WHERE id=?", [pending.row.id])).mandatory_policy_status, "PENDING");
  const preserved = await client.db.get("SELECT * FROM domain_events WHERE id='legacy-domain'");
  assert.equal(preserved.payload_json, "{old broken input"); assert.equal(preserved.last_error, "private historical failure"); assert.equal(preserved.attempts, 2);
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM domain_event_stages WHERE event_id='legacy-domain'")).n, 0);
});

test("due human follow-ups advance once; future/cancelled tasks remain unchanged and invalid times need review", async (t) => {
  const client = await startClient(t), owner = await client.register("Due human work");
  const { lead } = await client.post("/api/leads", { name: "Human follow-up", email: "human@example.test" });
  let now = Date.now() + 1000; client.services.actionExecutor.now = () => now;
  const make = (key, due_at, status = "PLANNED") => client.services.followUpsRepository.create({ organization_id: owner.organization.id, lead_id: lead.id,
    channel: "EMAIL", status, due_at, reason: "Operator response needed.", idempotency_key: key });
  const due = await make("due", new Date(now - 100).toISOString());
  const future = await make("future", new Date(now + 60000).toISOString());
  const cancelled = await make("cancelled", new Date(now - 100).toISOString(), "CANCELLED");
  const invalid = await make("invalid", "bad-date");
  const processed = await client.services.followUpDueService.processDue({ organization_id: owner.organization.id });
  assert.equal(processed.due_follow_ups.length, 2);
  assert.equal((await client.services.followUpsRepository.getForOrganization(due.id, owner.organization.id)).status, "DUE");
  assert.equal((await client.services.followUpsRepository.getForOrganization(invalid.id, owner.organization.id)).status, "BLOCKED");
  assert.equal((await client.services.followUpsRepository.getForOrganization(future.id, owner.organization.id)).status, "PLANNED");
  assert.equal((await client.services.followUpsRepository.getForOrganization(cancelled.id, owner.organization.id)).status, "CANCELLED");
  assert.equal((await client.services.followUpDueService.processDue({ organization_id: owner.organization.id })).due_follow_ups.length, 0);
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM audit_logs WHERE event_type='FollowUpBecameDue'")).n, 1);
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM action_executions")).n, 0);
});
