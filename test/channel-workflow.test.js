import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/api/app.js";
import { createDatabase } from "../src/database/database.js";

test("outbound execution records channel activity and schedules idempotent follow-up after callback", async (t) => {
  const client = await startClient(t);
  const organization = await client.post("/api/organizations", { name: "Channel Outbound Org" });
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

  await client.post(`/api/actions/${action.action.id}/execute`, {
    organization_id: organization.organization.id
  });
  const beforeCallback = await client.get(`/api/leads/${lead.lead.id}/timeline?organization_id=${organization.organization.id}`);
  await client.post(`/api/actions/${action.action.id}/callback`, {
    organization_id: organization.organization.id,
    provider_event_id: "channel-outbound-callback",
    status: "COMPLETED"
  });
  await client.post(`/api/actions/${action.action.id}/callback`, {
    organization_id: organization.organization.id,
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
  assert.equal(client.db.all("SELECT * FROM channel_messages WHERE action_id = ?", [action.action.id]).length, 1);
  assert.equal(client.db.all("SELECT * FROM follow_up_tasks WHERE action_id = ?", [action.action.id]).length, 1);
});

test("mock inbound events are normalized, idempotent, and create review follow-ups for questions", async (t) => {
  const client = await startClient(t);
  const organization = await client.post("/api/organizations", { name: "Inbound Question Org" });
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
  assert.equal(client.db.all("SELECT * FROM inbound_events WHERE lead_id = ?", [lead.lead.id]).length, 1);
});

test("opt-out inbound event stops open follow-ups and updates lead state", async (t) => {
  const client = await startClient(t);
  const organization = await client.post("/api/organizations", { name: "Opt Out Org" });
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
  await client.post(`/api/actions/${action.action.id}/execute`, {
    organization_id: organization.organization.id
  });
  await client.post(`/api/actions/${action.action.id}/callback`, {
    organization_id: organization.organization.id,
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

test("channel workflow APIs are organization scoped", async (t) => {
  const client = await startClient(t);
  const firstOrg = await client.post("/api/organizations", { name: "Channel Tenant A" });
  const secondOrg = await client.post("/api/organizations", { name: "Channel Tenant B" });
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

  const wrongInbound = await fetch(`${client.baseUrl}/api/inbound-events/mock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organization_id: secondOrg.organization.id,
      lead_id: lead.lead.id,
      channel: "EMAIL",
      provider_event_id: "tenant-event-2",
      event_type: "QUESTION"
    })
  });
  const wrongTimeline = await fetch(
    `${client.baseUrl}/api/leads/${lead.lead.id}/timeline?organization_id=${secondOrg.organization.id}`
  );
  const wrongComplete = await fetch(`${client.baseUrl}/api/follow-ups/${inbound.follow_up.id}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organization_id: secondOrg.organization.id })
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
    const organization = await firstClient.post("/api/organizations", { name: "Channel Restart Org" });
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

async function startClient(t, databaseFile = ":memory:", { autoCleanup = true } = {}) {
  const db = createDatabase(databaseFile);
  const server = createApp({ db });
  let stopped = false;

  await new Promise((resolve) => server.listen(0, resolve));
  if (autoCleanup) {
    t.after(() => stop());
  }

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  async function stop() {
    if (stopped) {
      return;
    }
    stopped = true;
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }

  return {
    baseUrl,
    db,
    stop,
    async get(route) {
      const response = await fetch(`${baseUrl}${route}`);
      if (!response.ok) {
        assert.fail(`${response.status} ${await response.text()}`);
      }
      return response.json();
    },
    async post(route, body) {
      const response = await fetch(`${baseUrl}${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        assert.fail(`${response.status} ${await response.text()}`);
      }
      return response.json();
    }
  };
}

