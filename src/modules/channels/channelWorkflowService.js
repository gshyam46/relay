import { reviewContextRevisions } from "../lead-intelligence/businessFitAuthority.js";
import { evaluateFreshness } from "../lead-intelligence/freshnessService.js";
import { leadDataRevision } from "../data-foundation/leadDataSafety.js";
import { PreparedActionService } from "../outbound-automation/preparedActionService.js";
import { loadLeadBusinessContext } from "../business-context/businessContextRepository.js";
import { hasAmbiguousReplySinceInTransaction } from "./ambiguousInboundSafety.js";
import { LocalReplyClassifier } from "./replyClassifier.js";
import { InboundMessageService } from "./inboundMessageService.js";
import { assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";
import { FollowUpsRepository } from "./followUpsRepository.js";
import { ChannelMessagesRepository } from "./channelMessagesRepository.js";
import { ExecutionsRepository } from "../outbound-automation/executionsRepository.js";
import { ActionsRepository } from "../outbound-automation/actionsRepository.js";
import { fingerprint } from "../outbound-automation/preparedActionContract.js";
import { AuditRepository } from "../events/auditRepository.js";
import {
  CHANNEL_DIRECTION,
  CHANNEL_MESSAGE_STATUS,
  CHANNEL_TYPES,
  FOLLOW_UP_STATUS,
  channelForActionType
} from "./channelContract.js";

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
    intelligenceService = null,
    contactPolicyService = null,
    now = Date.now
  }) {
    this.now = now;
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
    this.contactPolicyService = contactPolicyService;
    this.localReplyClassifier = new LocalReplyClassifier();
    this.inboundMessageService = new InboundMessageService({
      db: leadsRepository.db, replyClassifier, localReplyClassifier: this.localReplyClassifier,
      contactPolicyService, workflowService, intelligenceService, eventsRepository, auditRepository
    });
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

  async recordOutboundExecutionAttempt({ action, payload, attempt, result, execution, approvedDispatch = null }) {
    const channel = channelForActionType(action.type);
    const isCustomerMessage = action.type.startsWith("SEND_");
    const envelope = approvedDispatch?.envelope;
    if (isCustomerMessage && (!envelope || envelope.organization_id !== action.organization_id
      || envelope.action_id !== action.id || envelope.action_type !== action.type || envelope.channel !== channel)) {
      throw validationError("An exact captured dispatch envelope is required to record this outbound message.");
    }
    const renderedBody = envelope ? envelope.body : outboundBody(payload);
    return this.#contactPolicy().withWorkspacePolicyTransaction(action.organization_id, async (tx) => {
      const persistedAction = await new ActionsRepository(tx).getActionForOrganization(action.id, action.organization_id);
      if (!persistedAction || persistedAction.lead_id !== action.lead_id || persistedAction.type !== action.type) {
        throw validationError("Outbound message must identify its persisted workspace action.");
      }
      const recordedExecution = await new ExecutionsRepository(tx).getExecution(execution.id);
      if (!recordedExecution || recordedExecution.action_id !== action.id) {
        throw validationError("Outbound message must identify its persisted action execution.");
      }
      // The provider callback may arrive before the adapter response is recorded.
      // Read its persisted outcome under the same gate as callback message writes.
      const status = recordedExecution.status === "COMPLETED"
        ? channel === CHANNEL_TYPES.HUMAN_TASK ? CHANNEL_MESSAGE_STATUS.COMPLETED : CHANNEL_MESSAGE_STATUS.DELIVERED
        : recordedExecution.status === "FAILED" ? CHANNEL_MESSAGE_STATUS.FAILED
        : result.ok ? channel === CHANNEL_TYPES.HUMAN_TASK ? CHANNEL_MESSAGE_STATUS.QUEUED : CHANNEL_MESSAGE_STATUS.SENT
        : CHANNEL_MESSAGE_STATUS.FAILED;
      const message = await new ChannelMessagesRepository(tx).create({
        organization_id: action.organization_id,
        lead_id: action.lead_id,
        action_id: action.id,
        direction: CHANNEL_DIRECTION.OUTBOUND,
        channel,
        status,
        subject: envelope ? envelope.subject : payload.title || payload.reason || action.type,
        body: renderedBody,
        summary: status === CHANNEL_MESSAGE_STATUS.FAILED
          ? recordedExecution.error || result.error || "Outbound activity failed."
          : result.summary || renderedBody,
        provider: recordedExecution.provider || result.provider || action.provider || "mock-channel",
        provider_reference: recordedExecution.provider_reference || result.provider_reference || null,
        idempotency_key: `${recordedExecution.idempotency_key}:channel-message`,
        payload: {
          action_type: action.type,
          attempt,
          execution_id: recordedExecution.id,
          mock_behavior: payload.mock_behavior || "SUCCESS",
          plan_id: payload.plan_id || null,
          ...(envelope ? {
            prepared_revision_id: approvedDispatch.revision_id,
            envelope_hash: approvedDispatch.envelope_hash,
            recipient: envelope.recipient,
            sender: envelope.sender,
            scheduled_at: envelope.scheduled_at
          } : {})
        }
      });
      if (this.auditRepository) {
        await new AuditRepository(tx).record({
          organization_id: action.organization_id,
          lead_id: action.lead_id,
          action_id: action.id,
          event_type: status === CHANNEL_MESSAGE_STATUS.FAILED ? "ChannelMessageFailed" : "ChannelMessageStarted",
          message: status === CHANNEL_MESSAGE_STATUS.FAILED ? "Outbound channel attempt failed." : "Outbound activity recorded through the channel boundary.",
          metadata: { channel, message_id: message.id, attempt }
        });
      }
      return message;
    });
  }

  async recordExecutionCallback(input) {
    return this.#contactPolicy().withWorkspacePolicyTransaction(input.action.organization_id,
      (tx) => this.recordExecutionCallbackInTransaction(tx, input));
  }

  async recordExecutionCallbackInTransaction(tx, { action, execution, callback, status,
    provider_reference = null, allow_follow_up = true }) {
    assertWorkspaceTransaction(tx, action.organization_id);
    if (!execution || execution.action_id !== action.id) throw effectError("CALLBACK_IDENTITY_CONFLICT");
    const current = await new ActionsRepository(tx).getActionForUpdate(action.id, action.organization_id);
    const persisted = await new ExecutionsRepository(tx).getExecutionForOrganization(execution.id, action.organization_id);
    if (!current || !persisted || current.active_execution_id !== persisted.id
      || persisted.fence_token === null || Number(current.execution_fence) !== Number(persisted.fence_token)
      || persisted.outcome_class === "CLOSED_UNRESOLVED" || persisted.status !== status) {
      return { message: null, follow_up: null, callback, skipped: true, reason: "STALE_OR_TERMINAL_EXECUTION" };
    }
    const messages = new ChannelMessagesRepository(tx);
    const messageKey = persisted.idempotency_key + ":channel-message";
    let message = await messages.getByIdempotencyKey(action.organization_id, messageKey);
    const channel = channelForActionType(current.type);
    const messageStatus = status === "COMPLETED"
      ? channel === CHANNEL_TYPES.HUMAN_TASK ? CHANNEL_MESSAGE_STATUS.COMPLETED : CHANNEL_MESSAGE_STATUS.DELIVERED
      : CHANNEL_MESSAGE_STATUS.FAILED;
    if (!message) {
      const revision = await tx.get("SELECT * FROM action_revisions WHERE id = ? AND organization_id = ? AND action_id = ?",
        [persisted.action_revision_id, action.organization_id, action.id]);
      if (!revision) throw effectError(channel === CHANNEL_TYPES.HUMAN_TASK
        ? "MISSING_IMMUTABLE_TASK_COPY" : "MISSING_IMMUTABLE_REVISION");
      let envelope;
      try { envelope = JSON.parse(revision.envelope_json); }
      catch { throw effectError("CALLBACK_IMMUTABLE_COPY_INVALID"); }
      if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)
        || revision.content_hash !== persisted.envelope_hash || fingerprint(envelope) !== persisted.envelope_hash
        || envelope.organization_id !== action.organization_id || envelope.action_id !== action.id
        || envelope.action_type !== current.type || envelope.channel !== channel || typeof envelope.body !== "string") {
        throw effectError("CALLBACK_IMMUTABLE_COPY_INVALID");
      }
      message = await messages.create({
        organization_id: action.organization_id, lead_id: current.lead_id, action_id: current.id,
        direction: CHANNEL_DIRECTION.OUTBOUND, channel, status: messageStatus,
        subject: envelope.subject, body: envelope.body,
        summary: status === "COMPLETED" ? envelope.body : "Outbound activity failed.",
        provider: persisted.provider, provider_reference: persisted.provider_reference || provider_reference,
        idempotency_key: messageKey, occurred_at: persisted.dispatch_authorized_at || persisted.started_at,
        payload: { action_type: current.type, attempt: persisted.attempt, execution_id: persisted.id,
          prepared_revision_id: revision.id, envelope_hash: persisted.envelope_hash,
          recipient: envelope.recipient, sender: envelope.sender, scheduled_at: envelope.scheduled_at }
      });
    } else {
      if (message.action_id !== action.id || message.lead_id !== current.lead_id
        || message.payload.execution_id !== persisted.id || message.direction !== CHANNEL_DIRECTION.OUTBOUND
        || message.channel !== channel) throw effectError("CALLBACK_MESSAGE_IDENTITY_CONFLICT");
      message = await messages.updateStatus(message.id, messageStatus,
        { provider_reference, summary: status === "COMPLETED" ? null : "Outbound activity failed." });
    }
    const followUpResult = status === "COMPLETED" && allow_follow_up
      ? await this.scheduleNoResponseFollowUpInTransaction(tx, current, persisted)
      : { follow_up: null, reason: "CALLBACK_NOT_APPLICABLE" };
    return { message, follow_up: followUpResult.follow_up, callback,
      follow_up_skipped_reason: followUpResult.reason || null, skipped: false };
  }

  async receiveInboundEvent(input) {
    this.inboundMessageService.replyClassifier = this.replyClassifier;
    if (this.webhookInbox) this.inboundMessageService.webhookInbox = this.webhookInbox;
    return this.inboundMessageService.receiveInboundEvent(input);
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
      original_text: typeof message.body === "string" ? message.body : null,
      interpretation: message.interpretation,
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

  completeFollowUp(command) {
    return this.#transitionFollowUp(command, FOLLOW_UP_STATUS.COMPLETED);
  }

  cancelFollowUp(command) {
    return this.#transitionFollowUp(command, FOLLOW_UP_STATUS.CANCELLED);
  }

  async #transitionFollowUp({ organization_id, follow_up_id }, target) {
    return this.#contactPolicy().withWorkspacePolicyTransaction(organization_id, async (tx) => {
      const repository = new FollowUpsRepository(tx);
      const current = await repository.getForOrganization(follow_up_id, organization_id);
      if (!current) throw notFoundError("Follow-up not found for workspace.");
      if (current.status === target) return { follow_up: current, duplicate: true };
      const completed = target === FOLLOW_UP_STATUS.COMPLETED;
      const followUp = completed
        ? await repository.complete(follow_up_id, organization_id)
        : await repository.cancel(follow_up_id, organization_id);
      await new AuditRepository(tx).record({
        organization_id, lead_id: current.lead_id, action_id: current.action_id,
        event_type: completed ? "FollowUpCompleted" : "FollowUpCancelled",
        message: completed ? "A human follow-up was completed." : "A human follow-up was cancelled.",
        metadata: { follow_up_id, previous_status: current.status, status: target }
      });
      return { follow_up: followUp, duplicate: false };
    });
  }

  async scheduleNoResponseFollowUp(action, execution = null) {
    return this.#contactPolicy().withWorkspacePolicyTransaction(action.organization_id, async (tx) =>
      (await this.scheduleNoResponseFollowUpInTransaction(tx, action, execution)).follow_up);
  }

  async scheduleNoResponseFollowUpInTransaction(tx, action, execution) {
    assertWorkspaceTransaction(tx, action.organization_id);
    const skip = (reason) => ({ follow_up: null, reason });
    if (!["SEND_EMAIL", "SEND_WHATSAPP", "SEND_SMS"].includes(action.type)) return skip("CHANNEL_NOT_APPLICABLE");
    if (!execution) throw effectError("CALLBACK_EXECUTION_REQUIRED");
    const current = await new ActionsRepository(tx).getActionForOrganization(action.id, action.organization_id);
    const persisted = await new ExecutionsRepository(tx).getExecutionForOrganization(execution.id, action.organization_id);
    if (!current || !persisted || current.active_execution_id !== persisted.id
      || persisted.fence_token === null || Number(current.execution_fence) !== Number(persisted.fence_token)
      || current.status !== "COMPLETED" || persisted.outcome_class !== "DELIVERED") return skip("STALE_OR_TERMINAL_EXECUTION");

    const lead = await tx.get("SELECT * FROM leads WHERE organization_id=? AND id=?", [action.organization_id, current.lead_id]);
    if (!lead || lead.archived_at) return skip("LEAD_ARCHIVED");
    // The outcome above remains a fact even when its reviewed input authority aged.
    // A failed assessment must prevent new automatic work without rewriting delivery.
    let freshness;
    try { freshness = await evaluateFreshness(tx, lead, { now: this.now }); }
    catch (error) { if (error.code?.startsWith("FRESHNESS_") || error.code?.startsWith("RESEARCH_") || error.code === "BUSINESS_CONTEXT_INVALID") return skip("FRESHNESS_UNAVAILABLE"); throw error; }
    if (leadDataRevision(lead) || freshness.policy_version) {
      const revision = await tx.get("SELECT context_fingerprint FROM action_revisions WHERE organization_id=? AND action_id=? AND id=?", [action.organization_id, current.id, persisted.action_revision_id]);
      const businessContext = await loadLeadBusinessContext(tx, { organization_id: action.organization_id, lead_id: current.lead_id });
      if (!revision || revision.context_fingerprint !== new PreparedActionService(tx, { now: this.now }).contextFingerprint(current, lead, reviewContextRevisions(businessContext), freshness)) return skip("INTELLIGENCE_CONTEXT_CHANGED");
    }
    const eligibility = await this.#contactPolicy().inspectLeadInTransaction(tx, {
      organization_id: action.organization_id, lead_id: current.lead_id, channel: channelForActionType(current.type)
    });
    if (eligibility.restricted) return skip("CONTACT_RESTRICTED");
    const message = await new ChannelMessagesRepository(tx).getByIdempotencyKey(action.organization_id,
      persisted.idempotency_key + ":channel-message");
    if (!message || message.payload.execution_id !== persisted.id || typeof message.payload.recipient !== "string") {
      throw effectError("CALLBACK_MESSAGE_IDENTITY_CONFLICT");
    }
    const originalContact = await this.#contactPolicy().inspectLeadInTransaction(tx, {
      organization_id: action.organization_id, lead_id: current.lead_id, channel: channelForActionType(current.type),
      recipient: { kind: current.type === "SEND_EMAIL" ? "EMAIL" : "PHONE", value: message.payload.recipient }
    });
    if (originalContact.restricted) return skip("CONTACT_RESTRICTED");
    if (eligibility.policy_pending || originalContact.policy_pending) {
      throw Object.assign(new Error("Required contact policy processing is pending."),
        { statusCode: 503, code: "POLICY_EFFECT_PENDING" });
    }
    const completionTime = canonicalTime(persisted.completed_at);
    const dispatchTime = canonicalTime(persisted.dispatch_authorized_at || persisted.started_at);
    if (completionTime === null || dispatchTime === null) throw effectError("CALLBACK_TIMING_INVALID");
    const reply = await tx.get(`SELECT id FROM inbound_events WHERE organization_id = ? AND lead_id = ?
      AND received_at >= ? LIMIT 1`, [action.organization_id, current.lead_id, new Date(dispatchTime).toISOString()]);
    if (reply) return skip("REPLY_RECEIVED");
    if (await hasAmbiguousReplySinceInTransaction(tx, { organization_id: action.organization_id, lead_id: current.lead_id,
      recipient: { kind: current.type === "SEND_EMAIL" ? "EMAIL" : "PHONE", value: message.payload.recipient },
      since: new Date(dispatchTime).toISOString() })) return skip("AMBIGUOUS_REPLY_RECEIVED");
    const runId = new ActionsRepository(tx).actionPayload(current).workflow_run_id;
    const stoppedRun = runId
      ? await tx.get("SELECT id FROM workflow_runs WHERE organization_id = ? AND lead_id = ? AND id = ? AND status IN ('STOPPED', 'BLOCKED')",
        [action.organization_id, current.lead_id, runId])
      : await tx.get("SELECT id FROM workflow_runs WHERE organization_id = ? AND lead_id = ? AND last_action_id = ? AND status IN ('STOPPED', 'BLOCKED')",
        [action.organization_id, current.lead_id, current.id]);
    if (stoppedRun) return skip("WORKFLOW_STOPPED");
    const follow_up = await new FollowUpsRepository(tx).create({
      organization_id: action.organization_id, lead_id: current.lead_id, action_id: current.id,
      channel: channelForActionType(current.type), status: FOLLOW_UP_STATUS.PLANNED,
      due_at: new Date(completionTime + 48 * 60 * 60 * 1000).toISOString(),
      reason: "Follow up if no response is received.",
      idempotency_key: `action:${current.id}:no-response-follow-up:v1`
    });
    return { follow_up, reason: null };
  }

  #contactPolicy() {
    if (!this.contactPolicyService) {
      const error = new Error("Contact policy is unavailable.");
      error.statusCode = 503;
      throw error;
    }
    return this.contactPolicyService;
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

function channelTitle(message) {
  const direction = message.direction === CHANNEL_DIRECTION.INBOUND ? "Inbound" : "Outbound";
  return `${direction} ${String(message.channel || "channel").toLowerCase()} activity`;
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


function effectError(code) {
  return Object.assign(new Error("Callback effects require review."), { statusCode: 409, code });
}
function canonicalTime(value) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}
