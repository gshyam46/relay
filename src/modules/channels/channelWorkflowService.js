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
import { nowIso } from "../../shared/time.js";

export class ChannelWorkflowService {
  constructor({
    leadsRepository,
    actionsRepository,
    channelMessagesRepository,
    inboundEventsRepository,
    followUpsRepository,
    auditRepository,
    workflowService = null
  }) {
    this.leadsRepository = leadsRepository;
    this.actionsRepository = actionsRepository;
    this.channelMessagesRepository = channelMessagesRepository;
    this.inboundEventsRepository = inboundEventsRepository;
    this.followUpsRepository = followUpsRepository;
    this.auditRepository = auditRepository;
    this.workflowService = workflowService;
  }

  availableChannels() {
    return {
      channels: [
        { channel: CHANNEL_TYPES.EMAIL, status: "MOCK_ONLY", direction: "OUTBOUND_AND_INBOUND" },
        { channel: CHANNEL_TYPES.WHATSAPP, status: "MOCK_ONLY", direction: "OUTBOUND_AND_INBOUND" },
        { channel: CHANNEL_TYPES.VOICE, status: "CONTRACT_ONLY", direction: "OUTBOUND_AND_INBOUND" },
        { channel: CHANNEL_TYPES.SMS, status: "CONTRACT_ONLY", direction: "OUTBOUND_AND_INBOUND" },
        { channel: CHANNEL_TYPES.HUMAN_TASK, status: "MOCK_ONLY", direction: "OUTBOUND" },
        { channel: CHANNEL_TYPES.CRM, status: "CONTRACT_ONLY", direction: "OUTBOUND" }
      ]
    };
  }

  recordOutboundExecutionAttempt({ action, payload, attempt, result, execution }) {
    const channel = channelForActionType(action.type);
    const status = result.ok
      ? channel === CHANNEL_TYPES.HUMAN_TASK
        ? CHANNEL_MESSAGE_STATUS.QUEUED
        : CHANNEL_MESSAGE_STATUS.SENT
      : CHANNEL_MESSAGE_STATUS.FAILED;
    const message = this.channelMessagesRepository.create({
      organization_id: action.organization_id,
      lead_id: action.lead_id,
      action_id: action.id,
      direction: CHANNEL_DIRECTION.OUTBOUND,
      channel,
      status,
      subject: payload.title || payload.reason || action.type,
      body: outboundBody(payload),
      summary: result.ok ? "Outbound step accepted by the mock channel boundary." : result.error,
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
    this.auditRepository?.record({
      organization_id: action.organization_id,
      lead_id: action.lead_id,
      action_id: action.id,
      event_type: result.ok ? "ChannelMessageStarted" : "ChannelMessageFailed",
      message: result.ok ? "Outbound activity recorded through the channel boundary." : "Outbound channel attempt failed.",
      metadata: { channel, message_id: message.id, attempt }
    });
    return message;
  }

  recordExecutionCallback({ action, callback, status, provider_reference = null }) {
    const message = this.channelMessagesRepository.latestOutboundForAction(action.id, action.organization_id);
    let updatedMessage = message;
    if (message) {
      updatedMessage = this.channelMessagesRepository.updateStatus(
        message.id,
        status === "COMPLETED" ? CHANNEL_MESSAGE_STATUS.DELIVERED : CHANNEL_MESSAGE_STATUS.FAILED,
        {
          provider_reference,
          summary: status === "COMPLETED" ? "Outbound activity completed through callback." : "Outbound activity failed."
        }
      );
    }
    const followUp = status === "COMPLETED" ? this.scheduleNoResponseFollowUp(action) : null;
    return { message: updatedMessage, follow_up: followUp, callback };
  }

  receiveMockInboundEvent({ organization_id, lead_id, channel, provider_event_id, event_type, payload = {} }) {
    if (!validateChannel(channel)) {
      throw validationError("channel is invalid.");
    }
    if (!validateInboundEventType(event_type)) {
      throw validationError("event_type is invalid.");
    }
    const lead = this.leadsRepository.getLead(lead_id);
    if (!lead || lead.organization_id !== organization_id) {
      throw notFoundError("Lead not found for workspace.");
    }

    const { inbound_event: inboundEvent, duplicate } = this.inboundEventsRepository.create({
      organization_id,
      lead_id,
      channel,
      provider: "mock-channel",
      provider_event_id,
      event_type,
      sentiment: sentimentForEvent(event_type),
      payload
    });
    const message = this.channelMessagesRepository.create({
      organization_id,
      lead_id,
      inbound_event_id: inboundEvent.id,
      direction: CHANNEL_DIRECTION.INBOUND,
      channel,
      status: CHANNEL_MESSAGE_STATUS.RECEIVED,
      subject: inboundEventLabel(event_type),
      body: payload.text || payload.transcript || payload.summary || null,
      summary: inboundEventSummary(event_type),
      provider: "mock-channel",
      provider_event_id,
      idempotency_key: `inbound:${provider_event_id}:message`,
      payload: { event_type, payload }
    });

    const followUp = duplicate ? null : this.applyInboundEventToFollowUps({ lead, inboundEvent, event_type, channel });
    if (!duplicate && event_type === INBOUND_EVENT_TYPES.OPT_OUT) {
      this.leadsRepository.updateLeadStatus(lead.id, "OPTED_OUT");
    } else if (!duplicate) {
      this.leadsRepository.updateLeadStatus(lead.id, "ACTIVE");
    }
    if (!duplicate) {
      this.auditRepository?.record({
        organization_id,
        lead_id,
        event_type: "InboundEventReceived",
        message: "Inbound channel event recorded.",
        metadata: { channel, event_type, provider_event_id, message_id: message.id }
      });
    }

    return { inbound_event: inboundEvent, message, follow_up: followUp, duplicate };
  }

  listLeadTimeline({ organization_id, lead_id }) {
    const lead = this.leadsRepository.getLead(lead_id);
    if (!lead || lead.organization_id !== organization_id) {
      throw notFoundError("Lead not found for workspace.");
    }
    const messages = this.channelMessagesRepository.listForLead(organization_id, lead_id).map((message) => ({
      kind: "message",
      id: message.id,
      direction: message.direction,
      channel: message.channel,
      status: message.status,
      title: message.subject || channelTitle(message),
      message: message.summary || message.body || "Channel activity recorded.",
      occurred_at: message.occurred_at
    }));
    const followUps = this.followUpsRepository.listForLead(organization_id, lead_id).map((followUp) => ({
      kind: "follow_up",
      id: followUp.id,
      channel: followUp.channel,
      status: followUp.status,
      title: "Follow-up",
      message: followUp.reason,
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

  listFollowUps({ organization_id, status = null }) {
    return {
      follow_ups: this.followUpsRepository.listForOrganization(organization_id, { status })
    };
  }

  completeFollowUp({ organization_id, follow_up_id }) {
    const followUp = this.followUpsRepository.getForOrganization(follow_up_id, organization_id);
    if (!followUp) {
      throw notFoundError("Follow-up not found for workspace.");
    }
    if (followUp.status === FOLLOW_UP_STATUS.COMPLETED) {
      return { follow_up: followUp, duplicate: true };
    }
    return {
      follow_up: this.followUpsRepository.complete(follow_up_id, organization_id),
      duplicate: false
    };
  }

  scheduleNoResponseFollowUp(action) {
    if (!["SEND_EMAIL", "SEND_WHATSAPP"].includes(action.type)) {
      return null;
    }
    return this.followUpsRepository.create({
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

  applyInboundEventToFollowUps({ lead, inboundEvent, event_type, channel }) {
    if ([INBOUND_EVENT_TYPES.POSITIVE_REPLY, INBOUND_EVENT_TYPES.NEGATIVE_REPLY, INBOUND_EVENT_TYPES.OPT_OUT].includes(event_type)) {
      this.followUpsRepository.cancelOpenForLead(lead.organization_id, lead.id);
      this.workflowService?.stopOpenRunsForLead({
        organization_id: lead.organization_id,
        lead_id: lead.id,
        reason: inboundEventSummary(event_type)
      });
      return null;
    }
    if (event_type === INBOUND_EVENT_TYPES.QUESTION || event_type === INBOUND_EVENT_TYPES.UNKNOWN) {
      return this.followUpsRepository.create({
        organization_id: lead.organization_id,
        lead_id: lead.id,
        inbound_event_id: inboundEvent.id,
        channel,
        status: FOLLOW_UP_STATUS.DUE,
        due_at: nowIso(),
        reason: event_type === INBOUND_EVENT_TYPES.QUESTION ? "Answer the lead's question." : "Review the inbound response.",
        idempotency_key: `inbound:${inboundEvent.id}:human-review-follow-up:v1`
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
