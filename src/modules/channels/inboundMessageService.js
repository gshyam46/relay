import { withAiInvocationContext } from "../ai-usage/aiInvocationContext.js";
import { createHash } from "node:crypto";
import { prepareUnassignedInboundInTransaction, stopAmbiguousInboundWorkInTransaction } from "./ambiguousInboundSafety.js";
import { LocalReplyClassifier } from "./replyClassifier.js";
import { InboundEventsRepository } from "./inboundEventsRepository.js";
import { ChannelMessagesRepository } from "./channelMessagesRepository.js";
import { FollowUpsRepository } from "./followUpsRepository.js";
import { LeadsRepository } from "../data-foundation/leadsRepository.js";
import { WorkflowsRepository } from "../workflows/workflowsRepository.js";
import { EventsRepository } from "../events/eventsRepository.js";
import { AuditRepository } from "../events/auditRepository.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { WebhookInboxService, assertReceiptOwnership } from "../webhook-inbox/webhookInboxService.js";
import { normalizeEmail, normalizePhone, normalizeString } from "../data-foundation/normalization.js";
import { validateChannel, validateInboundEventType } from "./channelContract.js";

const STOP_EVENTS = new Set(["POSITIVE_REPLY", "NEGATIVE_REPLY", "OPT_OUT"]);
const LABELS = { POSITIVE_REPLY: "Positive response", NEGATIVE_REPLY: "Negative response", QUESTION: "Question received", OPT_OUT: "Opt-out received", UNKNOWN: "Response received" };
const SUMMARIES = { POSITIVE_REPLY: "Lead responded positively. Open follow-ups were stopped.", NEGATIVE_REPLY: "Lead responded negatively. Open follow-ups were stopped.", QUESTION: "Lead asked a question. A follow-up is due.", OPT_OUT: "Lead opted out. Contact should stop.", UNKNOWN: "Inbound response needs review." };

export class InboundMessageService {
  constructor({ db, replyClassifier = null, localReplyClassifier = new LocalReplyClassifier(), contactPolicyService = null, webhookInbox = null }) {
    this.db = db;
    this.replyClassifier = replyClassifier;
    this.localReplyClassifier = localReplyClassifier;
    this.contactPolicyService = contactPolicyService || new ContactPolicyService(db);
    this.webhookInbox = webhookInbox || new WebhookInboxService({ db, contactPolicyService: this.contactPolicyService,
      handlers: { INBOUND_MESSAGE: (input, context) => this.applyInboundMessage(input, context) },
      policyHandlers: { INBOUND_MESSAGE: (tx, input, context) => this.applyConflictPolicyInTransaction(tx, input.organization_id, input, context) } });
  }

  async receiveInboundEvent(input) {
    const canonical = normalizeInboundInput(input);
    const received = await this.webhookInbox.receiveAndProcess({ organization_id: canonical.organization_id,
      provider: canonical.provider, connection_key: canonical.provider === "sendgrid" ? "channel_email" : "internal",
      event_kind: "INBOUND_MESSAGE", provider_event_id: canonical.provider_event_id,
      verification_kind: "TRUSTED_INTERNAL", input: canonical });
    let result = received.result;
    if (!result && received.receipt.processing_state === "PROCESSED") {
      const row = await this.db.get("SELECT * FROM inbound_events WHERE webhook_receipt_id = ? AND organization_id = ?", [received.receipt.id, canonical.organization_id]);
      if (row) {
        const inbound = new InboundEventsRepository(this.db).eventDetail(row);
        result = { inbound_event: inbound, message: await new ChannelMessagesRepository(this.db).getByIdempotencyKey(canonical.organization_id, "inbound:v2:" + hash([canonical.provider, canonical.provider_event_id])),
          classification: inbound.payload.classification || null, lead: await new LeadsRepository(this.db).getLead(inbound.lead_id), follow_up: null, lead_created: false };
      }
    }
    return { ...(result || {}), receipt: received.receipt, duplicate: Boolean(received.duplicate || result?.duplicate) };
  }

  async applyInboundMessage(input, { receipt }) {
    const value = normalizeInboundInput(input);
    const { organization_id, provider, provider_event_id, channel } = value;
    // Known explicit foreign references fail before any contact effects.
    if (value.lead_id) {
      const lead = await new LeadsRepository(this.db).getLead(value.lead_id);
      if (!lead || lead.organization_id !== organization_id) throw inboundError("INBOUND_LEAD_NOT_FOUND", 404);
    }
    if (value.identity_error) {
      const identityOptOut = value.event_type === "OPT_OUT" || this.localReplyClassifier.classify(value.payload.text || value.payload.transcript || "").event_type === "OPT_OUT";
      await this.contactPolicyService.withWorkspacePolicyTransaction(organization_id, async (tx) => {
        await assertReceiptOwnership(tx, receipt);
        if (identityOptOut) {
          const original = canonicalContact(value.contact);
          if (!original.email && !original.phone) throw inboundError("INBOUND_SENDER_INVALID", 400);
          const restriction = { organization_id, channel: "ALL", reason: "OPT_OUT", source: "INBOUND_EVENT", source_event_id: "inbound:" + hash([provider, provider_event_id]) };
          if (original.email) await this.contactPolicyService.restrictContactInTransaction(tx, { ...restriction, contact: { kind: "EMAIL", value: original.email } });
          if (original.phone) await this.contactPolicyService.restrictContactInTransaction(tx, { ...restriction, contact: { kind: "PHONE", value: original.phone } });
        }
        await tx.run("UPDATE webhook_receipts SET mandatory_policy_status = 'DONE' WHERE id = ? AND organization_id = ?", [receipt.id, organization_id]);
      });
      if (value.identity_error) throw inboundError(value.identity_error, 400);
    }
    const repository = new InboundEventsRepository(this.db);
    const prior = await repository.getByProviderEventId(value);
    if (prior && (prior.effects_status === "LEGACY_UNKNOWN" || !prior.webhook_receipt_id)) {
      await this.contactPolicyService.withWorkspacePolicyTransaction(organization_id, async (tx) => {
        await assertReceiptOwnership(tx, receipt);
        await this.applyConflictPolicyInTransaction(tx, organization_id, value, { receipt });
        await tx.run("UPDATE webhook_receipts SET mandatory_policy_status = 'DONE' WHERE id = ? AND organization_id = ?", [receipt.id, organization_id]);
      });
      throw inboundError("LEGACY_REVIEW_REQUIRED", 409);
    }
    if (prior) await this.#validateExisting(this.db, prior, value, receipt);
    if (!prior && !value.lead_id) {
      const prepared = await this.contactPolicyService.withWorkspacePolicyTransaction(organization_id, async tx => {
        await assertReceiptOwnership(tx, receipt);
        return prepareUnassignedInboundInTransaction(tx, receipt);
      });
      if (prepared.already_stopped) throw inboundError("INBOUND_IDENTITY_AMBIGUOUS", 409);
    }
    // Classification may call a bounded model adapter, but never holds a DB transaction.
    let classification = prior?.payload?.classification || null;
    let eventType = prior?.event_type || value.event_type;
    // Canonical interpretation is immutable across retries and policy versions.
    if (!prior) {
      const messageText = value.payload.text || value.payload.transcript || "";
      const local = this.localReplyClassifier.classify(messageText);
      const verificationProof = await this.db.get("SELECT receipt_id FROM email_verification_receipts WHERE organization_id=? AND receipt_id=? AND kind IN('REPLY','STOP')", [organization_id,receipt.id]);
      if (verificationProof || local.event_type === "OPT_OUT") { classification = local; eventType = local.event_type; }
      else if (!eventType) {
        if (!this.replyClassifier) throw inboundError("INBOUND_CLASSIFICATION_REQUIRED", 400);
        classification = await withAiInvocationContext({ organization_id, lead_id: value.lead_id || null, purpose: "REPLY_CLASSIFICATION",
          origin: { kind: "INBOUND_RECEIPT", id: receipt.id, fence: receipt.processing_fence }, input_fingerprint: hash(messageText) },
          () => this.replyClassifier.classify(messageText));
        eventType = classification?.event_type;
      }
    }
    if (!validateInboundEventType(eventType)) throw inboundError("INBOUND_EVENT_TYPE_INVALID", 400);

    // Preparation freezes identity and interpretation. Restrictions and newly captured
    // lead provenance commit here, independently of all later conversation work.
    const prepared = await this.contactPolicyService.withWorkspacePolicyTransaction(organization_id, async (tx) => {
      await assertReceiptOwnership(tx, receipt);
      const inbound = new InboundEventsRepository(tx);
      let canonical = await inbound.getByProviderEventId(value);
      let created = false;
      const duplicate = Boolean(canonical);
      let lead;
      if (canonical) {
        lead = await this.#validateExisting(tx, canonical, value, receipt);
      } else {
        let resolved;
        try { resolved = await this.#resolveLead(tx, value); }
        catch (error) {
          if (error.code !== "INBOUND_IDENTITY_AMBIGUOUS") throw error;
          await stopAmbiguousInboundWorkInTransaction(tx, { receipt, contact: value.contact });
          if (eventType === "OPT_OUT") {
            const original = canonicalContact(value.contact);
            const restriction = { organization_id, channel: "ALL", reason: "OPT_OUT", source: "INBOUND_EVENT", source_event_id: "inbound:" + hash([provider, provider_event_id]) };
            if (original.email) await this.contactPolicyService.restrictContactInTransaction(tx, { ...restriction, contact: { kind: "EMAIL", value: original.email } });
            if (original.phone) await this.contactPolicyService.restrictContactInTransaction(tx, { ...restriction, contact: { kind: "PHONE", value: original.phone } });
          }
          await tx.run("UPDATE webhook_receipts SET mandatory_policy_status = 'DONE' WHERE id = ? AND organization_id = ?", [receipt.id, organization_id]);
          return { identity_error: error.code };
        }
        lead = resolved.lead; created = resolved.created;
        canonical = (await inbound.create({ organization_id, lead_id: lead.id, channel, provider, provider_event_id,
          event_type: eventType, sentiment: sentiment(eventType), confidence: classification?.confidence || null,
          reason: classification?.reason || null, suggested_next_step: classification?.suggested_next_step || null,
          payload: { ...value.payload, _ingress_contact: canonicalContact(value.contact), ...(classification ? { classification } : {}) },
          received_at: receipt.received_at, webhook_receipt_id: receipt.id, effects_status: "PENDING" })).inbound_event;
      }
      if (canonical.effects_status === "DONE") return { canonical, lead, duplicate: true, created: false };
      const canonicalType = canonical.event_type;
      if (canonicalType === "OPT_OUT") {
        const restriction = { organization_id, lead_id: lead.id, channel: "ALL", reason: "OPT_OUT", source: "INBOUND_EVENT",
          source_event_id: "inbound:" + hash([provider, provider_event_id]) };
        await this.contactPolicyService.restrictLeadInTransaction(tx, restriction);
        if (canonical.payload._ingress_contact?.email) await this.contactPolicyService.restrictContactInTransaction(tx,
          { ...restriction, contact: { kind: "EMAIL", value: canonical.payload._ingress_contact.email } });
        if (canonical.payload._ingress_contact?.phone) await this.contactPolicyService.restrictContactInTransaction(tx,
          { ...restriction, contact: { kind: "PHONE", value: canonical.payload._ingress_contact.phone } });
      }
      if (STOP_EVENTS.has(canonicalType)) await this.#stopWork(tx, organization_id, lead.id, canonicalType);
      else await new WorkflowsRepository(tx).stopOpenForLead(organization_id, lead.id, SUMMARIES[canonicalType]);
      if (created) {
        await new EventsRepository(tx).publish({ organization_id, lead_id: lead.id, type: "LeadCreated", payload: { lead_id: lead.id, source: lead.source } });
        await new AuditRepository(tx).record({ organization_id, lead_id: lead.id, event_type: "LeadCreated",
          message: "New lead captured from an inbound contact.", metadata: { channel, source: lead.source, webhook_receipt_id: receipt.id } });
      }
      await tx.run("UPDATE webhook_receipts SET mandatory_policy_status = 'DONE' WHERE id = ? AND organization_id = ?", [receipt.id, organization_id]);
      return { canonical, lead, duplicate, created };
    });

    if (prepared.identity_error) throw inboundError(prepared.identity_error, 409);
    return this.contactPolicyService.withWorkspacePolicyTransaction(organization_id, async (tx) => {
      await assertReceiptOwnership(tx, receipt);
      const inbound = new InboundEventsRepository(tx);
      const canonical = await inbound.getByProviderEventId(value);
      const lead = await this.#validateExisting(tx, canonical, value, receipt);
      const messages = new ChannelMessagesRepository(tx);
      const messageKey = "inbound:v2:" + hash([provider, provider_event_id]);
      if (canonical.effects_status === "DONE") return { inbound_event: canonical,
        message: await messages.getByIdempotencyKey(organization_id, messageKey), follow_up: null,
        duplicate: true, classification: canonical.payload.classification || null, lead, lead_created: false };
      const classified = canonical.payload.classification || null;
      const resolvedType = canonical.event_type;
      const summary = classified ? "Classified as " + LABELS[resolvedType] + " (" + String(classified.confidence).toLowerCase() + " confidence): " + classified.reason : SUMMARIES[resolvedType];
      const message = await messages.create({ organization_id, lead_id: lead.id, inbound_event_id: canonical.id,
        direction: "INBOUND", channel, status: "RECEIVED", subject: LABELS[resolvedType],
        body: canonical.payload.text || canonical.payload.transcript || canonical.payload.summary || null,
        summary, provider, provider_event_id, idempotency_key: messageKey,
        classification_event_type: resolvedType, classification_confidence: classified?.confidence || null,
        suggested_next_step: classified?.suggested_next_step || null,
        payload: { event_type: resolvedType, classification: classified, payload: canonical.payload }, occurred_at: canonical.received_at });
      let followUp = null;
      if (STOP_EVENTS.has(resolvedType)) await this.#stopWork(tx, organization_id, lead.id, resolvedType);
      else if (["QUESTION", "UNKNOWN"].includes(resolvedType)) {
        await new WorkflowsRepository(tx).stopOpenForLead(organization_id, lead.id, SUMMARIES[resolvedType]);
        await tx.run("UPDATE follow_up_tasks SET status = 'CANCELLED', updated_at = ? WHERE organization_id = ? AND lead_id = ? AND action_id IS NOT NULL AND idempotency_key = 'action:' || action_id || ':no-response-follow-up:v1' AND status IN ('PLANNED', 'DUE')", [new Date().toISOString(), organization_id, lead.id]);
        const eligibility = await this.contactPolicyService.inspectLeadInTransaction(tx, { organization_id, lead_id: lead.id, channel });
        if (eligibility.policy_pending) throw inboundError("POLICY_EFFECT_PENDING", 503);
        if (!eligibility.restricted && !lead.archived_at) {
          const escalate = classified?.confidence === "LOW";
          const base = escalate ? "Escalated: could not automatically classify this reply - needs human review."
            : resolvedType === "QUESTION" ? "Answer the lead's question." : "Review the inbound response.";
          followUp = await new FollowUpsRepository(tx).create({ organization_id, lead_id: lead.id,
            inbound_event_id: canonical.id, channel, status: "DUE", due_at: canonical.received_at,
            reason: classified?.suggested_next_step && !escalate ? base + " Suggested: " + classified.suggested_next_step : base,
            idempotency_key: "inbound:" + canonical.id + ":human-review-follow-up:v1", escalated: escalate });
        }
      }
      if (resolvedType !== "OPT_OUT" && !lead.archived_at) await new LeadsRepository(tx).updateLeadStatus(lead.id, "ACTIVE");
      await new AuditRepository(tx).record({ organization_id, lead_id: lead.id, event_type: "InboundEventReceived",
        message: "Inbound channel event recorded.", metadata: { channel, event_type: resolvedType, provider_event_id, message_id: message.id, classification: classified, webhook_receipt_id: receipt.id } });
      const verificationProbe = await tx.get("SELECT id FROM email_verification_probes WHERE organization_id=? AND lead_id=? LIMIT 1", [organization_id,lead.id]);
      if (!verificationProbe) await new EventsRepository(tx).publish({ organization_id, lead_id: lead.id, type: "LeadReplyReceived",
        payload: { lead_id: lead.id, inbound_event_id: canonical.id, channel, event_type: resolvedType, confidence: classified?.confidence || null } });
      await inbound.markEffectsDone(canonical.id, organization_id, receipt.id);
      return { inbound_event: await inbound.getByProviderEventId(value), message, follow_up: followUp,
        duplicate: prepared.duplicate, classification: classified, lead: await new LeadsRepository(tx).getLead(lead.id), lead_created: prepared.created };
    });
  }

  async applyConflictPolicyInTransaction(tx, organizationId, input, { receipt } = {}) {
    this.contactPolicyService.assertWorkspaceTransaction(tx, organizationId);
    if (!receipt?.id || receipt.organization_id !== organizationId) throw inboundError("RECEIPT_IDENTITY_CONFLICT", 409);
    const value = normalizeInboundInput(input);
    if (value.organization_id !== organizationId) throw inboundError("INBOUND_IDENTITY_CONFLICT", 409);
    if (value.lead_id) {
      const lead = await new LeadsRepository(tx).getLead(value.lead_id);
      if (!lead || lead.organization_id !== organizationId) throw inboundError("INBOUND_LEAD_NOT_FOUND", 404);
    }
    const optedOut = value.event_type === "OPT_OUT" || this.localReplyClassifier.classify(value.payload.text || value.payload.transcript || "").event_type === "OPT_OUT";
    if (!optedOut) return { restriction_applied: false };
    const original = canonicalContact(value.contact);
    if (!value.lead_id && !original.email && !original.phone) throw inboundError("INBOUND_SENDER_INVALID", 400);
    const restriction = { organization_id: organizationId, channel: "ALL", reason: "OPT_OUT", source: "INBOUND_EVENT", source_event_id: "conflict:receipt:" + receipt.id };
    if (value.lead_id) await this.contactPolicyService.restrictLeadInTransaction(tx, { ...restriction, lead_id: value.lead_id });
    if (original.email) await this.contactPolicyService.restrictContactInTransaction(tx, { ...restriction, ...(value.lead_id ? { lead_id: value.lead_id } : {}), contact: { kind: "EMAIL", value: original.email } });
    if (original.phone) await this.contactPolicyService.restrictContactInTransaction(tx, { ...restriction, ...(value.lead_id ? { lead_id: value.lead_id } : {}), contact: { kind: "PHONE", value: original.phone } });
    return { restriction_applied: true };
  }

  async #validateExisting(tx, existing, input, receipt) {
    if (!existing || existing.effects_status === "LEGACY_UNKNOWN" || !existing.webhook_receipt_id) throw inboundError("LEGACY_REVIEW_REQUIRED", 409);
    if (existing.webhook_receipt_id !== receipt.id || (input.lead_id && input.lead_id !== existing.lead_id)) throw inboundError("INBOUND_IDENTITY_CONFLICT", 409);
    new InboundEventsRepository(tx).assertCompatibleReceipt(existing, { lead_id: existing.lead_id, channel: input.channel, payload: input.payload });
    const lead = await new LeadsRepository(tx).getLead(existing.lead_id);
    if (!lead || lead.organization_id !== input.organization_id) throw inboundError("INBOUND_LEAD_NOT_FOUND", 404);
    if (input.contact) {
      const contact = canonicalContact(input.contact), original = existing.payload._ingress_contact || {};
      if ((contact.email && contact.email !== original.email) || (contact.phone && contact.phone !== original.phone)) throw inboundError("INBOUND_IDENTITY_CONFLICT", 409);
    }
    return lead;
  }

  async #resolveLead(tx, input) {
    const leads = new LeadsRepository(tx);
    if (input.lead_id) {
      const lead = await leads.getLead(input.lead_id);
      if (!lead || lead.organization_id !== input.organization_id) throw inboundError("INBOUND_LEAD_NOT_FOUND", 404);
      return { lead, created: false };
    }
    const contact = canonicalContact(input.contact);
    if (!contact.email && !contact.phone) throw inboundError("INBOUND_IDENTITY_MISSING", 400);
    const matches = await tx.all("SELECT * FROM leads WHERE organization_id = ? AND ((? IS NOT NULL AND normalized_email = ?) OR (? IS NOT NULL AND normalized_phone = ?)) LIMIT 2", [input.organization_id, contact.email, contact.email, contact.phone, contact.phone]);
    if (matches.length > 1) throw inboundError("INBOUND_IDENTITY_AMBIGUOUS", 409);
    if (matches.length === 1) return { lead: matches[0], created: false };
    return { lead: await leads.createLead({ organization_id: input.organization_id,
      name: normalizeString(input.contact?.name) || contact.email || contact.phone,
      email: contact.email, normalized_email: contact.email, phone: contact.phone,
      source: ["EMAIL", "WHATSAPP", "SMS", "VOICE"].includes(input.channel) ? input.channel : "EXTERNAL_PROVIDER" }), created: true };
  }

  async #stopWork(tx, organizationId, leadId, eventType) {
    await new FollowUpsRepository(tx).cancelOpenForLead(organizationId, leadId);
    await new WorkflowsRepository(tx).stopOpenForLead(organizationId, leadId, SUMMARIES[eventType]);
  }
}

export function normalizeInboundInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw inboundError("INBOUND_INPUT_INVALID", 400);
  const { organization_id, lead_id = null, contact = null, channel, provider = "mock-channel", provider_event_id, event_type = null, payload = {} } = input;
  if (!validateChannel(channel) || typeof organization_id !== "string" || !organization_id.trim()
    || typeof provider !== "string" || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(provider)
    || typeof provider_event_id !== "string" || !provider_event_id.trim() || provider_event_id.length > 512
    || (lead_id != null && (typeof lead_id !== "string" || !lead_id.trim() || lead_id.length > 200))) throw inboundError("INBOUND_IDENTITY_INVALID", 400);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw inboundError("INBOUND_INPUT_INVALID", 400);
  const cleanPayload = {};
  for (const key of ["text", "transcript", "summary", "subject"]) {
    if (payload[key] != null && typeof payload[key] !== "string") throw inboundError("INBOUND_INPUT_INVALID", 400);
    if (payload[key] != null) cleanPayload[key] = payload[key];
  }
  if (contact && (typeof contact !== "object" || Array.isArray(contact)
    || (contact.email != null && (typeof contact.email !== "string" || !normalizeEmail(contact.email).valid))
    || (contact.phone != null && (typeof contact.phone !== "string" || !normalizePhone(contact.phone, "INTERNATIONAL_ONLY").valid)))) throw inboundError("INBOUND_SENDER_INVALID", 400);
  const sender = contact ? { ...canonicalContact(contact), name: normalizeString(contact.name) || null } : null;
  return { organization_id, lead_id, contact: sender, channel, provider, provider_event_id, event_type, payload: cleanPayload, ...(input.identity_context ? { identity_context: normalizedIdentityContext(input.identity_context) } : {}), ...(typeof input.identity_error === "string" ? { identity_error: input.identity_error } : {}) };
}

function canonicalContact(contact) { return { email: normalizeEmail(contact?.email).value, phone: normalizePhone(contact?.phone, "INTERNATIONAL_ONLY").normalized_phone }; }
function sentiment(eventType) { return { POSITIVE_REPLY: "POSITIVE", NEGATIVE_REPLY: "NEGATIVE" }[eventType] || eventType; }
function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function inboundError(code, statusCode) { return Object.assign(new Error("Inbound event requires processing review."), { code, statusCode }); }

function normalizedIdentityContext(context) {
  const bounded = (value, max) => typeof value === "string" ? value.slice(0, max) : null;
  return { recipients: bounded(context.recipients, 2000), date: bounded(context.date, 200), text_hash: bounded(context.text_hash, 64),
    envelope: context.envelope ? { from: bounded(context.envelope.from, 320), to: Array.isArray(context.envelope.to) ? context.envelope.to.slice(0, 100).map((value) => bounded(value, 320)).filter(Boolean).sort() : [] } : null };
}
