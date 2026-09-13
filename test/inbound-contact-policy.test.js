import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database/database.js";
import { LeadsRepository } from "../src/modules/data-foundation/leadsRepository.js";
import { ContactPolicyService } from "../src/modules/contact-policy/contactPolicyService.js";
import { ChannelWorkflowService } from "../src/modules/channels/channelWorkflowService.js";
import { LocalReplyClassifier } from "../src/modules/channels/replyClassifier.js";
import { ChannelMessagesRepository } from "../src/modules/channels/channelMessagesRepository.js";
import { InboundEventsRepository } from "../src/modules/channels/inboundEventsRepository.js";
import { FollowUpsRepository } from "../src/modules/channels/followUpsRepository.js";
import { ActionsRepository } from "../src/modules/outbound-automation/actionsRepository.js";
import { ExecutionsRepository } from "../src/modules/outbound-automation/executionsRepository.js";
import { PreparedActionService } from "../src/modules/outbound-automation/preparedActionService.js";
import { CallbacksRepository } from "../src/modules/outbound-automation/callbacksRepository.js";
import { CallbacksService } from "../src/modules/outbound-automation/callbacksService.js";
import { EventsRepository } from "../src/modules/events/eventsRepository.js";
import { AuditRepository } from "../src/modules/events/auditRepository.js";
import { WebhookInboxService } from "../src/modules/webhook-inbox/webhookInboxService.js";
import { applySendgridConflictPolicyInTransaction, applySendgridEvent, normalizeSendgridEvent } from "../src/modules/channels/sendgridEvents.js";

async function fixture(t) {
  const db = await createDatabase(":memory:");
  t.after(() => db.close());
  const leadsRepository = new LeadsRepository(db);
  const organization = await leadsRepository.createOrganization({ name: "Inbound policy fixture" });
  const otherOrganization = await leadsRepository.createOrganization({ name: "Other policy fixture" });
  const createLead = (email = "person@example.com", organization_id = organization.id) =>
    leadsRepository.createLead({ organization_id, name: "Synthetic contact", email, phone: "+14155550123" });
  const lead = await createLead();
  const contactPolicyService = new ContactPolicyService(db);
  const actionsRepository = new ActionsRepository(db);
  const executionsRepository = new ExecutionsRepository(db);
  const callbacksRepository = new CallbacksRepository(db);
  const channelMessagesRepository = new ChannelMessagesRepository(db);
  const inboundEventsRepository = new InboundEventsRepository(db);
  const followUpsRepository = new FollowUpsRepository(db);
  const eventsRepository = new EventsRepository(db);
  const auditRepository = new AuditRepository(db);
  const channelWorkflowService = new ChannelWorkflowService({
    leadsRepository, actionsRepository, channelMessagesRepository, inboundEventsRepository,
    followUpsRepository, eventsRepository, auditRepository, contactPolicyService,
    replyClassifier: new LocalReplyClassifier()
  });
  const callbacksService = new CallbacksService({
    callbacksRepository, actionsRepository, executionsRepository, leadsRepository,
    eventsRepository, auditRepository, channelWorkflowService
  });
  const services = { leadsRepository, contactPolicyService, actionsRepository, executionsRepository,
    callbacksRepository, channelMessagesRepository, inboundEventsRepository, followUpsRepository,
    eventsRepository, auditRepository, channelWorkflowService, callbacksService };
  let inboxClock = Date.now();
  const webhookInbox = new WebhookInboxService({ db, contactPolicyService, now: () => inboxClock, random: () => 0 });
  webhookInbox.handlers.INBOUND_MESSAGE = (input, context) => channelWorkflowService.inboundMessageService.applyInboundMessage(input, context);
  webhookInbox.handlers.EXECUTION_CALLBACK = (input, context) => callbacksService.applyExecutionCallback(input, context);
  webhookInbox.handlers.SENDGRID_EVENT = (input, context) => applySendgridEvent(services, organization.id, input, context);
  webhookInbox.policyHandlers.INBOUND_MESSAGE = (tx, input, context) => channelWorkflowService.inboundMessageService.applyConflictPolicyInTransaction(tx, organization.id, input, context);
  webhookInbox.policyHandlers.SENDGRID_EVENT = (tx, input, context) => applySendgridConflictPolicyInTransaction(services, tx, organization.id, input, context);
  channelWorkflowService.webhookInbox = webhookInbox;
  channelWorkflowService.inboundMessageService.webhookInbox = webhookInbox;
  callbacksService.webhookInbox = webhookInbox; services.webhookInbox = webhookInbox;
  const advanceInbox = () => { inboxClock += 6000; };
  let actionCount = 0;
  const createAction = (target = lead, type = "SEND_EMAIL") => actionsRepository.createAction({
    organization_id: target.organization_id, lead_id: target.id, type,
    idempotency_key: "inbound-fixture-action-" + (++actionCount), status: "APPROVED",
    payload: { subject: "Synthetic reviewed subject", body: "Synthetic reviewed message" }
  });
  const createAttempt = (action, { provider = "sendgrid", outcome_class = "ACCEPTED", newRevision = false } = {}) =>
    contactPolicyService.withWorkspacePolicyTransaction(action.organization_id, async (tx) => {
      const actions = new ActionsRepository(tx);
      const executions = new ExecutionsRepository(tx);
      const current = await actions.getActionForOrganization(action.id, action.organization_id);
      const reviewable = { ...current, status: "APPROVED" };
      const prepared = new PreparedActionService(tx);
      const existing = await prepared.repository.current(reviewable);
      const revision = await prepared.prepare(reviewable, newRevision && existing
        ? { forceNew: true, expected_revision_id: existing.id } : {});
      const attempt = await executions.nextAttempt(action.id);
      const execution = await executions.createExecution({
        action_id: action.id, status: ["DELIVERED"].includes(outcome_class) ? "COMPLETED"
          : ["DELIVERY_FAILED", "CLOSED_UNRESOLVED"].includes(outcome_class) ? "FAILED" : "STARTED",
        attempt, provider, idempotency_key: action.id + ":fixture-attempt:" + attempt,
        action_revision_id: revision.id, envelope_hash: revision.content_hash, fence_token: attempt,
        outcome_class, lease_owner: "fixture", lease_expires_at: "2020-01-01T00:00:00.000Z"
      });
      await tx.run("UPDATE actions SET active_execution_id = ?, execution_fence = ?, status = 'EXECUTING' WHERE id = ?",
        [execution.id, execution.fence_token, action.id]);
      return execution;
    });
  const inbound = (overrides = {}) => channelWorkflowService.receiveInboundEvent({
    organization_id: organization.id, lead_id: lead.id, channel: "EMAIL", provider: "fixture-provider",
    provider_event_id: "inbound-1", payload: { text: "Please stop contacting me." }, ...overrides
  });
  const inspect = (target = lead, channel = "EMAIL") => contactPolicyService.inspectLead({
    organization_id: target.organization_id, lead_id: target.id, channel
  });
  return { db, organization, otherOrganization, lead, createLead, createAction, createAttempt, inbound, inspect, advanceInbox, ...services };
}

test("explicit local opt-out overrides caller labels without a model call and restricts duplicate contacts", async (t) => {
  const f = await fixture(t);
  const duplicate = await f.createLead(" PERSON@example.com ");
  const unrelated = await f.createLead("unrelated@example.com", f.otherOrganization.id);
  const queued = await f.createAction(duplicate);
  f.channelWorkflowService.replyClassifier = { classify() { throw new Error("Must not call model for explicit opt-out."); } };
  const result = await f.inbound({ event_type: "POSITIVE_REPLY" });
  assert.equal(result.inbound_event.event_type, "OPT_OUT");
  assert.equal(result.lead.status, "OPTED_OUT");
  assert.equal((await f.inspect()).restricted, true);
  assert.equal((await f.inspect(duplicate)).restricted, true);
  assert.equal((await f.inspect(unrelated)).restricted, false);
  assert.equal((await f.actionsRepository.getAction(queued.id)).status, "BLOCKED");
});

test("opt-out persists before failed message work and compatible duplicate retries repair the message", async (t) => {
  const f = await fixture(t);
  await f.db.exec("CREATE TRIGGER fail_message BEFORE INSERT ON channel_messages BEGIN SELECT RAISE(ABORT, 'Synthetic message storage failure'); END");
  await assert.rejects(f.inbound(), { statusCode: 503 });
  assert.equal((await f.inspect()).restricted, true);
  const restrictionsBefore = await f.db.get("SELECT COUNT(*) AS count FROM contact_restrictions");
  await f.db.exec("DROP TRIGGER fail_message"); f.advanceInbox();
  const retry = await f.inbound();
  assert.equal(retry.duplicate, true);
  assert.equal(retry.inbound_event.event_type, "OPT_OUT");
  assert.equal((await f.db.get("SELECT COUNT(*) AS count FROM contact_restrictions")).count, restrictionsBefore.count);
  assert.equal((await f.channelMessagesRepository.listForLead(f.organization.id, f.lead.id)).length, 1);
});

test("failure after inbox receipt but before policy is repaired from canonical opt-out on replay", async (t) => {
  const f = await fixture(t);
  await f.db.exec("CREATE TRIGGER fail_policy BEFORE INSERT ON contact_restrictions BEGIN SELECT RAISE(ABORT, 'Synthetic policy failure'); END");
  const input = { event_type: "OPT_OUT", payload: { text: "Enough." } };
  await assert.rejects(f.inbound(input), { statusCode: 503 });
  assert.equal((await f.inspect()).restricted, false);
  assert.equal((await f.db.get("SELECT COUNT(*) AS count FROM inbound_events")).count, 0);
  assert.equal((await f.db.get("SELECT COUNT(*) AS count FROM webhook_receipts")).count, 1);
  await f.db.exec("DROP TRIGGER fail_policy"); f.advanceInbox();
  const retry = await f.inbound(input);
  assert.equal(retry.duplicate, true);
  assert.equal((await f.inspect()).restricted, true);
  assert.equal((await f.leadsRepository.getLead(f.lead.id)).status, "OPTED_OUT");
});

test("changed inbound receipt preserves original lead and message while valid opt-out policy is retained", async (t) => {
  const f = await fixture(t);
  const other = await f.createLead("other@example.com");
  await f.inbound({ event_type: "POSITIVE_REPLY", payload: { text: "Sounds good." } });
  const variants = [
    { lead_id: other.id },
    { lead_id: null, contact: { email: "different@example.com" } },
    { channel: "SMS" },
    { payload: { text: "Stop." } }
  ];
  for (const variant of variants) {
    await assert.rejects(f.inbound({ event_type: "OPT_OUT", payload: { text: "Sounds good." }, ...variant }), { statusCode: 409 });
  }
  assert.equal((await f.inspect()).restricted, true);
  assert.equal((await f.inspect(other)).restricted, true);
  assert.equal((await f.db.get("SELECT COUNT(*) AS count FROM inbound_events")).count, 1);
  const original = await f.db.get("SELECT lead_id, event_type FROM inbound_events");
  assert.equal(original.lead_id, f.lead.id); assert.equal(original.event_type, "POSITIVE_REPLY");
  assert.equal((await f.db.get("SELECT body FROM channel_messages")).body, "Sounds good.");
});

test("inbound messages distinguish equal event IDs from different providers and concurrent receipts are atomic", async (t) => {
  const f = await fixture(t);
  await f.inbound({ provider: "provider-one", event_type: "POSITIVE_REPLY", payload: { text: "Hello." } });
  await f.inbound({ provider: "provider-two", event_type: "POSITIVE_REPLY", payload: { text: "Hello." } });
  assert.equal((await f.channelMessagesRepository.listForLead(f.organization.id, f.lead.id)).length, 2);
  const receipt = {
    organization_id: f.organization.id, lead_id: f.lead.id, channel: "EMAIL", provider: "concurrent",
    provider_event_id: "same-event", event_type: "POSITIVE_REPLY", payload: { text: "Hello." }
  };
  const results = await Promise.all([f.inboundEventsRepository.create(receipt), f.inboundEventsRepository.create(receipt)]);
  assert.equal(results.filter((result) => result.duplicate).length, 1);
  assert.equal(results[0].inbound_event.id, results[1].inbound_event.id);
});

test("canonical sender survives a lead edit and replay restricts the actual old sender as well as the lead", async (t) => {
  const f = await fixture(t);
  const oldDuplicate = await f.createLead(f.lead.email);
  await f.db.exec("CREATE TRIGGER fail_message BEFORE INSERT ON channel_messages BEGIN SELECT RAISE(ABORT, 'Synthetic message failure'); END");
  const input = { lead_id: f.lead.id, contact: { email: f.lead.email }, event_type: "OPT_OUT", payload: { text: "Enough." } };
  await assert.rejects(f.inbound(input), { statusCode: 503 });
  const receipt = await f.inboundEventsRepository.getByProviderEventId({ organization_id: f.organization.id, provider: "fixture-provider", provider_event_id: "inbound-1" });
  await f.db.run("UPDATE leads SET email = ?, normalized_email = ? WHERE id = ?", ["changed@example.com", "changed@example.com", receipt.lead_id]);
  await f.db.exec("DROP TRIGGER fail_message"); f.advanceInbox();
  const retry = await f.inbound(input);
  assert.equal(retry.duplicate, true);
  assert.equal((await f.inspect(oldDuplicate)).restricted, true);
  assert.equal((await f.contactPolicyService.inspectLead({ organization_id: f.organization.id, lead_id: receipt.lead_id, channel: "EMAIL" })).restricted, true);
});

test("new inbound opt-out is restricted before LeadCreated is published", async (t) => {
  const f = await fixture(t);
  await f.db.exec("CREATE TRIGGER require_optout_before_creation BEFORE INSERT ON domain_events WHEN NEW.type = 'LeadCreated' AND NOT EXISTS (SELECT 1 FROM contact_restrictions WHERE organization_id = NEW.organization_id AND contact_kind = 'LEAD' AND contact_value = NEW.lead_id) BEGIN SELECT RAISE(ABORT, 'Unrestricted lead was published'); END");
  const result = await f.inbound({ lead_id: null, contact: { email: "new@example.com" } });
  assert.equal(result.lead_created, true);
  assert.equal((await f.db.get("SELECT COUNT(*) AS count FROM domain_events WHERE type = 'LeadCreated'")).count, 1);
  assert.equal((await f.inspect(result.lead)).restricted, true);
});

test("ordinary replies and late delivery preserve restriction and cannot create new follow-ups", async (t) => {
  const f = await fixture(t);
  const action = await f.createAction();
  const execution = await f.createAttempt(action);
  await f.inbound();
  await f.inbound({ provider_event_id: "ordinary-later-reply", event_type: "QUESTION", payload: { text: "What is your address?" } });
  const result = await f.callbacksService.receiveExecutionCallback({
    organization_id: f.organization.id, action_id: action.id, action_execution_id: execution.id, provider_event_id: "late-delivery", status: "COMPLETED"
  });
  assert.equal(result.channel_result.follow_up, null);
  assert.equal((await f.leadsRepository.getLead(f.lead.id)).status, "OPTED_OUT");
  assert.equal((await f.inspect()).restricted, true);
  assert.equal((await f.followUpsRepository.listForLead(f.organization.id, f.lead.id)).length, 0);
});

test("outbound conversation records only the exact captured approved message, never provider credentials", async (t) => {
  const f = await fixture(t);
  const action = await f.createAction();
  const envelope = {
    schema_version: 1, organization_id: f.organization.id, action_id: action.id, action_type: "SEND_EMAIL",
    channel: "EMAIL", recipient: "reviewed@example.com",
    sender: { provider: "sendgrid", from: "sender@example.com", reply_to: null, account_id: null },
    subject: "Exact reviewed subject", body: "Exact reviewed body", scheduled_at: null
  };
  const execution = await f.executionsRepository.createExecution({
    action_id: action.id, status: "STARTED", attempt: 1, provider: "email-sandbox", idempotency_key: "captured-message"
  });
  const input = {
    action, payload: { subject: "MUTATED", body: "MUTATED", message: "MUTATED" }, attempt: 1,
    result: { ok: true, provider: "email-sandbox" }, execution,
    approvedDispatch: { revision_id: "revision-1", envelope_hash: "hash-1", envelope, provider_config: { api_key: "secret-never-store" } }
  };
  const message = await f.channelWorkflowService.recordOutboundExecutionAttempt(input);
  assert.equal(message.subject, envelope.subject);
  assert.equal(message.body, envelope.body);
  assert.deepEqual(message.payload.recipient, envelope.recipient);
  assert.doesNotMatch(JSON.stringify(message), /MUTATED|secret-never-store|provider_config/);
  await assert.rejects(f.channelWorkflowService.recordOutboundExecutionAttempt({ ...input, approvedDispatch: null }), { statusCode: 400 });
  await assert.rejects(f.channelWorkflowService.recordOutboundExecutionAttempt({
    ...input, approvedDispatch: { ...input.approvedDispatch, envelope: { ...envelope, action_id: "other-action" } }
  }), { statusCode: 400 });
});

test("SendGrid normalizer supports documented flat metadata, legacy nested metadata and bounded identities", () => {
  const base = { event: "delivered", sg_event_id: "provider-event", relay_action_id: "action-flat" };
  assert.equal(normalizeSendgridEvent(base).action_id, "action-flat");
  assert.equal(normalizeSendgridEvent({ ...base, relay_action_id: undefined, custom_args: { relay_action_id: "action-nested" } }).action_id, "action-nested");
  assert.throws(() => normalizeSendgridEvent({ ...base, custom_args: { relay_action_id: "different" } }), { statusCode: 400 });
  assert.throws(() => normalizeSendgridEvent({ ...base, sg_event_id: null }), { statusCode: 400 });
  assert.throws(() => normalizeSendgridEvent({ event: "unsubscribe", sg_event_id: "no-recipient" }), { statusCode: 400 });
  assert.throws(() => normalizeSendgridEvent({ ...base, email: 123 }), { statusCode: 400 });
});

test("actual SendGrid recipient suppression works without action metadata and is replay-safe", async (t) => {
  const f = await fixture(t);
  const queued = await f.createAction();
  const event = { event: "unsubscribe", sg_event_id: "unsubscribe-no-action", email: " PERSON@EXAMPLE.COM " };
  const first = await applySendgridEvent(f, f.organization.id, event);
  const second = await applySendgridEvent(f, f.organization.id, event);
  assert.equal(first.applied, true);
  assert.equal(second.applied, false);
  assert.equal(second.receipt.processing_state, "PROCESSED");
  assert.equal(second.receipt.mandatory_policy_status, "DONE");
  assert.equal((await f.inspect()).restricted, true);
  assert.equal((await f.inspect(f.lead, "SMS")).restricted, false);
  assert.equal((await f.actionsRepository.getAction(queued.id)).status, "BLOCKED");
});

for (const [eventType, subtype, expectedReason] of [
  ["unsubscribe", null, "UNSUBSCRIBE"],
  ["spamreport", null, "COMPLAINT"],
  ["bounce", "bounce", "HARD_BOUNCE"]
]) {
  test("SendGrid " + eventType + " with an obsolete action reference still restricts the recipient", async (t) => {
    const f = await fixture(t);
    const queued = await f.createAction();
    let callbackCalls = 0;
    f.callbacksService.applyExecutionCallback = async () => { callbackCalls += 1; throw new Error("No action to mutate"); };
    const event = {
      event: eventType, type: subtype, sg_event_id: "obsolete-" + eventType,
      email: f.lead.email, relay_action_id: "removed-action"
    };
    const first = await applySendgridEvent(f, f.organization.id, event);
    const duplicate = await applySendgridEvent(f, f.organization.id, event);
    assert.equal(first.restriction_applied, true);
    assert.equal(first.applied, true);
    assert.equal(first.action_id, null);
    assert.equal(duplicate.applied, false);
    assert.equal(callbackCalls, 0);
    assert.equal((await f.inspect()).restricted, true);
    assert.equal((await f.db.get("SELECT reason FROM contact_restrictions")).reason, expectedReason);
    assert.equal((await f.actionsRepository.getAction(queued.id)).status, "BLOCKED");
    assert.equal((await f.db.get("SELECT COUNT(*) AS count FROM contact_restrictions")).count, 1);
    await assert.rejects(applySendgridEvent(f, f.organization.id, {
      event: "delivered", sg_event_id: "missing-delivery-" + eventType, relay_action_id: "removed-action"
    }), { statusCode: 404 });
  });
}

test("SendGrid rejects a known foreign action in either conflicting reference before recipient restriction", async (t) => {
  const f = await fixture(t);
  const otherLead = await f.createLead("foreign@example.com", f.otherOrganization.id);
  const foreignAction = await f.createAction(otherLead);
  const event = { event: "unsubscribe", sg_event_id: "bad-reference", email: f.lead.email, relay_action_id: foreignAction.id };
  await assert.rejects(applySendgridEvent(f, f.organization.id, event), { statusCode: 404 });
  assert.equal((await f.inspect()).restricted, false);
  await assert.rejects(applySendgridEvent(f, f.organization.id, {
    ...event, sg_event_id: "conflicting-reference", custom_args: { relay_action_id: "conflicting-action" }
  }), { statusCode: 404 });
  assert.equal((await f.db.get("SELECT COUNT(*) AS count FROM contact_restrictions")).count, 0);
});

test("SendGrid uses actual event recipient rather than a subsequently changed lead address", async (t) => {
  const f = await fixture(t);
  const oldAddressLead = await f.createLead("old@example.com");
  const action = await f.createAction(f.lead);
  await applySendgridEvent(f, f.organization.id, {
    event: "unsubscribe", sg_event_id: "old-recipient", relay_action_id: action.id, email: oldAddressLead.email
  });
  assert.equal((await f.inspect(oldAddressLead)).restricted, true);
  assert.equal((await f.inspect()).restricted, false);
});

test("SendGrid complaint, group unsubscribe and explicit hard bounce restrict; block and unknown bounce do not", async (t) => {
  const f = await fixture(t);
  for (const [type, subtype, restricted] of [
    ["spamreport", null, true], ["group_unsubscribe", null, true], ["bounce", "bounce", true],
    ["bounce", "blocked", false], ["bounce", null, false], ["dropped", null, false]
  ]) {
    const lead = await f.createLead(type + "-" + (subtype || "none") + "@example.com");
    const action = await f.createAction(lead);
    const execution = await f.createAttempt(action);
    await applySendgridEvent(f, f.organization.id, {
      event: type, type: subtype, sg_event_id: type + "-" + (subtype || "none"),
      relay_action_id: action.id, relay_execution_id: execution.id, relay_revision_id: execution.action_revision_id, email: lead.email
    });
    assert.equal((await f.inspect(lead)).restricted, restricted, type + "/" + subtype);
  }
});

test("provider restriction is durable before failing callback work and resubscribe never clears it", async (t) => {
  const f = await fixture(t);
  const action = await f.createAction(); const execution = await f.createAttempt(action);
  await f.db.exec("CREATE TRIGGER fail_callback BEFORE INSERT ON callbacks BEGIN SELECT RAISE(ABORT, 'Synthetic callback storage failure'); END");
  const event = { event: "spamreport", sg_event_id: "complaint-before-callback", relay_action_id: action.id, relay_execution_id: execution.id, relay_revision_id: execution.action_revision_id, email: f.lead.email };
  await assert.rejects(applySendgridEvent(f, f.organization.id, event), { statusCode: 503 });
  assert.equal((await f.inspect()).restricted, true);
  await f.db.exec("DROP TRIGGER fail_callback"); f.advanceInbox();
  await applySendgridEvent(f, f.organization.id, event);
  assert.equal((await f.db.get("SELECT COUNT(*) AS count FROM callbacks")).count, 1);
  await applySendgridEvent(f, f.organization.id, { event: "group_resubscribe", sg_event_id: "resubscribe-tracking", relay_action_id: action.id, email: f.lead.email });
  assert.equal((await f.inspect()).restricted, true);
});

test("provider restriction storage failure propagates for retry instead of reporting applied", async (t) => {
  const f = await fixture(t);
  await f.db.exec("CREATE TRIGGER fail_policy BEFORE INSERT ON contact_restrictions BEGIN SELECT RAISE(ABORT, 'Synthetic database unavailable'); END");
  await assert.rejects(applySendgridEvent(f, f.organization.id, { event: "unsubscribe", sg_event_id: "failed-restriction", email: f.lead.email }), { statusCode: 503 });
  assert.equal((await f.db.get("SELECT COUNT(*) AS count FROM contact_restrictions")).count, 0);
  const receipt = await f.db.get("SELECT processing_state, mandatory_policy_status FROM webhook_receipts");
  assert.equal(receipt.processing_state, "RETRY_PENDING"); assert.equal(receipt.mandatory_policy_status, "PENDING");
});

test("early and racing delivery callbacks determine the stored message despite a stale STARTED execution object", async (t) => {
  const f = await fixture(t);
  for (const order of ["before", "after", "racing"]) {
    const action = await f.createAction();
    const staleExecution = await f.createAttempt(action, { provider: "email-sandbox" });
    const storedRevision = await f.db.get("SELECT * FROM action_revisions WHERE id = ?", [staleExecution.action_revision_id]);
    const envelope = JSON.parse(storedRevision.envelope_json);
    const record = () => f.channelWorkflowService.recordOutboundExecutionAttempt({
      action, execution: staleExecution, payload: {}, attempt: 1, result: { ok: true, provider: "email-sandbox" },
      approvedDispatch: { revision_id: storedRevision.id, envelope_hash: storedRevision.content_hash, envelope, provider_config: {} }
    });
    const callback = () => f.callbacksService.receiveExecutionCallback({
      organization_id: f.organization.id, action_id: action.id,
      action_execution_id: staleExecution.id, provider_event_id: "early-delivery-" + order, status: "COMPLETED"
    });
    if (order === "before") { await callback(); await record(); }
    if (order === "after") { await record(); await callback(); }
    if (order === "racing") await Promise.all([record(), callback()]);
    const message = await f.channelMessagesRepository.latestOutboundForAction(action.id, f.organization.id);
    assert.equal(message.status, "DELIVERED", order);
    assert.equal(message.body, envelope.body);
    assert.equal((await f.executionsRepository.getExecution(staleExecution.id)).status, "COMPLETED");
  }
});


test("a question after repaired delivery cancels the obsolete no-response task and preserves its human reply task", async (t) => {
  const f = await fixture(t);
  const action = await f.createAction(); const execution = await f.createAttempt(action);
  const callback = { organization_id: f.organization.id, action_id: action.id, action_execution_id: execution.id, revision_id: execution.action_revision_id, provider_event_id: "question-after-repair", status: "COMPLETED" };
  await f.db.exec("CREATE TRIGGER fail_channel_message BEFORE INSERT ON channel_messages BEGIN SELECT RAISE(ABORT, 'Synthetic conversation failure'); END");
  await assert.rejects(f.callbacksService.receiveExecutionCallback(callback), { statusCode: 503 });
  assert.equal((await f.actionsRepository.getAction(action.id)).status, "COMPLETED");
  await f.db.exec("DROP TRIGGER fail_channel_message"); f.advanceInbox();
  await f.callbacksService.receiveExecutionCallback(callback);
  const noResponse = await f.followUpsRepository.getByIdempotencyKey(f.organization.id, "action:" + action.id + ":no-response-follow-up:v1");
  assert.equal(noResponse.status, "PLANNED");
  const reply = await f.inbound({ provider_event_id: "question-after-delivery", payload: { text: "Can you explain the options?" } });
  assert.equal((await f.followUpsRepository.getForOrganization(noResponse.id, f.organization.id)).status, "CANCELLED");
  assert.equal(reply.follow_up.status, "DUE");
  assert.equal(reply.follow_up.inbound_event_id, reply.inbound_event.id);
});
