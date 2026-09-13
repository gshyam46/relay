import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startClient } from "./helpers/testClient.js";
import { LocalReplyClassifier } from "../src/modules/channels/replyClassifier.js";

test("local reply classifier maps free text to inbound event types with a reason", async () => {
  const classifier = new LocalReplyClassifier();

  assert.equal((await classifier.classify("Please stop texting me, unsubscribe")).event_type, "OPT_OUT");
  assert.equal((await classifier.classify("Not interested, thanks")).event_type, "NEGATIVE_REPLY");
  assert.equal((await classifier.classify("What does this cost?")).event_type, "QUESTION");
  assert.equal((await classifier.classify("Sounds good, let's schedule a call")).event_type, "POSITIVE_REPLY");

  const unknown = await classifier.classify("asdkfj qwoeiru");
  assert.equal(unknown.event_type, "UNKNOWN");
  assert.equal(unknown.confidence, "LOW");
  assert.ok(unknown.reason.length > 0);

  const empty = await classifier.classify("");
  assert.equal(empty.event_type, "UNKNOWN");
  assert.equal(empty.confidence, "LOW");
});

test("outbound execution records channel activity and schedules idempotent follow-up after callback", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Channel Outbound Org");
  const lead = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Outbound Lead",
    email: "outbound@example.com"
  });
  const action = await client.post(`/api/leads/${lead.lead.id}/actions`, {
    organization_id: organization.organization.id,
    type: "SEND_EMAIL",
    mock_behavior: "SUCCESS"
  });

  await client.approve(action.action.id);
  const dispatched = await client.post(`/api/actions/${action.action.id}/execute`, {
    organization_id: organization.organization.id
  });
  const beforeCallback = await client.get(`/api/leads/${lead.lead.id}/timeline?organization_id=${organization.organization.id}`);
  await client.post(`/api/actions/${action.action.id}/callback`, {
    organization_id: organization.organization.id,
    action_execution_id: dispatched.execution_result.execution.id,
    provider_event_id: "channel-outbound-callback",
    status: "COMPLETED"
  });
  await client.post(`/api/actions/${action.action.id}/callback`, {
    organization_id: organization.organization.id,
    action_execution_id: dispatched.execution_result.execution.id,
    provider_event_id: "channel-outbound-callback",
    status: "COMPLETED"
  });
  const afterCallback = await client.get(`/api/leads/${lead.lead.id}/timeline?organization_id=${organization.organization.id}`);
  const followUps = await client.get(`/api/follow-ups?organization_id=${organization.organization.id}`);

  assert.equal(beforeCallback.timeline.filter((item) => item.kind === "message").length, 1);
  assert.equal(beforeCallback.timeline.find((item) => item.kind === "message").status, "SENT");
  assert.equal(afterCallback.timeline.filter((item) => item.kind === "message").length, 1);
  assert.equal(afterCallback.timeline.find((item) => item.kind === "message").status, "DELIVERED");
  assert.equal(followUps.follow_ups.length, 1);
  assert.equal(followUps.follow_ups[0].status, "PLANNED");
  assert.equal((await client.db.all("SELECT * FROM channel_messages WHERE action_id = ?", [action.action.id])).length, 1);
  assert.equal((await client.db.all("SELECT * FROM follow_up_tasks WHERE action_id = ?", [action.action.id])).length, 1);
});

test("mock inbound events are normalized, idempotent, and create review follow-ups for questions", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Inbound Question Org");
  const lead = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Question Lead",
    phone: "+919876543210"
  });

  const first = await client.post("/api/inbound-events/mock", {
    organization_id: organization.organization.id,
    lead_id: lead.lead.id,
    channel: "WHATSAPP",
    provider_event_id: "inbound-question-1",
    event_type: "QUESTION",
    payload: { text: "Can you share the brochure?" }
  });
  const duplicate = await client.post("/api/inbound-events/mock", {
    organization_id: organization.organization.id,
    lead_id: lead.lead.id,
    channel: "WHATSAPP",
    provider_event_id: "inbound-question-1",
    event_type: "QUESTION",
    payload: { text: "Can you share the brochure?" }
  });
  const timeline = await client.get(`/api/leads/${lead.lead.id}/timeline?organization_id=${organization.organization.id}`);
  const followUps = await client.get(`/api/follow-ups?organization_id=${organization.organization.id}&status=DUE`);

  assert.equal(first.duplicate, false);
  assert.equal(first.inbound_event.event_type, "QUESTION");
  assert.equal(duplicate.duplicate, true);
  assert.equal(timeline.timeline.filter((item) => item.kind === "message" && item.direction === "INBOUND").length, 1);
  assert.equal(followUps.follow_ups.length, 1);
  assert.equal(followUps.follow_ups[0].reason, "Answer the lead's question.");
  assert.equal((await client.db.all("SELECT * FROM inbound_events WHERE lead_id = ?", [lead.lead.id])).length, 1);
});

test("opt-out inbound event stops open follow-ups and updates lead state", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Opt Out Org");
  const lead = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Opt Out Lead",
    email: "optout@example.com"
  });
  const action = await client.post(`/api/leads/${lead.lead.id}/actions`, {
    organization_id: organization.organization.id,
    type: "SEND_EMAIL",
    mock_behavior: "SUCCESS"
  });
  await client.approve(action.action.id);
  const dispatched = await client.post(`/api/actions/${action.action.id}/execute`, {
    organization_id: organization.organization.id
  });
  await client.post(`/api/actions/${action.action.id}/callback`, {
    organization_id: organization.organization.id,
    action_execution_id: dispatched.execution_result.execution.id,
    provider_event_id: "opt-out-outbound-complete",
    status: "COMPLETED"
  });

  await client.post("/api/inbound-events/mock", {
    organization_id: organization.organization.id,
    lead_id: lead.lead.id,
    channel: "EMAIL",
    provider_event_id: "opt-out-inbound",
    event_type: "OPT_OUT",
    payload: { text: "Unsubscribe" }
  });
  const followUps = await client.get(`/api/follow-ups?organization_id=${organization.organization.id}`);
  const refreshedLead = await client.get(`/api/leads/${lead.lead.id}?organization_id=${organization.organization.id}`);

  assert.equal(followUps.follow_ups[0].status, "CANCELLED");
  assert.equal(refreshedLead.lead.status, "OPTED_OUT");
});

test("inbound reply without event_type is auto-classified from message text", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Auto Classify Org");
  const lead = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Auto Classify Lead",
    email: "auto-classify@example.com"
  });

  const result = await client.post("/api/inbound-events/mock", {
    organization_id: organization.organization.id,
    lead_id: lead.lead.id,
    channel: "EMAIL",
    provider_event_id: "auto-classify-1",
    payload: { text: "Sounds good, let's schedule a call this week" }
  });

  assert.equal(result.inbound_event.event_type, "POSITIVE_REPLY");
  assert.equal(result.classification.event_type, "POSITIVE_REPLY");
  assert.equal(result.classification.confidence, "MEDIUM");

  const timeline = await client.get(`/api/leads/${lead.lead.id}/timeline?organization_id=${organization.organization.id}`);
  const message = timeline.timeline.find((item) => item.kind === "message" && item.direction === "INBOUND");

  // A conversation bubble must show what the lead SAID. This previously asserted
  // that `message` contained "Classified as ..." — our own description of the
  // reply — which is why the thread read like an audit log rather than a
  // conversation. The classification is still exposed, on its own fields.
  assert.equal(message.message, "Sounds good, let's schedule a call this week");
  assert.ok(message.summary.includes("Classified as"), "our description is still available separately");
  assert.equal(message.classification_event_type, "POSITIVE_REPLY");
  assert.equal(message.classification_confidence, "MEDIUM");
  assert.ok(message.suggested_next_step, "and so is the suggested next step");
});

test("low-confidence auto-classification escalates the follow-up and surfaces as high-priority attention", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Escalation Org");
  const lead = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Escalation Lead",
    email: "escalation@example.com"
  });

  await client.post("/api/inbound-events/mock", {
    organization_id: organization.organization.id,
    lead_id: lead.lead.id,
    channel: "EMAIL",
    provider_event_id: "escalation-1",
    payload: { text: "zzzzz qqqqq unrelated gibberish" }
  });

  const followUps = await client.get(`/api/follow-ups?organization_id=${organization.organization.id}&status=DUE`);
  assert.equal(followUps.follow_ups.length, 1);
  assert.match(followUps.follow_ups[0].reason, /^Escalated:/);

  const attention = await client.get(`/api/dashboard/attention?organization_id=${organization.organization.id}`);
  const item = attention.items.find((i) => i.lead_id === lead.lead.id);
  assert.ok(item, "escalated lead should appear in the attention queue");
  assert.equal(item.priority, "HIGH");
  assert.equal(item.reason, "Reply needs human review");
});

test("channel workflow APIs are organization scoped", async (t) => {
  const client = await startClient(t);
  const firstOrg = await client.register("Channel Tenant A");
  const lead = await client.post("/api/leads", {
    organization_id: firstOrg.organization.id,
    name: "Tenant Scoped Lead",
    email: "tenant-channel@example.com"
  });
  const inbound = await client.post("/api/inbound-events/mock", {
    organization_id: firstOrg.organization.id,
    lead_id: lead.lead.id,
    channel: "EMAIL",
    provider_event_id: "tenant-event-1",
    event_type: "QUESTION",
    payload: { text: "Who owns this?" }
  });

  await client.register("Channel Tenant B"); // switches the active session to org B

  const wrongInbound = await client.rawFetch("/api/inbound-events/mock", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      lead_id: lead.lead.id,
      channel: "EMAIL",
      provider_event_id: "tenant-event-2",
      event_type: "QUESTION"
    })
  });
  const wrongTimeline = await client.rawFetch(`/api/leads/${lead.lead.id}/timeline`);
  const wrongComplete = await client.rawFetch(`/api/follow-ups/${inbound.follow_up.id}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });

  assert.equal(wrongInbound.status, 404);
  assert.equal(wrongTimeline.status, 404);
  assert.equal(wrongComplete.status, 404);
});

test("channel messages, inbound events, and follow-ups survive restart", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-lead-channel-"));
  const databaseFile = path.join(tempDir, "app.db");
  let firstClient;
  let secondClient;

  try {
    firstClient = await startClient(t, databaseFile, { autoCleanup: false });
    const organization = await firstClient.register("Channel Restart Org");
    const lead = await firstClient.post("/api/leads", {
      organization_id: organization.organization.id,
      name: "Restart Channel Lead",
      phone: "+14155551234"
    });
    await firstClient.post("/api/inbound-events/mock", {
      organization_id: organization.organization.id,
      lead_id: lead.lead.id,
      channel: "VOICE",
      provider_event_id: "restart-voice-event",
      event_type: "UNKNOWN",
      payload: { transcript: "Please call later." }
    });
    await firstClient.stop();

    secondClient = await startClient(t, databaseFile, { autoCleanup: false });
    await secondClient.login(organization.user.email);
    const timeline = await secondClient.get(`/api/leads/${lead.lead.id}/timeline?organization_id=${organization.organization.id}`);
    const followUps = await secondClient.get(`/api/follow-ups?organization_id=${organization.organization.id}`);

    assert.equal(timeline.timeline.some((item) => item.channel === "VOICE" && item.direction === "INBOUND"), true);
    assert.equal(followUps.follow_ups.length, 1);
    assert.equal(followUps.follow_ups[0].status, "DUE");
  } finally {
    await firstClient?.stop();
    await secondClient?.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});
