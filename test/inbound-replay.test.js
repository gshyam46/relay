import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";
import { createDatabase } from "../src/database/database.js";
import { LeadsRepository } from "../src/modules/data-foundation/leadsRepository.js";
import { ActionsRepository } from "../src/modules/outbound-automation/actionsRepository.js";
import { ContactPolicyService } from "../src/modules/contact-policy/contactPolicyService.js";
import { InboundMessageService } from "../src/modules/channels/inboundMessageService.js";
import { LocalReplyClassifier } from "../src/modules/channels/replyClassifier.js";
import { WebhookInboxService } from "../src/modules/webhook-inbox/webhookInboxService.js";
import { applySendgridConflictPolicyInTransaction, applySendgridEvent, normalizeSendgridEventReceipt, normalizeSendgridInbound } from "../src/modules/channels/sendgridEvents.js";

async function fixture(t) {
  const db = await createDatabase(":memory:"); t.after(() => db.close());
  const leads = new LeadsRepository(db);
  const organization = await leads.createOrganization({ name: "Inbound replay fixture" });
  const lead = await leads.createLead({ organization_id: organization.id, name: "Synthetic contact", email: "person@example.com" });
  const policy = new ContactPolicyService(db);
  let clock = Date.parse("2026-09-11T10:00:00.000Z"), calls = 0;
  const classifier = { classify: (text) => { calls++; return new LocalReplyClassifier().classify(text); } };
  let service, inbox;
  const services = { actionsRepository: new ActionsRepository(db), contactPolicyService: policy };
  const restart = () => {
    inbox = new WebhookInboxService({ db, contactPolicyService: policy, now: () => clock, random: () => 0 });
    service = new InboundMessageService({ db, contactPolicyService: policy, replyClassifier: classifier, webhookInbox: inbox });
    inbox.handlers.INBOUND_MESSAGE = (input, context) => service.applyInboundMessage(input, context);
    inbox.handlers.SENDGRID_EVENT = (input, context) => applySendgridEvent(services, organization.id, input, context);
    inbox.policyHandlers.INBOUND_MESSAGE = (tx, input, context) => service.applyConflictPolicyInTransaction(tx, organization.id, input, context);
    inbox.policyHandlers.SENDGRID_EVENT = (tx, input, context) => applySendgridConflictPolicyInTransaction(services, tx, organization.id, input, context);
    services.webhookInbox = inbox;
  };
  restart();
  const input = { organization_id: organization.id, lead_id: lead.id, channel: "EMAIL", provider: "fixture", provider_event_id: "reply-1", payload: { text: "Can you explain the delivery options?" } };
  const receive = (overrides = {}) => service.receiveInboundEvent({ ...input, ...overrides });
  const count = async (table, where = "") => Number((await db.get("SELECT COUNT(*) AS count FROM " + table + (where ? " WHERE " + where : ""))).count);
  const replay = async () => { clock += 6000; return inbox.processDue({ organization_id: organization.id }); };
  return { db, leads, lead, organization, policy, services, receive, replay, restart, count, input, get inbox() { return inbox; }, get service() { return service; }, calls: () => calls };
}

test("inbound replay after final outbox failure uses one canonical classification and atomically repairs all effects", async (t) => {
  const f = await fixture(t);
  await f.db.exec("CREATE TRIGGER fail_reply BEFORE INSERT ON domain_events WHEN NEW.type = 'LeadReplyReceived' BEGIN SELECT RAISE(ABORT, 'synthetic reply event failure'); END");
  await assert.rejects(f.receive(), { statusCode: 503 });
  assert.equal(f.calls(), 1);
  assert.equal((await f.db.get("SELECT effects_status FROM inbound_events")).effects_status, "PENDING");
  assert.equal(await f.count("channel_messages"), 0);
  assert.equal(await f.count("follow_up_tasks"), 0);
  assert.equal(await f.count("audit_logs", "event_type = 'InboundEventReceived'"), 0);
  await f.db.exec("DROP TRIGGER fail_reply");
  f.restart(); await f.replay();
  assert.equal(f.calls(), 1);
  assert.equal(await f.count("channel_messages"), 1);
  assert.equal(await f.count("follow_up_tasks"), 1);
  assert.equal(await f.count("domain_events", "type = 'LeadReplyReceived'"), 1);
  assert.equal((await f.db.get("SELECT effects_status FROM inbound_events")).effects_status, "DONE");
  const duplicate = await f.receive();
  assert.equal(duplicate.duplicate, true); assert.equal(duplicate.message.body, f.input.payload.text);
  assert.equal(await f.count("domain_events", "type = 'LeadReplyReceived'"), 1);
});

test("new sender opt-out and LeadCreated survive a later message failure and replay creates one reply", async (t) => {
  const f = await fixture(t);
  const input = { lead_id: null, contact: { email: "new@example.com", name: "New sender" }, payload: { text: "Please unsubscribe me." } };
  await f.db.exec("CREATE TRIGGER fail_message BEFORE INSERT ON channel_messages BEGIN SELECT RAISE(ABORT, 'synthetic message failure'); END");
  await assert.rejects(f.receive(input), { statusCode: 503 });
  const captured = await f.leads.findByNormalizedEmail(f.organization.id, "new@example.com");
  assert.equal(captured.status, "OPTED_OUT");
  assert.equal((await f.policy.inspectLead({ organization_id: f.organization.id, lead_id: captured.id, channel: "EMAIL" })).restricted, true);
  assert.equal(await f.count("domain_events", "type = 'LeadCreated'"), 1);
  assert.equal(await f.count("channel_messages"), 0); assert.equal(f.calls(), 0);
  await f.db.exec("DROP TRIGGER fail_message"); await f.replay();
  assert.equal(await f.count("domain_events", "type = 'LeadCreated'"), 1);
  assert.equal(await f.count("domain_events", "type = 'LeadReplyReceived'"), 1);
  assert.equal(await f.count("channel_messages"), 1);
  assert.equal(await f.count("follow_up_tasks"), 0);
});

test("first-stage lead provenance failure rolls back lead and domain receipt while retaining inbox input", async (t) => {
  const f = await fixture(t);
  await f.db.exec("CREATE TRIGGER fail_lead_audit BEFORE INSERT ON audit_logs WHEN NEW.event_type = 'LeadCreated' BEGIN SELECT RAISE(ABORT, 'synthetic lead audit failure'); END");
  await assert.rejects(f.receive({ lead_id: null, contact: { email: "new@example.com" } }), { statusCode: 503 });
  assert.equal(await f.count("leads"), 1); assert.equal(await f.count("inbound_events"), 0);
  assert.equal(await f.count("domain_events"), 0); assert.equal(await f.count("webhook_receipts"), 1);
  await f.db.exec("DROP TRIGGER fail_lead_audit"); await f.replay();
  assert.equal(await f.count("leads"), 2); assert.equal(await f.count("domain_events", "type = 'LeadCreated'"), 1);
});

test("ambiguous duplicate contact is quarantined but an explicit sender opt-out still restricts both leads", async (t) => {
  const f = await fixture(t);
  const other = await f.leads.createLead({ organization_id: f.organization.id, name: "Duplicate", email: f.lead.email });
  await assert.rejects(f.receive({ lead_id: null, contact: { email: f.lead.email }, payload: { text: "Stop contacting me." } }), { statusCode: 409 });
  const receipt = await f.db.get("SELECT * FROM webhook_receipts");
  assert.equal(receipt.processing_state, "QUARANTINED"); assert.equal(receipt.mandatory_policy_status, "DONE");
  for (const lead of [f.lead, other]) assert.equal((await f.policy.inspectLead({ organization_id: f.organization.id, lead_id: lead.id, channel: "EMAIL" })).restricted, true);
  assert.equal(await f.count("inbound_events"), 0); assert.equal(await f.count("leads"), 2);
});

test("replay after lead email edit keeps original message, sender restriction and canonical interpretation", async (t) => {
  const f = await fixture(t);
  const input = { contact: { email: f.lead.email }, payload: { text: "Please stop." } };
  await f.db.exec("CREATE TRIGGER fail_message BEFORE INSERT ON channel_messages BEGIN SELECT RAISE(ABORT, 'message failure'); END");
  await assert.rejects(f.receive(input), { statusCode: 503 });
  await f.db.run("UPDATE leads SET email = ?, normalized_email = ? WHERE id = ?", ["changed@example.com", "changed@example.com", f.lead.id]);
  await f.db.exec("DROP TRIGGER fail_message"); await f.replay();
  const event = await f.db.get("SELECT * FROM inbound_events");
  assert.equal(JSON.parse(event.payload_json)._ingress_contact.email, "person@example.com");
  assert.equal((await f.db.get("SELECT body FROM channel_messages")).body, "Please stop.");
  assert.equal(await f.count("contact_restrictions", "contact_value = 'person@example.com'"), 1);
});

test("Parse canonical fallback ignores multipart boundaries but keeps missing identity quarantined and stop durable", async (t) => {
  const f = await fixture(t);
  const fields = { from: "New Sender <new@example.com>", to: "replies@example.net", text: "Please unsubscribe me.", headers: "Date: Fri, 11 Sep 2026 10:00:00 +0000" };
  const first = normalizeSendgridInbound({ ...fields, boundary: "one" }, { organization_id: f.organization.id });
  const second = normalizeSendgridInbound({ ...fields, boundary: "two" }, { organization_id: f.organization.id });
  assert.equal(first.provider_event_id, second.provider_event_id); assert.equal(first.identity_error, "MISSING_MESSAGE_ID");
  await assert.rejects(f.service.receiveInboundEvent(first), { statusCode: 400 });
  assert.equal(await f.count("leads"), 1); assert.equal(await f.count("inbound_events"), 0);
  const receipt = await f.db.get("SELECT * FROM webhook_receipts");
  assert.equal(receipt.processing_state, "QUARANTINED"); assert.equal(receipt.mandatory_policy_status, "DONE");
  assert.equal(await f.count("contact_restrictions", "contact_value = 'new@example.com'"), 1);
  assert.equal(normalizeSendgridInbound({ ...fields, headers: fields.headers + "\r\nMessage-ID: <one@example.com>\r\nMessage-ID: <two@example.com>" }, { organization_id: f.organization.id }).identity_error, "AMBIGUOUS_MESSAGE_ID");
});

test("SendGrid tracking audit is atomic with receipt completion and repeated receipt adds no audit", async (t) => {
  const f = await fixture(t);
  const action = await f.services.actionsRepository.createAction({ organization_id: f.organization.id, lead_id: f.lead.id, type: "SEND_EMAIL", status: "PROPOSED", idempotency_key: "tracking", payload: {} });
  const event = { event: "open", sg_event_id: "tracking-1", relay_action_id: action.id, email: f.lead.email };
  await f.db.exec("CREATE TRIGGER fail_tracking BEFORE INSERT ON audit_logs WHEN NEW.event_type = 'EmailTrackingEvent' BEGIN SELECT RAISE(ABORT, 'tracking failure'); END");
  await assert.rejects(applySendgridEvent(f.services, f.organization.id, event), { statusCode: 503 });
  assert.equal(await f.count("audit_logs", "event_type = 'EmailTrackingEvent'"), 0);
  await f.db.exec("DROP TRIGGER fail_tracking"); await f.replay();
  await applySendgridEvent(f.services, f.organization.id, event);
  assert.equal(await f.count("audit_logs", "event_type = 'EmailTrackingEvent'"), 1);
  assert.equal((await f.db.get("SELECT processing_state FROM webhook_receipts")).processing_state, "PROCESSED");
});

test("malformed SendGrid event identity retains whitelist evidence and applies recipient restriction before quarantine", async (t) => {
  const f = await fixture(t);
  const event = { event: "unsubscribe", email: f.lead.email, unknown_secret: "never retain this" };
  const normalized = normalizeSendgridEventReceipt(event);
  assert.equal(normalized.payload.unknown_secret, undefined); assert.equal(normalized.payload.normalization_error, "SENDGRID_EVENT_ID_INVALID");
  await assert.rejects(applySendgridEvent(f.services, f.organization.id, event), { statusCode: 400 });
  assert.equal((await f.policy.inspectLead({ organization_id: f.organization.id, lead_id: f.lead.id, channel: "EMAIL" })).restricted, true);
  assert.equal((await f.db.get("SELECT mandatory_policy_status FROM webhook_receipts")).mandatory_policy_status, "DONE");
});


test("concurrent inbound receipt processors create one lead, message, classification receipt and reply event", async (t) => {
  const f = await fixture(t);
  await Promise.all([f.receive({ lead_id: null, contact: { email: "new@example.com" } }), f.receive({ lead_id: null, contact: { email: "new@example.com" } })]);
  assert.equal(await f.count("leads"), 2); assert.equal(await f.count("inbound_events"), 1);
  assert.equal(await f.count("channel_messages"), 1); assert.equal(await f.count("domain_events", "type = 'LeadReplyReceived'"), 1);
  assert.equal(await f.count("domain_events", "type = 'LeadCreated'"), 1);
});

test("legacy unlinked inbound receipt is quarantined without synthesizing old conversation effects", async (t) => {
  const f = await fixture(t);
  const { InboundEventsRepository } = await import("../src/modules/channels/inboundEventsRepository.js");
  await new InboundEventsRepository(f.db).create({ ...f.input, event_type: "QUESTION" });
  await assert.rejects(f.receive(), { code: "LEGACY_REVIEW_REQUIRED" });
  assert.equal((await f.db.get("SELECT effects_status, webhook_receipt_id FROM inbound_events")).effects_status, "LEGACY_UNKNOWN");
  assert.equal(await f.count("channel_messages"), 0); assert.equal(await f.count("domain_events"), 0);
  const row = await f.db.get("SELECT id FROM webhook_receipts");
  assert.equal((await f.inbox.inspect({ organization_id: f.organization.id, receipt_id: row.id })).can_close, true);
});

test("effects DONE replay after inbox completion failure does not repeat lifecycle or cancel later work", async (t) => {
  const f = await fixture(t);
  await f.db.exec("CREATE TRIGGER fail_inbox_done BEFORE UPDATE OF processing_state ON webhook_receipts WHEN NEW.processing_state = 'PROCESSED' BEGIN SELECT RAISE(ABORT, 'inbox completion failure'); END");
  const input = { event_type: "POSITIVE_REPLY", payload: { text: "Sounds good." } };
  await assert.rejects(f.receive(input), { statusCode: 503 });
  assert.equal((await f.db.get("SELECT effects_status FROM inbound_events")).effects_status, "DONE");
  await f.db.run("UPDATE leads SET status = 'NEW' WHERE id = ?", [f.lead.id]);
  const { FollowUpsRepository } = await import("../src/modules/channels/followUpsRepository.js");
  const followUps = new FollowUpsRepository(f.db);
  const later = await followUps.create({ organization_id: f.organization.id, lead_id: f.lead.id, channel: "EMAIL", status: "DUE", due_at: "2026-09-11T10:10:00.000Z", reason: "Later operator task", idempotency_key: "later-manual-task" });
  await f.db.exec("DROP TRIGGER fail_inbox_done"); await f.replay();
  assert.equal((await f.leads.getLead(f.lead.id)).status, "NEW");
  assert.equal((await followUps.getForOrganization(later.id, f.organization.id)).status, "DUE");
  assert.equal(await f.count("channel_messages"), 1); assert.equal(await f.count("domain_events", "type = 'LeadReplyReceived'"), 1);
});

test("same Parse Message-ID with changed canonical recipient creates quarantine evidence rather than replacing the receipt", async (t) => {
  const f = await fixture(t);
  const fields = { from: "person@example.com", to: "replies@example.net", text: "Can you explain the options?", headers: "Message-ID: <stable@example.com>" };
  const first = normalizeSendgridInbound(fields, { organization_id: f.organization.id });
  await f.service.receiveInboundEvent(first);
  const changed = normalizeSendgridInbound({ ...fields, to: "different@example.net" }, { organization_id: f.organization.id });
  await assert.rejects(f.service.receiveInboundEvent(changed), { code: "RECEIPT_IDENTITY_CONFLICT" });
  assert.equal(await f.count("inbound_events"), 1); assert.equal(await f.count("channel_messages"), 1);
  assert.equal(await f.count("webhook_receipts", "processing_state = 'QUARANTINED'"), 1);
});


test("oversized Parse body retains bounded evidence and explicit opt-out beyond the retained preview", async (t) => {
  const f = await fixture(t);
  const normalized = normalizeSendgridInbound({ from: "person@example.com", to: "replies@example.net", text: "x".repeat(33000) + " Please unsubscribe me.", headers: "Message-ID: <oversized@example.com>" }, { organization_id: f.organization.id });
  assert.equal(normalized.identity_error, "INBOUND_CONTENT_TOO_LARGE"); assert.equal(normalized.event_type, "OPT_OUT");
  assert.equal(normalized.payload.text.length, 32768);
  await assert.rejects(f.service.receiveInboundEvent(normalized), { statusCode: 400 });
  assert.equal((await f.policy.inspectLead({ organization_id: f.organization.id, lead_id: f.lead.id, channel: "EMAIL" })).restricted, true);
  assert.equal(await f.count("inbound_events"), 0);
});

test("conflicting Parse sender identities stay quarantined without restricting an arbitrarily chosen mailbox", async (t) => {
  const f = await fixture(t);
  const normalized = normalizeSendgridInbound({ from: "person@example.com", text: "Please stop.", envelope: JSON.stringify({ from: "other@example.com", to: ["replies@example.net"] }), headers: "Message-ID: <conflicting@example.com>" }, { organization_id: f.organization.id });
  assert.equal(normalized.identity_error, "INBOUND_SENDER_CONFLICT"); assert.equal(normalized.contact, null);
  await assert.rejects(f.service.receiveInboundEvent(normalized), { statusCode: 400 });
  assert.equal(await f.count("contact_restrictions"), 0);
  assert.equal((await f.db.get("SELECT mandatory_policy_status FROM webhook_receipts")).mandatory_policy_status, "PENDING");
});


test("conflicting same-workspace action references quarantine delivery while preserving actual recipient unsubscribe", async (t) => {
  const f = await fixture(t);
  const actions = [];
  for (const suffix of ["one", "two"]) actions.push(await f.services.actionsRepository.createAction({ organization_id: f.organization.id, lead_id: f.lead.id, type: "SEND_EMAIL", status: "APPROVED", idempotency_key: "conflict-" + suffix, payload: {} }));
  await assert.rejects(applySendgridEvent(f.services, f.organization.id, { event: "unsubscribe", sg_event_id: "conflicting-own", email: f.lead.email, relay_action_id: actions[0].id, custom_args: { relay_action_id: actions[1].id } }), { statusCode: 400 });
  assert.equal((await f.policy.inspectLead({ organization_id: f.organization.id, lead_id: f.lead.id, channel: "EMAIL" })).restricted, true);
  assert.equal(await f.count("callbacks"), 0);
  const receipt = await f.db.get("SELECT processing_state, mandatory_policy_status FROM webhook_receipts");
  assert.equal(receipt.processing_state, "QUARANTINED"); assert.equal(receipt.mandatory_policy_status, "DONE");
});

test("duplicate Parse form identity fields cannot select an arbitrary sender for opt-out", async (t) => {
  const f = await fixture(t);
  const normalized = normalizeSendgridInbound({ from: "person@example.com", text: "Please unsubscribe me.", headers: "Message-ID: <form-conflict@example.com>", __duplicate_identity_fields: ["from"] }, { organization_id: f.organization.id });
  assert.equal(normalized.identity_error, "INBOUND_IDENTITY_AMBIGUOUS"); assert.equal(normalized.contact, null);
  await assert.rejects(f.service.receiveInboundEvent(normalized), { statusCode: 400 });
  assert.equal(await f.count("contact_restrictions"), 0); assert.equal(await f.count("inbound_events"), 0);
});


test("a delivery event with missing action correlation is quarantined but closable when no policy applies", async (t) => {
  const f = await fixture(t);
  await assert.rejects(applySendgridEvent(f.services, f.organization.id, { event: "delivered", sg_event_id: "missing-action-delivery", relay_action_id: "missing-action", relay_execution_id: "missing-execution", relay_revision_id: "missing-revision", email: f.lead.email }), { statusCode: 404 });
  const row = await f.db.get("SELECT id FROM webhook_receipts");
  const receipt = await f.inbox.inspect({ organization_id: f.organization.id, receipt_id: row.id });
  assert.equal(receipt.processing_state, "QUARANTINED"); assert.equal(receipt.mandatory_policy_status, "DONE"); assert.equal(receipt.can_close, true);
  assert.equal((await f.policy.inspectLead({ organization_id: f.organization.id, lead_id: f.lead.id, channel: "EMAIL" })).restricted, false);
  assert.equal(await f.count("callbacks"), 0);
});

test("legacy inbound opt-out applies only valid policy and remains closable without replaying unknown historical effects", async (t) => {
  const f = await fixture(t);
  const { InboundEventsRepository } = await import("../src/modules/channels/inboundEventsRepository.js");
  const input = { ...f.input, event_type: "OPT_OUT", payload: { text: "Please stop." } };
  await new InboundEventsRepository(f.db).create(input);
  await assert.rejects(f.service.receiveInboundEvent(input), { code: "LEGACY_REVIEW_REQUIRED" });
  const row = await f.db.get("SELECT id FROM webhook_receipts");
  const receipt = await f.inbox.inspect({ organization_id: f.organization.id, receipt_id: row.id });
  assert.equal(receipt.can_close, true);
  assert.equal((await f.policy.inspectLead({ organization_id: f.organization.id, lead_id: f.lead.id, channel: "EMAIL" })).restricted, true);
  assert.equal(await f.count("channel_messages"), 0); assert.equal(await f.count("domain_events"), 0);
  assert.equal((await f.db.get("SELECT effects_status FROM inbound_events")).effects_status, "LEGACY_UNKNOWN");
});


test("a question waits for unrelated pending policy and creates its human task once processing resumes", async (t) => {
  const f = await fixture(t);
  const held = await f.inbox.receive({ organization_id: f.organization.id, provider: "sendgrid", connection_key: "channel_email", event_kind: "SENDGRID_EVENT", provider_event_id: "unrelated-policy", verification_kind: "TRUSTED_INTERNAL", input: { event: "unsubscribe", sg_event_id: "unrelated-policy", email: "unrelated@example.net" } });
  await assert.rejects(f.receive(), { code: "POLICY_EFFECT_PENDING", statusCode: 503 });
  assert.equal((await f.db.get("SELECT effects_status FROM inbound_events")).effects_status, "PENDING");
  assert.equal(await f.count("channel_messages"), 0); assert.equal(await f.count("follow_up_tasks"), 0);
  assert.equal(await f.count("domain_events", "type = 'LeadReplyReceived'"), 0);
  await f.inbox.processReceipt({ organization_id: f.organization.id, receipt_id: held.row.id });
  await f.replay();
  assert.equal((await f.db.get("SELECT effects_status FROM inbound_events")).effects_status, "DONE");
  assert.equal(await f.count("channel_messages"), 1); assert.equal(await f.count("follow_up_tasks"), 1);
  assert.equal((await f.db.get("SELECT status FROM follow_up_tasks")).status, "DUE");
  assert.equal(await f.count("domain_events", "type = 'LeadReplyReceived'"), 1);
  await f.receive(); assert.equal(await f.count("follow_up_tasks"), 1);
});

for (const replyType of ["QUESTION", "UNKNOWN"]) {
  test(replyType + " stops an approved sequence before dispatch and preserves human response tasks across replay", async (t) => {
    const client = await startClient(t);
    const { organization } = await client.register("Reply stops sequence");
    const { lead } = await client.post("/api/leads", { name: "Synthetic replying contact", email: "reply-sequence@example.test" });
    const { services, db } = client;
    let clock = Date.now();
    services.actionExecutor.now = () => clock; services.webhookInbox.now = () => clock;
    const scope = { organization_id: organization.id }, workflows = services.workflowsService;
    const { campaign } = await workflows.createCampaign({ ...scope, name: "Synthetic follow-up" });
    const { sequence } = await workflows.createSequence({ ...scope, campaign_id: campaign.id, name: "Two reviewed emails", steps: [
      { type: "SEND_EMAIL", title: "Initial contact", body: "Review this introduction.", requires_approval: true },
      { type: "SEND_EMAIL", title: "Later contact", body: "Review this later message.", requires_approval: true }
    ] });
    const run = (await workflows.enrollLeads({ ...scope, sequence_id: sequence.id, lead_ids: [lead.id] })).workflow_runs[0];
    await workflows.runDue(scope);
    const waiting = await services.workflowsRepository.getRunForOrganization(run.id, organization.id);
    const queued = await services.actionsRepository.getAction(waiting.last_action_id);
    await client.approve(queued.id); await workflows.runDue(scope);
    assert.equal((await services.actionsRepository.getAction(queued.id)).status, "APPROVED");
    const { FollowUpsRepository } = await import("../src/modules/channels/followUpsRepository.js");
    const followUps = new FollowUpsRepository(db);
    const manual = await followUps.create({ ...scope, lead_id: lead.id, channel: "EMAIL", status: "DUE", due_at: new Date(clock).toISOString(),
      reason: "Keep the existing human review", idempotency_key: "unrelated-human-review" });
    const input = { ...scope, lead_id: lead.id, channel: "EMAIL", provider: "synthetic-reply", provider_event_id: "reply:" + replyType,
      event_type: replyType, payload: { text: replyType === "QUESTION" ? "Can you explain the options?" : "Acknowledged." } };
    if (replyType === "UNKNOWN") {
      await db.exec("CREATE TRIGGER fail_sequence_reply BEFORE INSERT ON domain_events WHEN NEW.type='LeadReplyReceived' BEGIN SELECT RAISE(ABORT,'synthetic reply outbox failure'); END");
      await assert.rejects(services.channelWorkflowService.receiveInboundEvent(input), { statusCode: 503 });
      assert.equal((await db.get("SELECT effects_status FROM inbound_events WHERE provider_event_id=?", [input.provider_event_id])).effects_status, "PENDING");
    } else await services.channelWorkflowService.receiveInboundEvent(input);
    const stopped = await services.workflowsRepository.getRunForOrganization(run.id, organization.id);
    assert.equal(stopped.status, "STOPPED");
    assert.equal(stopped.stop_reason, replyType === "QUESTION" ? "Lead asked a question. A follow-up is due." : "Inbound response needs review.");
    const blocked = await services.actionsRepository.getAction(queued.id);
    assert.equal(blocked.status, "BLOCKED"); assert.equal(blocked.execution_hold_reason, "WORKFLOW_STOPPED");
    let providerCalls = 0;
    services.actionExecutor.adapter = { invoke: async () => { providerCalls++; throw new Error("Unexpected provider request"); } };
    assert.notEqual((await services.actionExecutor.execute(queued)).dispatched, true);
    assert.equal(providerCalls, 0);
    assert.equal((await db.get("SELECT COUNT(*) AS n FROM action_executions WHERE action_id=?", [queued.id])).n, 0);
    assert.equal((await followUps.getForOrganization(manual.id, organization.id)).status, "DUE");
    if (replyType === "UNKNOWN") {
      await db.exec("DROP TRIGGER fail_sequence_reply"); clock += 6000;
      await services.webhookInbox.processDue({ ...scope, limit: 2 });
    }
    await services.channelWorkflowService.receiveInboundEvent(input);
    const tasks = await followUps.listForLead(organization.id, lead.id);
    const humanResponse = tasks.filter((task) => task.inbound_event_id);
    assert.equal(humanResponse.length, 1); assert.equal(humanResponse[0].status, "DUE");
    assert.equal((await followUps.getForOrganization(manual.id, organization.id)).status, "DUE");
    assert.equal((await services.leadsRepository.getLead(lead.id)).status, "ACTIVE");
    assert.equal((await services.contactPolicyService.inspectLead({ ...scope, lead_id: lead.id, channel: "EMAIL" })).restricted, false);
    assert.equal((await workflows.runDue({ ...scope, due_at: new Date(clock + 86400000).toISOString() })).processed_runs.length, 0);
    assert.equal((await db.get("SELECT COUNT(*) AS n FROM actions WHERE workflow_run_id=?", [run.id])).n, 1);
    assert.equal((await services.workflowsRepository.getRunForOrganization(run.id, organization.id)).revision, stopped.revision);
    assert.equal(providerCalls, 0);
  });
}
