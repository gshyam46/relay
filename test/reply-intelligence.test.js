import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";

test("classification is persisted as first-class columns on inbound_events and channel_messages", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Classification Columns Org");
  const lead = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Classification Lead",
    email: "classify-columns@example.com"
  });

  await client.post("/api/inbound-events/mock", {
    organization_id: organization.organization.id,
    lead_id: lead.lead.id,
    channel: "EMAIL",
    provider_event_id: "columns-1",
    payload: { text: "Sounds good, let's schedule a call this week" }
  });

  const inboundRow = await client.db.get("SELECT * FROM inbound_events WHERE lead_id = ?", [lead.lead.id]);
  assert.equal(inboundRow.event_type, "POSITIVE_REPLY");
  assert.equal(inboundRow.confidence, "MEDIUM");
  assert.ok(inboundRow.reason?.length > 0);

  const messageRow = await client.db.get(
    "SELECT * FROM channel_messages WHERE lead_id = ? AND direction = 'INBOUND'",
    [lead.lead.id]
  );
  assert.equal(messageRow.classification_event_type, "POSITIVE_REPLY");
  assert.equal(messageRow.classification_confidence, "MEDIUM");
  assert.ok(messageRow.suggested_next_step?.length > 0);
});

test("low-confidence replies are flagged escalated on the follow-up row, not just by reason text", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Escalation Column Org");
  const lead = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Escalation Column Lead",
    email: "escalation-column@example.com"
  });

  await client.post("/api/inbound-events/mock", {
    organization_id: organization.organization.id,
    lead_id: lead.lead.id,
    channel: "EMAIL",
    provider_event_id: "escalation-column-1",
    payload: { text: "zzzzz qqqqq unrelated gibberish" }
  });

  const followUpRow = await client.db.get("SELECT * FROM follow_up_tasks WHERE lead_id = ?", [lead.lead.id]);
  assert.equal(followUpRow.escalated, 1);

  // The Outbound page's follow-up summary card reads this endpoint directly (not /api/follow-ups) —
  // it explicitly enumerates columns, so a forgotten column here silently drops the badge in the UI.
  const summary = await client.get(`/api/follow-ups/summary?organization_id=${organization.organization.id}`);
  const summaryRow = summary.follow_ups.find((f) => f.lead_id === lead.lead.id);
  assert.equal(summaryRow.escalated, 1);

  const attention = await client.get(`/api/dashboard/attention?organization_id=${organization.organization.id}`);
  const item = attention.items.find((i) => i.lead_id === lead.lead.id);
  assert.ok(item, "escalated lead should appear in the attention queue");
  assert.equal(item.priority, "HIGH");
  assert.equal(item.reason, "Reply needs human review");

  await client.post(`/api/follow-ups/${followUpRow.id}/complete`, { organization_id: organization.organization.id });
  const attentionAfter = await client.get(`/api/dashboard/attention?organization_id=${organization.organization.id}`);
  assert.equal(
    attentionAfter.items.some((i) => i.lead_id === lead.lead.id && i.reason === "Reply needs human review"),
    false,
    "resolving the escalated follow-up should clear it from the attention queue"
  );
});

test("a positive reply feeds a signal into the lead's intelligence snapshot automatically", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Reply Signal Org");
  const lead = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Reply Signal Lead",
    company: "Signal Co",
    email: "reply-signal@example.com"
  });

  const before = await client.post(`/api/leads/${lead.lead.id}/intelligence/run`, {
    organization_id: organization.organization.id
  });
  assert.equal(
    before.intelligence.signals.some((s) => s.type.startsWith("LEAD_REPLIED") || s.type === "LEAD_OPTED_OUT"),
    false
  );

  await client.post("/api/inbound-events/mock", {
    organization_id: organization.organization.id,
    lead_id: lead.lead.id,
    channel: "EMAIL",
    provider_event_id: "reply-signal-1",
    payload: { text: "Sounds good, sign me up" }
  });

  const after = await client.get(`/api/leads/${lead.lead.id}/intelligence?organization_id=${organization.organization.id}`);
  const replySignal = after.intelligence.signals.find((s) => s.type === "LEAD_REPLIED_POSITIVE");
  assert.ok(replySignal, "expected a LEAD_REPLIED_POSITIVE signal after the inbound reply");
  assert.equal(replySignal.confidence, "MEDIUM");
  assert.match(after.intelligence.summary, /positive/i);
  assert.ok(after.intelligence.version > before.intelligence.version, "a new reply should produce a new snapshot version");
});

test("an opt-out reply is reflected as a LEAD_OPTED_OUT signal", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Opt Out Signal Org");
  const lead = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Opt Out Signal Lead",
    company: "Opt Co",
    email: "opt-out-signal@example.com"
  });

  await client.post("/api/inbound-events/mock", {
    organization_id: organization.organization.id,
    lead_id: lead.lead.id,
    channel: "EMAIL",
    provider_event_id: "opt-out-signal-1",
    payload: { text: "Please stop contacting me, unsubscribe" }
  });

  const after = await client.get(`/api/leads/${lead.lead.id}/intelligence?organization_id=${organization.organization.id}`);
  assert.ok(after.intelligence.signals.some((s) => s.type === "LEAD_OPTED_OUT"));
});

test("re-running intelligence with no new reply returns the cached snapshot instead of a new version", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Stable Fingerprint Org");
  const lead = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Stable Fingerprint Lead",
    company: "Stable Co",
    email: "stable-fingerprint@example.com"
  });

  await client.post("/api/inbound-events/mock", {
    organization_id: organization.organization.id,
    lead_id: lead.lead.id,
    channel: "EMAIL",
    provider_event_id: "stable-1",
    payload: { text: "What does this cost?" }
  });
  const first = await client.get(`/api/leads/${lead.lead.id}/intelligence?organization_id=${organization.organization.id}`);
  const second = await client.post(`/api/leads/${lead.lead.id}/intelligence/run`, {
    organization_id: organization.organization.id
  });

  assert.equal(second.intelligence.version, first.intelligence.version);
});

test("duplicate inbound events do not double-apply classification columns or re-trigger a new snapshot version", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Idempotent Reply Org");
  const lead = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Idempotent Reply Lead",
    company: "Idempotent Co",
    email: "idempotent-reply@example.com"
  });

  const payload = {
    organization_id: organization.organization.id,
    lead_id: lead.lead.id,
    channel: "EMAIL",
    provider_event_id: "idempotent-reply-1",
    payload: { text: "Sounds good, let's schedule a call" }
  };
  const first = await client.post("/api/inbound-events/mock", payload);
  const second = await client.post("/api/inbound-events/mock", payload);

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(
    (await client.db.all("SELECT * FROM channel_messages WHERE lead_id = ? AND direction = 'INBOUND'", [lead.lead.id])).length,
    1
  );

  const snapshot = await client.get(`/api/leads/${lead.lead.id}/intelligence?organization_id=${organization.organization.id}`);
  assert.equal(snapshot.intelligence.version, 1);
});
