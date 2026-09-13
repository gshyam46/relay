import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";


async function assertReplyRefreshPending(client, organizationId, leadId, previous) {
  const current = await client.get(`/api/leads/${leadId}/intelligence?organization_id=${organizationId}`);
  assert.equal(current.intelligence, null, "a stale pre-reply snapshot must not be presented as current intelligence");
  const stored = await client.db.get("SELECT id,version FROM intelligence_snapshots WHERE organization_id = ? AND lead_id = ? ORDER BY version DESC LIMIT 1", [organizationId, leadId]);
  assert.equal(stored.id, previous.id, "webhook processing must leave snapshot refresh to the worker");
  assert.equal(stored.version, previous.version);
}

async function processPersistedReply(client, organizationId, leadId) {
  const queued = await client.db.all("SELECT * FROM domain_events WHERE organization_id = ? AND lead_id = ? AND type = 'LeadReplyReceived'", [organizationId, leadId]);
  assert.equal(queued.length, 1, "one canonical reply must publish exactly one intelligence refresh event");
  const event = queued[0];
  assert.equal(event.status, "PENDING");
  assert.equal(event.attempts, 0);
  const inbound = await client.db.get("SELECT * FROM inbound_events WHERE organization_id = ? AND lead_id = ?", [organizationId, leadId]);
  assert.equal(inbound.effects_status, "DONE", "the reply projection commits before intelligence refresh");
  assert.equal(JSON.parse(event.payload_json).inbound_event_id, inbound.id);
  const result = await client.post("/api/worker/run", { organization_id: organizationId });
  assert.ok(result.processed_events.includes(event.id), "the worker must consume the persisted reply event");
  const processed = await client.db.get("SELECT * FROM domain_events WHERE id = ?", [event.id]);
  assert.equal(processed.status, "PROCESSED");
  assert.equal(processed.attempts, 1);
  return event;
}

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

  await client.post("/api/worker/run", { organization_id: organization.organization.id });

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

  await assertReplyRefreshPending(client, organization.organization.id, lead.lead.id, before.intelligence);
  await processPersistedReply(client, organization.organization.id, lead.lead.id);

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

  await client.post("/api/worker/run", { organization_id: organization.organization.id });
  const before = await client.get(`/api/leads/${lead.lead.id}/intelligence?organization_id=${organization.organization.id}`);
  assert.equal(before.intelligence.signals.some((signal) => signal.type === "LEAD_OPTED_OUT"), false);
  const recommendationStages = [];
  for (const stage of ["synthesisService", "intelligenceRecommendationService", "nextBestActionService"]) {
    client.services.worker[stage] = { async runForLead() { recommendationStages.push(stage); }, async planForLead() { recommendationStages.push(stage); } };
  }

  await client.post("/api/inbound-events/mock", {
    organization_id: organization.organization.id,
    lead_id: lead.lead.id,
    channel: "EMAIL",
    provider_event_id: "opt-out-signal-1",
    payload: { text: "Please stop contacting me, unsubscribe" }
  });

  assert.equal((await client.services.leadsRepository.getLead(lead.lead.id)).status, "OPTED_OUT", "contact policy applies before intelligence processing");
  await assertReplyRefreshPending(client, organization.organization.id, lead.lead.id, before.intelligence);
  await processPersistedReply(client, organization.organization.id, lead.lead.id);

  const after = await client.get(`/api/leads/${lead.lead.id}/intelligence?organization_id=${organization.organization.id}`);
  assert.ok(after.intelligence.signals.some((s) => s.type === "LEAD_OPTED_OUT"));
  assert.ok(after.intelligence.version > before.intelligence.version, "the worker must refresh an existing snapshot after opt-out");
  assert.deepEqual(recommendationStages, [], "opt-out refresh must not run synthesis or contact recommendation stages");
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

  await client.post("/api/worker/run", { organization_id: organization.organization.id });

  await client.post("/api/inbound-events/mock", {
    organization_id: organization.organization.id,
    lead_id: lead.lead.id,
    channel: "EMAIL",
    provider_event_id: "stable-1",
    payload: { text: "What does this cost?" }
  });
  await processPersistedReply(client, organization.organization.id, lead.lead.id);
  const first = await client.get(`/api/leads/${lead.lead.id}/intelligence?organization_id=${organization.organization.id}`);
  const second = await client.post(`/api/leads/${lead.lead.id}/intelligence/run`, {
    organization_id: organization.organization.id
  });

  assert.equal(second.intelligence.version, first.intelligence.version);
  assert.equal(second.intelligence.id, first.intelligence.id);
  assert.ok(first.intelligence.signals.some((signal) => signal.type === "LEAD_ASKED_QUESTION"));
  const again = await client.post("/api/worker/run", { organization_id: organization.organization.id });
  assert.deepEqual(again.processed_events, [], "an idle worker must not refresh the same reply again");
  const cached = await client.get(`/api/leads/${lead.lead.id}/intelligence?organization_id=${organization.organization.id}`);
  assert.equal(cached.intelligence.id, first.intelligence.id);
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

  await client.post("/api/worker/run", { organization_id: organization.organization.id });
  const before = await client.get(`/api/leads/${lead.lead.id}/intelligence?organization_id=${organization.organization.id}`);

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

  await assertReplyRefreshPending(client, organization.organization.id, lead.lead.id, before.intelligence);
  const event = await processPersistedReply(client, organization.organization.id, lead.lead.id);
  const snapshot = await client.get(`/api/leads/${lead.lead.id}/intelligence?organization_id=${organization.organization.id}`);
  assert.equal(snapshot.intelligence.version, before.intelligence.version + 1);
  assert.equal((await client.post("/api/inbound-events/mock", payload)).duplicate, true);
  const replayWorker = await client.post("/api/worker/run", { organization_id: organization.organization.id });
  assert.deepEqual(replayWorker.processed_events, []);
  const replay = await client.get(`/api/leads/${lead.lead.id}/intelligence?organization_id=${organization.organization.id}`);
  assert.equal(replay.intelligence.id, snapshot.intelligence.id);
  assert.equal(replay.intelligence.version, snapshot.intelligence.version);
  assert.equal((await client.db.get("SELECT attempts FROM domain_events WHERE id = ?", [event.id])).attempts, 1);
  assert.equal((await client.db.get("SELECT COUNT(*) AS count FROM inbound_events WHERE lead_id = ?", [lead.lead.id])).count, 1);
  assert.equal((await client.db.get("SELECT COUNT(*) AS count FROM channel_messages WHERE lead_id = ? AND direction = 'INBOUND'", [lead.lead.id])).count, 1);
});

test("an inbound reply makes the lead's existing recommendation stale, then the worker refreshes it", async (t) => {
  const client = await startClient(t);
  const { organization } = await client.register("Reply Reanalysis Org");
  const lead = (
    await client.post("/api/leads", {
      organization_id: organization.id,
      name: "Ananya Rao",
      email: "ananya@example.com",
      company: "Rao Furnishings",
      source: "MANUAL"
    })
  ).lead;

  // Drain the LeadCreated event first, exactly as the live server's interval
  // worker does within a few seconds of creation. Leaving it queued would mean
  // the later worker run in this test processes lead-creation side effects
  // instead of the reply.
  await client.post("/api/worker/run", { organization_id: organization.id });

  // Analyse the lead fully, so there is a recommendation for the reply to invalidate.
  await client.post("/api/intelligence/bulk-run", { organization_id: organization.id, lead_ids: [lead.id] });
  const before = await client.get(`/api/leads/${lead.id}/intelligence?organization_id=${organization.id}`);
  assert.equal(before.recommendation_status, "READY");
  const recommendationIdBefore = before.recommendation.id;

  // The lead replies with a question.
  await client.post("/api/inbound-events/mock", {
    organization_id: organization.id,
    lead_id: lead.id,
    channel: "EMAIL",
    provider_event_id: "reply-reanalysis-1",
    payload: { text: "What would a full living room fit-out cost?" }
  });

  // The persisted reply invalidates the old recommendation while snapshot and
  // recommendation rebuilding wait for the worker to consume LeadReplyReceived.
  const stale = await client.get(`/api/leads/${lead.id}/intelligence?organization_id=${organization.id}`);
  assert.notEqual(stale.recommendation_status, "READY", "the pre-reply recommendation must not still count as current");

  // The queued LeadReplyReceived event is what actually rebuilds it.
  await client.post("/api/worker/run", { organization_id: organization.id });

  const after = await client.get(`/api/leads/${lead.id}/intelligence?organization_id=${organization.id}`);
  assert.equal(after.recommendation_status, "READY", "the recommendation is regenerated against the reply");
  assert.notEqual(after.recommendation.id, recommendationIdBefore, "it is a NEW recommendation, not the old one");
  assert.equal(after.next_best_action_status, "PLANNED", "and a next best action is planned from it");

  // The reply is visible in the intelligence itself, not just in the inbox.
  // The reply is folded into the snapshot as an intent signal named after what
  // the lead did, not after the transport it arrived on.
  const signals = after.intelligence.signals.map((signal) => signal.type);
  assert.ok(
    signals.includes("LEAD_ASKED_QUESTION"),
    `the question reply should appear as a signal, got: ${signals.join(", ")}`
  );
});

test("re-analysis after a reply never creates an outbound action on its own", async (t) => {
  const client = await startClient(t);
  const { organization } = await client.register("Reply No Autosend Org");
  const lead = (
    await client.post("/api/leads", {
      organization_id: organization.id,
      name: "Vikram Shah",
      email: "vikram@example.com",
      company: "Shah Interiors",
      source: "MANUAL"
    })
  ).lead;
  await client.post("/api/worker/run", { organization_id: organization.id });
  await client.post("/api/intelligence/bulk-run", { organization_id: organization.id, lead_ids: [lead.id] });

  const actionsBefore = (await client.get(`/api/leads/${lead.id}/outbound?organization_id=${organization.id}`)).actions
    .length;

  await client.post("/api/inbound-events/mock", {
    organization_id: organization.id,
    lead_id: lead.id,
    channel: "EMAIL",
    provider_event_id: "reply-no-autosend-1",
    payload: { text: "Sounds good, let's talk" }
  });
  await client.post("/api/worker/run", { organization_id: organization.id });

  const actionsAfter = (await client.get(`/api/leads/${lead.id}/outbound?organization_id=${organization.id}`)).actions;
  assert.equal(
    actionsAfter.length,
    actionsBefore,
    "planning is an opinion; turning a plan into a queued message stays a human decision"
  );
});

test("an opted-out lead is not re-analysed into a fresh reason to contact them", async (t) => {
  const client = await startClient(t);
  const { organization } = await client.register("Reply Opt Out Org");
  const lead = (
    await client.post("/api/leads", {
      organization_id: organization.id,
      name: "Neha Gupta",
      email: "neha@example.com",
      company: "Gupta Homes",
      source: "MANUAL"
    })
  ).lead;
  await client.post("/api/worker/run", { organization_id: organization.id });
  await client.post("/api/intelligence/bulk-run", { organization_id: organization.id, lead_ids: [lead.id] });

  await client.post("/api/inbound-events/mock", {
    organization_id: organization.id,
    lead_id: lead.id,
    channel: "EMAIL",
    provider_event_id: "reply-opt-out-1",
    payload: { text: "Please unsubscribe me" }
  });
  await client.post("/api/worker/run", { organization_id: organization.id });

  const leadAfter = await client.get(`/api/leads/${lead.id}?organization_id=${organization.id}`);
  assert.equal(leadAfter.lead.status, "OPTED_OUT");

  const after = await client.get(`/api/leads/${lead.id}/intelligence?organization_id=${organization.id}`);
  assert.notEqual(
    after.next_best_action_status,
    "PLANNED",
    "an opted-out lead must not come back with a planned next action"
  );

  const audit = await client.get(`/api/activity/feed?organization_id=${organization.id}`);
  const records = await client.db.all("SELECT * FROM audit_logs WHERE organization_id = ? AND lead_id = ? AND event_type = 'LeadIntelligenceUpdated'", [organization.id, lead.id]);
  const skipped = records.find((record) => {
    const metadata = JSON.parse(record.metadata_json);
    return metadata.lead_status === "OPTED_OUT" && metadata.stages?.includes("snapshot");
  });
  assert.ok(skipped, "the completed policy snapshot and recommendation skip must be recorded");
  assert.match(skipped.message, /skipped contact recommendations/i);
  const visible = audit.events.find((event) => event.lead_id === lead.id && event.event_type === "LeadIntelligenceUpdated"
    && event.metadata?.lead_status === "OPTED_OUT" && event.metadata?.stages?.includes("snapshot"));
  assert.ok(visible, "the policy-stage skip must remain visible in the activity feed");
  assert.equal(visible.message, skipped.message);
  assert.deepEqual(visible.metadata.stages, ["snapshot"]);
});

test("a duplicate inbound reply does not queue a second re-analysis", async (t) => {
  const client = await startClient(t);
  const { organization } = await client.register("Reply Idempotency Org");
  const lead = (
    await client.post("/api/leads", {
      organization_id: organization.id,
      name: "Imran Qureshi",
      email: "imran@example.com",
      source: "MANUAL"
    })
  ).lead;

  const send = () =>
    client.post("/api/inbound-events/mock", {
      organization_id: organization.id,
      lead_id: lead.id,
      channel: "EMAIL",
      provider_event_id: "reply-duplicate-1",
      payload: { text: "How much does it cost?" }
    });

  const first = await send();
  const second = await send();
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true, "the same provider event id is the idempotency key");

  const queued = await client.db.all("SELECT * FROM domain_events WHERE type = ? AND lead_id = ?", [
    "LeadReplyReceived",
    lead.id
  ]);
  assert.equal(queued.length, 1, "a redelivered webhook must not cause the lead to be re-analysed twice");
});
