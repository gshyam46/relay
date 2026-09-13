import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database/database.js";
import { LeadsRepository } from "../src/modules/data-foundation/leadsRepository.js";
import { ContactPolicyService } from "../src/modules/contact-policy/contactPolicyService.js";
import { InboundMessageService } from "../src/modules/channels/inboundMessageService.js";
import { WebhookInboxService } from "../src/modules/webhook-inbox/webhookInboxService.js";
import { LocalReplyClassifier } from "../src/modules/channels/replyClassifier.js";
import { LlmReplyClassifier } from "../src/modules/ai/llmReplyClassifier.js";
import { REPLY_POLICY_VERSION, REPLY_PROMPT_VERSION } from "../src/modules/channels/replyInterpretationContract.js";
async function fixture(t, classifier = new LocalReplyClassifier()) {
  const db = await createDatabase(":memory:"); t.after(() => db.close()); const leads = new LeadsRepository(db), org = await leads.createOrganization({ name: "Synthetic reply quality" });
  const lead = await leads.createLead({ organization_id: org.id, name: "Synthetic sender", email: "sender@example.test" });
  const policy = new ContactPolicyService(db); let clock = Date.parse("2026-09-12T10:00:00.000Z"), calls = 0;
  const inbox = new WebhookInboxService({ db, contactPolicyService: policy, now: () => clock, random: () => 0 });
  const service = new InboundMessageService({ db, contactPolicyService: policy, webhookInbox: inbox, replyClassifier: { classify: async text => { calls++; return classifier.classify(text); } } });
  inbox.handlers.INBOUND_MESSAGE = (input, context) => service.applyInboundMessage(input, context);
  inbox.policyHandlers.INBOUND_MESSAGE = (tx, input, context) => service.applyConflictPolicyInTransaction(tx, org.id, input, context);
  const receive = (text, extra = {}) => service.receiveInboundEvent({ organization_id: org.id, lead_id: lead.id, channel: "EMAIL", provider: "synthetic-quality", provider_event_id: "reply-1", payload: { text }, ...extra });
  return { db, leads, lead, org, policy, service, inbox, receive, calls: () => calls, replay: async () => { clock += 6000; return inbox.processDue({ organization_id: org.id }); }, restricted: async id => (await policy.inspectLead({ organization_id: org.id, lead_id: id || lead.id, channel: "EMAIL" })).restricted };
}
test("new direct stop persists source metadata and duplicate-contact restriction before later message failure", async t => {
  const f = await fixture(t), duplicate = await f.leads.createLead({ organization_id: f.org.id, name: "Same contact", email: f.lead.email });
  await f.db.exec("CREATE TRIGGER quality_message_failure BEFORE INSERT ON channel_messages BEGIN SELECT RAISE(ABORT,'Synthetic message failure'); END");
  await assert.rejects(f.receive("Please do not email me again"), { statusCode: 503 }); assert.equal(await f.restricted(), true); assert.equal(await f.restricted(duplicate.id), true);
  const before = await f.db.get("SELECT * FROM inbound_events"); const saved = JSON.parse(before.payload_json).classification;
  assert.equal(saved.event_type, "OPT_OUT"); assert.equal(saved.generation.reply_policy_version, REPLY_POLICY_VERSION); assert.equal(saved.generation.mode, "LOCAL_POLICY"); assert.equal(saved.review_required, false); assert.equal(saved.evidence.quote, "Please do not email me again"); assert.equal(f.calls(), 0);
  await f.db.exec("DROP TRIGGER quality_message_failure"); await f.replay();
  const after = await f.db.get("SELECT * FROM inbound_events"); assert.equal(after.id, before.id); assert.equal(after.payload_json, before.payload_json); assert.equal(after.effects_status, "DONE");
  assert.equal(Number((await f.db.get("SELECT count(*) n FROM channel_messages")).n), 1); assert.equal(Number((await f.db.get("SELECT count(*) n FROM follow_up_tasks")).n), 0);
});
test("negated or quoted stop wording creates human review rather than a false durable optout", async t => {
  const f = await fixture(t); const text = "Please do not unsubscribe me\n> Reply STOP to unsubscribe"; const result = await f.receive(text);
  assert.equal(result.inbound_event.event_type, "UNKNOWN"); assert.equal(result.classification.review_required, true); assert.equal(await f.restricted(), false); assert.equal(result.message.body, text);
  const task = await f.db.get("SELECT * FROM follow_up_tasks"); assert.equal(task.status, "DUE"); assert.equal(task.escalated, 1);
  const persisted = JSON.parse((await f.db.get("SELECT payload_json FROM channel_messages")).payload_json).classification; assert.equal(persisted.generation.reply_policy_version, REPLY_POLICY_VERSION); assert.equal(persisted.evidence, null);
});
test("model candidate preserves authoritative UNKNOWN, due review and exact original multilingual source", async t => {
  const text = "Me interesa el producto", f = await fixture(t, new LlmReplyClassifier({ info: { provider: "synthetic", model: "fixture-v1" }, jsonCompletion: async () => ({ event_type: "POSITIVE_REPLY", confidence: "HIGH", evidence_quote: text }) }));
  const result = await f.receive(text), classification = result.classification;
  assert.equal(result.inbound_event.event_type, "UNKNOWN"); assert.equal(classification.confidence, "LOW"); assert.equal(classification.candidate.event_type, "POSITIVE_REPLY"); assert.equal(classification.candidate.evidence.quote, text); assert.equal(classification.generation.prompt_version, REPLY_PROMPT_VERSION); assert.equal(await f.restricted(), false);
  assert.equal((await f.db.get("SELECT escalated FROM follow_up_tasks")).escalated, 1);
  assert.deepEqual(JSON.parse((await f.db.get("SELECT payload_json FROM inbound_events")).payload_json).classification, classification);
  const again = await f.receive(text); assert.equal(again.duplicate, true); assert.equal(f.calls(), 1); assert.deepEqual(again.classification, classification);
});
test("possible model optout stays visibly uncertain and conservatively restricted without a reply task", async t => {
  const text = "No me contactes mas", f = await fixture(t, new LlmReplyClassifier({ jsonCompletion: async () => ({ event_type: "OPT_OUT", confidence: "LOW", evidence_quote: text }) }));
  const result = await f.receive(text); assert.equal(result.inbound_event.event_type, "OPT_OUT"); assert.equal(result.classification.review_required, true); assert.equal(result.classification.generation.reason, "MODEL_POSSIBLE_OPT_OUT"); assert.equal(result.message.classification_confidence, "LOW"); assert.equal(await f.restricted(), true); assert.equal(Number((await f.db.get("SELECT count(*) n FROM follow_up_tasks")).n), 0);
});
test("canonical pending replay invokes neither a changed local policy nor a changed model, preserving original effect identity", async t => {
  const f = await fixture(t); await f.db.exec("CREATE TRIGGER quality_outbox_failure BEFORE INSERT ON domain_events WHEN NEW.type='LeadReplyReceived' BEGIN SELECT RAISE(ABORT,'Synthetic outbox failure'); END");
  await assert.rejects(f.receive("What is the price?\nThanks"), { statusCode: 503 }); const before = await f.db.get("SELECT * FROM inbound_events"); assert.equal(before.event_type, "QUESTION"); assert.equal(before.effects_status, "PENDING"); assert.equal(f.calls(), 1);
  f.service.localReplyClassifier = { classify() { throw new Error("A new policy must not reinterpret the canonical source"); } }; f.service.replyClassifier = { classify() { throw new Error("A new model must not reinterpret the canonical source"); } };
  await f.db.exec("DROP TRIGGER quality_outbox_failure"); await f.replay(); const after = await f.db.get("SELECT * FROM inbound_events"); assert.equal(after.id, before.id); assert.equal(after.payload_json, before.payload_json); assert.equal(after.event_type, "QUESTION"); assert.equal(after.effects_status, "DONE"); assert.equal(await f.restricted(), false);
  assert.equal(Number((await f.db.get("SELECT count(*) n FROM channel_messages")).n), 1); assert.equal(Number((await f.db.get("SELECT count(*) n FROM follow_up_tasks")).n), 1);
  assert.equal(Number((await f.db.get("SELECT count(*) n FROM domain_events WHERE type='LeadReplyReceived'")).n), 1);
});
test("empty or transcript-only replies retain reviewable source while trusted typed events remain separately attributed", async t => {
  const f = await fixture(t); const empty = await f.receive(""); assert.equal(empty.inbound_event.event_type, "UNKNOWN"); assert.equal(empty.classification.generation.reason, "EMPTY_INPUT");
  const transcript = await f.receive(undefined, { provider_event_id: "reply-2", payload: { transcript: "What is the price?\nThanks" } }); assert.equal(transcript.inbound_event.event_type, "QUESTION"); assert.equal(transcript.message.body, "What is the price?\nThanks");
  const typed = await f.receive("", { provider_event_id: "reply-3", event_type: "OPT_OUT" }); assert.equal(typed.inbound_event.event_type, "OPT_OUT"); assert.equal(typed.classification, null); assert.equal(await f.restricted(), true);
  const later = await f.receive("Please do not unsubscribe me", { provider_event_id: "reply-4" }); assert.equal(later.inbound_event.event_type, "UNKNOWN"); assert.equal(await f.restricted(), true);
});
