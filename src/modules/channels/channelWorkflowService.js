import {
  CHANNEL_DIRECTION,
  CHANNEL_MESSAGE_STATUS,
  CHANNEL_TYPES,
  FOLLOW_UP_STATUS,
  INBOUND_EVENT_TYPES,
  channelForActionType,
  validateChannel,
  validateInboundEventType
} from "./channelContract.js";
import { normalizeEmail, normalizePhone, normalizeString } from "../data-foundation/normalization.js";
import { nowIso } from "../../shared/time.js";

const CHANNEL_LEAD_SOURCE = {
  EMAIL: "EMAIL",
  WHATSAPP: "WHATSAPP",
  SMS: "SMS",
  VOICE: "VOICE"
};

export class ChannelWorkflowService {
  constructor({
    leadsRepository,
    actionsRepository,
    channelMessagesRepository,
    inboundEventsRepository,
    followUpsRepository,
    auditRepository,
    workflowService = null,
    replyClassifier = null,
    eventsRepository = null,
    intelligenceService = null
  }) {
    this.leadsRepository = leadsRepository;
    this.actionsRepository = actionsRepository;
    this.channelMessagesRepository = channelMessagesRepository;
    this.inboundEventsRepository = inboundEventsRepository;
    this.followUpsRepository = followUpsRepository;
    this.auditRepository = auditRepository;
    this.workflowService = workflowService;
    this.replyClassifier = replyClassifier;
    this.eventsRepository = eventsRepository;
    this.intelligenceService = intelligenceService;
  }

  availableChannels() {
    return {
      channels: [
        { channel: CHANNEL_TYPES.EMAIL, status: "MOCK_ONLY", direction: "OUTBOUND_AND_INBOUND" },
        { channel: CHANNEL_TYPES.WHATSAPP, status: "MOCK_ONLY", direction: "OUTBOUND_AND_INBOUND" },
        { channel: CHANNEL_TYPES.VOICE, status: "MOCK_ONLY", direction: "OUTBOUND_AND_INBOUND" },
        { channel: CHANNEL_TYPES.SMS, status: "MOCK_ONLY", direction: "OUTBOUND_AND_INBOUND" },
        { channel: CHANNEL_TYPES.HUMAN_TASK, status: "MOCK_ONLY", direction: "OUTBOUND" },
        { channel: CHANNEL_TYPES.CRM, status: "CONTRACT_ONLY", direction: "OUTBOUND" }
      ]
    };
  }

  async recordOutboundExecutionAttempt({ action, payload, attempt, result, execution }) {
    const channel = channelForActionType(action.type);
    const status = result.ok
      ? channel === CHANNEL_TYPES.HUMAN_TASK
        ? CHANNEL_MESSAGE_STATUS.QUEUED
        : CHANNEL_MESSAGE_STATUS.SENT
      : CHANNEL_MESSAGE_STATUS.FAILED;
    const message = await this.channelMessagesRepository.create({
      organization_id: action.organization_id,
      lead_id: action.lead_id,
      action_id: action.id,
      direction: CHANNEL_DIRECTION.OUTBOUND,
      channel,
      status,
      subject: payload.title || payload.reason || action.type,
      body: outboundBody(payload),
      summary: result.ok ? result.summary || outboundBody(payload) : result.error,
      provider: result.provider || action.provider || "mock-channel",
      provider_reference: result.provider_reference || null,
      idempotency_key: `${execution.idempotency_key}:channel-message`,
      payload: {
        action_type: action.type,
        attempt,
        execution_id: execution.id,
        mock_behavior: payload.mock_behavior || "SUCCESS",
        plan_id: payload.plan_id || null
      }
    });
    await this.auditRepository?.record({
      organization_id: action.organization_id,
      lead_id: action.lead_id,
      action_id: action.id,
      event_type: result.ok ? "ChannelMessageStarted" : "ChannelMessageFailed",
      message: result.ok ? "Outbound activity recorded through the channel boundary." : "Outbound channel attempt failed.",
      metadata: { channel, message_id: message.id, attempt }
    });
    return message;
  }

  async recordExecutionCallback({ action, callback, status, provider_reference = null }) {
    const message = await this.channelMessagesRepository.latestOutboundForAction(action.id, action.organization_id);
    let updatedMessage = message;
    if (message) {
      updatedMessage = await this.channelMessagesRepository.updateStatus(
        message.id,
        status === "COMPLETED" ? CHANNEL_MESSAGE_STATUS.DELIVERED : CHANNEL_MESSAGE_STATUS.FAILED,
        {
          provider_reference,
          // Keep the original send-time summary (e.g. a mock voice transcript) instead of
          // clobbering it with a generic message; only failures get an explicit note.
          summary: status === "COMPLETED" ? null : "Outbound activity failed."
        }
      );
    }
    const followUp = status === "COMPLETED" ? await this.scheduleNoResponseFollowUp(action) : null;
    return { message: updatedMessage, follow_up: followUp, callback };
  }

  async receiveInboundEvent({
    organization_id,
    lead_id = null,
    contact = null,
    channel,
    provider = "mock-channel",
    provider_event_id,
    event_type = null,
    payload = {}
  }) {
    if (!validateChannel(channel)) {
      throw validationError("channel is invalid.");
    }

    let classification = null;
    let resolvedEventType = event_type;
    if (!resolvedEventType) {
      if (!this.replyClassifier) {
        throw validationError("event_type is required (no reply classifier configured).");
      }
      if (!payload.text) {
        throw validationError("payload.text is required to auto-classify a reply when event_type is omitted.");
      }
      classification = await this.replyClassifier.classify(payload.text);
      resolvedEventType = classification.event_type;
    }
    if (!validateInboundEventType(resolvedEventType)) {
      throw validationError("event_type is invalid.");
    }

    const { lead, created: leadCreated } = await this.#resolveOrCreateLead({ organization_id, lead_id, contact, channel });
    lead_id = lead.id;

    const { inbound_event: inboundEvent, duplicate } = await this.inboundEventsRepository.create({
      organization_id,
      lead_id,
      channel,
      provider,
      provider_event_id,
      event_type: resolvedEventType,
      sentiment: sentimentForEvent(resolvedEventType),
      confidence: classification?.confidence || null,
      reason: classification?.reason || null,
      suggested_next_step: classification?.suggested_next_step || null,
      payload: classification ? { ...payload, classification } : payload
    });
    const summary = classification
      ? `Classified as ${inboundEventLabel(resolvedEventType)} (${classification.confidence.toLowerCase()} confidence): ${classification.reason}`
      : inboundEventSummary(resolvedEventType);
    const message = await this.channelMessagesRepository.create({
      organization_id,
      lead_id,
      inbound_event_id: inboundEvent.id,
      direction: CHANNEL_DIRECTION.INBOUND,
      channel,
      status: CHANNEL_MESSAGE_STATUS.RECEIVED,
      subject: inboundEventLabel(resolvedEventType),
      body: payload.text || payload.transcript || payload.summary || null,
      summary,
      provider,
      provider_event_id,
      idempotency_key: `inbound:${provider_event_id}:message`,
      classification_event_type: resolvedEventType,
      classification_confidence: classification?.confidence || null,
      suggested_next_step: classification?.suggested_next_step || null,
      payload: { event_type: resolvedEventType, classification, payload }
    });

    const escalate = classification?.confidence === "LOW";
    const followUp = duplicate
      ? null
      : await this.applyInboundEventToFollowUps({
          lead,
          inboundEvent,
          event_type: resolvedEventType,
          channel,
          escalate,
          suggestedNextStep: classification?.suggested_next_step || null
        });
    if (!duplicate && resolvedEventType === INBOUND_EVENT_TYPES.OPT_OUT) {
      await this.leadsRepository.updateLeadStatus(lead.id, "OPTED_OUT");
    } else if (!duplicate) {
      await this.leadsRepository.updateLeadStatus(lead.id, "ACTIVE");
    }
    if (!duplicate) {
      await this.auditRepository?.record({
        organization_id,
        lead_id,
        event_type: "InboundEventReceived",
        message: "Inbound channel event recorded.",
        metadata: { channel, event_type: resolvedEventType, provider_event_id, message_id: message.id, classification }
      });
      // Two-part refresh, deliberately split by cost.
      //
      // The snapshot re-run is deterministic and cheap, so it happens inline and
      // the reply shows up as a signal on the Intelligence tab immediately. It
      // must never block the inbound write path, hence the catch — the same
      // defensive posture the reply classifier takes toward its LLM call.
      try {
        await this.intelligenceService?.runForLead(await this.leadsRepository.getLead(lead.id));
      } catch (error) {
        console.error("Intelligence refresh after inbound reply failed:", error.message);
      }

      // Re-running synthesis -> recommendation -> next best action is the
      // expensive half (and, with an LLM configured, involves network calls), so
      // it goes on the domain event queue instead of inside a provider webhook.
      // The worker retries it; a slow or failing re-analysis can never cause a
      // provider to see a failed webhook and redeliver the reply.
      await this.eventsRepository?.publish({
        organization_id,
        lead_id: lead.id,
        type: "LeadReplyReceived",
        payload: {
          lead_id: lead.id,
          inbound_event_id: inboundEvent.id,
          channel,
          event_type: resolvedEventType,
          confidence: classification?.confidence || null
        }
      });
    }

    return { inbound_event: inboundEvent, message, follow_up: followUp, duplicate, classification, lead, lead_created: leadCreated };
  }

  // Real inbound contact (an email/SMS/WhatsApp message or call from someone not yet a lead)
  // should be capturable as a new lead, not just attachable to an existing one. Resolution order:
  // explicit lead_id > match by normalized email/phone within the workspace > create a new lead.
  async #resolveOrCreateLead({ organization_id, lead_id, contact, channel }) {
    if (lead_id) {
      const lead = await this.leadsRepository.getLead(lead_id);
      if (!lead || lead.organization_id !== organization_id) {
        throw notFoundError("Lead not found for workspace.");
      }
      return { lead, created: false };
    }

    if (!contact || (!contact.email && !contact.phone)) {
      throw validationError("Either lead_id or contact.email/contact.phone is required.");
    }

    const email = normalizeEmail(contact.email);
    if (contact.email && !email.valid) {
      throw validationError("contact.email must be a valid email address.");
    }
    const phone = normalizePhone(contact.phone, "INTERNATIONAL_ONLY");
    if (contact.phone && !phone.valid) {
      throw validationError(phone.message || "contact.phone must be a valid international number.");
    }

    const existing =
      await this.leadsRepository.findByNormalizedEmail(organization_id, email.value) ||
      await this.leadsRepository.findByNormalizedPhone(organization_id, phone.normalized_phone);
    if (existing) {
      return { lead: existing, created: false };
    }

    const lead = await this.leadsRepository.createLead({
      organization_id,
      name: normalizeString(contact.name) || contact.email || contact.phone || "New inbound contact",
      email: contact.email || null,
      phone: contact.phone || null,
      normalized_email: email.value,
      normalized_phone: phone.normalized_phone,
      source: CHANNEL_LEAD_SOURCE[channel] || "EXTERNAL_PROVIDER"
    });
    await this.eventsRepository?.publish({
      organization_id: lead.organization_id,
      lead_id: lead.id,
      type: "LeadCreated",
      payload: { lead_id: lead.id, source: lead.source }
    });
    await this.auditRepository?.record({
      organization_id,
      lead_id: lead.id,
      event_type: "LeadCreated",
      message: `New lead captured from inbound ${channel.toLowerCase()} contact.`,
      metadata: { channel, source: lead.source }
    });
    return { lead, created: true };
  }

  async listLeadTimeline({ organization_id, lead_id }) {
    const lead = await this.leadsRepository.getLead(lead_id);
    if (!lead || lead.organization_id !== organization_id) {
      throw notFoundError("Lead not found for workspace.");
    }
    const messages = (await this.channelMessagesRepository.listForLead(organization_id, lead_id)).map((message) => ({
      kind: "message",
      id: message.id,
      direction: message.direction,
      channel: message.channel,
      status: message.status,
      title: message.subject || channelTitle(message),
      // What was actually said comes first. `summary` is our own description of
      // the message ("Classified as Question received (medium confidence): ...")
      // and reading it in a conversation bubble instead of the lead's own words
      // is what made the thread look like an audit log. It is still returned
      // separately, and the UI renders the classification as a badge.
      message: message.body || message.summary || "Channel activity recorded.",
      summary: message.summary || null,
      classification_event_type: message.classification_event_type || null,
      classification_confidence: message.classification_confidence || null,
      suggested_next_step: message.suggested_next_step || null,
      occurred_at: message.occurred_at
    }));
    const followUps = (await this.followUpsRepository.listForLead(organization_id, lead_id)).map((followUp) => ({
      kind: "follow_up",
      id: followUp.id,
      channel: followUp.channel,
      status: followUp.status,
      title: "Follow-up",
      message: followUp.reason,
      escalated: !!followUp.escalated,
      occurred_at: followUp.due_at || followUp.created_at
    }));
    return {
      lead_id,
      organization_id,
      timeline: [...messages, ...followUps].sort((first, second) =>
        String(second.occurred_at || "").localeCompare(String(first.occurred_at || ""))
      )
    };
  }

  async listFollowUps({ organization_id, status = null }) {
    return {
      follow_ups: await this.followUpsRepository.listForOrganization(organization_id, { status })
    };
  }

  async completeFollowUp({ organization_id, follow_up_id }) {
    const followUp = await this.followUpsRepository.getForOrganization(follow_up_id, organization_id);
    if (!followUp) {
      throw notFoundError("Follow-up not found for workspace.");
    }
    if (followUp.status === FOLLOW_UP_STATUS.COMPLETED) {
      return { follow_up: followUp, duplicate: true };
    }
    return {
      follow_up: await this.followUpsRepository.complete(follow_up_id, organization_id),
      duplicate: false
    };
  }

  async cancelFollowUp({ organization_id, follow_up_id }) {
    const followUp = await this.followUpsRepository.getForOrganization(follow_up_id, organization_id);
    if (!followUp) {
      throw notFoundError("Follow-up not found for workspace.");
    }
    if (followUp.status === "CANCELLED") {
      return { follow_up: followUp, duplicate: true };
    }
    return {
      follow_up: await this.followUpsRepository.cancel(follow_up_id, organization_id),
      duplicate: false
    };
  }

  async scheduleNoResponseFollowUp(action) {
    if (!["SEND_EMAIL", "SEND_WHATSAPP", "SEND_SMS"].includes(action.type)) {
      return null;
    }
    return await this.followUpsRepository.create({
      organization_id: action.organization_id,
      lead_id: action.lead_id,
      action_id: action.id,
      channel: channelForActionType(action.type),
      status: FOLLOW_UP_STATUS.PLANNED,
      due_at: plusHours(48),
      reason: "Follow up if no response is received.",
      idempotency_key: `action:${action.id}:no-response-follow-up:v1`
    });
  }

  async applyInboundEventToFollowUps({ lead, inboundEvent, event_type, channel, escalate = false, suggestedNextStep = null }) {
    if ([INBOUND_EVENT_TYPES.POSITIVE_REPLY, INBOUND_EVENT_TYPES.NEGATIVE_REPLY, INBOUND_EVENT_TYPES.OPT_OUT].includes(event_type)) {
      await this.followUpsRepository.cancelOpenForLead(lead.organization_id, lead.id);
      await this.workflowService?.stopOpenRunsForLead({
        organization_id: lead.organization_id,
        lead_id: lead.id,
        reason: inboundEventSummary(event_type)
      });
      return null;
    }
    if (event_type === INBOUND_EVENT_TYPES.QUESTION || event_type === INBOUND_EVENT_TYPES.UNKNOWN) {
      // A reply the classifier couldn't confidently place gets escalated: same DUE follow-up
      // mechanism, but flagged in the reason text so it surfaces as high-priority attention
      // instead of blending in with routine question follow-ups.
      const baseReason = escalate
        ? "Escalated: could not automatically classify this reply — needs human review."
        : event_type === INBOUND_EVENT_TYPES.QUESTION
          ? "Answer the lead's question."
          : "Review the inbound response.";
      const reason = suggestedNextStep && !escalate ? `${baseReason} Suggested: ${suggestedNextStep}` : baseReason;
      return await this.followUpsRepository.create({
        organization_id: lead.organization_id,
        lead_id: lead.id,
        inbound_event_id: inboundEvent.id,
        channel,
        status: FOLLOW_UP_STATUS.DUE,
        due_at: nowIso(),
        reason,
        idempotency_key: `inbound:${inboundEvent.id}:human-review-follow-up:v1`,
        escalated: escalate
      });
    }
    return null;
  }
}

function outboundBody(payload) {
  return (
    payload.human_review?.edited_payload?.instruction ||
    payload.message ||
    payload.rationale ||
    payload.reason ||
    "Outbound activity prepared from the recommended next step."
  );
}

function sentimentForEvent(eventType) {
  const map = {
    POSITIVE_REPLY: "POSITIVE",
    NEGATIVE_REPLY: "NEGATIVE",
    QUESTION: "QUESTION",
    OPT_OUT: "OPT_OUT",
    UNKNOWN: "UNKNOWN"
  };
  return map[eventType] || "UNKNOWN";
}

function inboundEventLabel(eventType) {
  const labels = {
    POSITIVE_REPLY: "Positive response",
    NEGATIVE_REPLY: "Negative response",
    QUESTION: "Question received",
    OPT_OUT: "Opt-out received",
    UNKNOWN: "Response received"
  };
  return labels[eventType] || "Response received";
}

function inboundEventSummary(eventType) {
  const labels = {
    POSITIVE_REPLY: "Lead responded positively. Open follow-ups were stopped.",
    NEGATIVE_REPLY: "Lead responded negatively. Open follow-ups were stopped.",
    QUESTION: "Lead asked a question. A follow-up is due.",
    OPT_OUT: "Lead opted out. Contact should stop.",
    UNKNOWN: "Inbound response needs review."
  };
  return labels[eventType] || "Inbound response recorded.";
}

function channelTitle(message) {
  const direction = message.direction === CHANNEL_DIRECTION.INBOUND ? "Inbound" : "Outbound";
  return `${direction} ${String(message.channel || "channel").toLowerCase()} activity`;
}

function plusHours(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function notFoundError(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}
