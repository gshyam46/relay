import { reviewContextRevisions } from "../lead-intelligence/businessFitAuthority.js";
import { evaluateFreshness } from "../lead-intelligence/freshnessService.js";
import { freshnessFingerprintPart } from "../lead-intelligence/freshnessContract.js";
import { assertLeadActive, leadDataRevision } from "../data-foundation/leadDataSafety.js";
import { PreparedActionRepository } from "./preparedActionRepository.js";
import { CHANNEL_CONFIGURATION, PREPARED_POLICY_VERSION, SEND_ACTION_TYPES, fingerprint, reviewError } from "./preparedActionContract.js";
import { subjectFor, bodyFor } from "./renderedMessage.js";
import { recipientForLead } from "../contact-policy/contactPolicyContract.js";
import { assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";
import { SettingsRepository } from "../settings/settingsRepository.js";
import { loadLeadBusinessContext } from "../business-context/businessContextRepository.js";
import { requireChannelCapability, requireDispatchChannelCapability, assertFixedVerificationProbe } from "../channels/channelCapability.js";
import { isValidEmailMailbox } from "../channels/emailConnectionContract.js";

const REVIEWABLE = new Set(["PLANNED", "AWAITING_APPROVAL", "APPROVED", "RETRYING"]);

export class PreparedActionService {
  constructor(db, { now = Date.now } = {}) {
    this.now = now;
    this.db = db;
    this.repository = new PreparedActionRepository(db);
  }

  async prepare(action, { expected_revision_id = null, edited_payload = null, forceNew = false } = {}) {
    assertWorkspaceTransaction(this.db, action.organization_id);
    const current = await this.repository.current(action);
    if (!REVIEWABLE.has(action.status)) {
      if (edited_payload || forceNew) throw reviewError("ACTION_NOT_REVIEWABLE", "This action can no longer receive a new review.");
      return current;
    }
    if ((edited_payload || forceNew) && (!expected_revision_id || current?.id !== expected_revision_id)) {
      throw reviewError("APPROVAL_REVISION_STALE", "The reviewed draft changed. Open its current preview before editing.");
    }
    const inputs = await this.inputs(action);
    const contextFingerprint = this.contextFingerprint(action, inputs.lead, inputs.businessContextRevisions, inputs.freshness);
    const senderFingerprint = fingerprint(inputs.channelConfig);
    const currentEnvelope = current ? JSON.parse(current.envelope_json) : null;
    const matches = current && current.context_fingerprint === contextFingerprint
      && current.sender_config_fingerprint === senderFingerprint
      && currentEnvelope.policy_version === PREPARED_POLICY_VERSION
      && (action.type !== "SEND_EMAIL" || currentEnvelope.sender?.reply_to === emailReplyTo(inputs.channelConfig));
    if (matches && !edited_payload && !forceNew) return current;
    const previousCopy = currentEnvelope;
    const envelope = this.buildEnvelope(action, inputs.lead, inputs.channelConfig, {
      subject: previousCopy?.subject, body: previousCopy?.body, ...validateEdits(edited_payload)
    });
    await assertFixedVerificationProbe(this.db, action, envelope);
    return this.repository.create(action, {
      envelope, contentHash: fingerprint(envelope), senderFingerprint, contextFingerprint
    });
  }

  async inputs(action) {
    const lead = await this.db.get("SELECT * FROM leads WHERE id = ? AND organization_id = ?", [action.lead_id, action.organization_id]);
    if (!lead) throw reviewError("LEAD_UNAVAILABLE", "The action's lead is unavailable.");
    assertLeadActive(lead);
    const category = CHANNEL_CONFIGURATION[action.type]?.category;
    const channelConfig = category ? await new SettingsRepository(this.db).getCategory(action.organization_id, category) : {};
    if (category) requireChannelCapability(this.db, { action_type: action.type, configuration: channelConfig });
    const businessContext = await loadLeadBusinessContext(this.db, { organization_id: action.organization_id, lead_id: action.lead_id });
    const freshness = await evaluateFreshness(this.db, lead, { now: this.now });
    return { lead, channelConfig, businessContextRevisions: reviewContextRevisions(businessContext), freshness };
  }

  contextFingerprint(action, lead, businessContextRevisions, freshness = null) {
    const { status: _status, updated_at: _updated, data_revision: _revision, archived_at: _archived, ...leadData } = lead;
    return fingerprint({
      ...(leadDataRevision(lead) ? { data_revision: leadDataRevision(lead) } : {}),
      action_type: action.type, lead: leadData, payload: parsePayload(action.payload_json),
      scheduled_at: action.scheduled_at || null, policy_version: PREPARED_POLICY_VERSION,
      // Keep prior fingerprints identical until this lead has recorded business context.
      ...(businessContextRevisions?.profile_revision || businessContextRevisions?.enquiry_revision
        ? { business_context: businessContextRevisions } : {}),
      ...freshnessFingerprintPart(freshness)
    });
  }

  buildEnvelope(action, lead, channelConfig, edits = {}) {
    const payload = parsePayload(action.payload_json);
    const channelInfo = CHANNEL_CONFIGURATION[action.type];
    if (!channelInfo && action.type !== "CREATE_HUMAN_TASK") {
      throw reviewError("UNSUPPORTED_ACTION", "This action type does not have an implemented execution handler.");
    }
    if (channelInfo) requireChannelCapability(this.db, { action_type: action.type, configuration: channelConfig });
    const recipientValue = channelInfo ? recipientForLead(lead, channelInfo.channel) : null;
    const recipient = typeof recipientValue === "string" ? recipientValue : recipientValue?.value || null;
    if (channelInfo && !recipient) throw reviewError("RECIPIENT_UNAVAILABLE", "A valid recipient is required before reviewing this message.");
    const sender = channelInfo ? senderFor(action.type, channelConfig) : null;
    const subject = edits.subject ?? (channelInfo?.channel === "EMAIL" ? subjectFor(payload) : null);
    const body = edits.body ?? (channelInfo ? bodyFor(payload) : payload.title || payload.message || payload.reason || "Human review task");
    if (typeof body !== "string" || !body.trim() || body.length > 10000) {
      throw reviewError("INVALID_PREPARED_BODY", "Message body must contain between 1 and 10000 characters.", 400);
    }
    return {
      schema_version: 1, organization_id: action.organization_id, action_id: action.id,
      action_type: action.type, channel: channelInfo?.channel || "HUMAN_TASK", recipient,
      sender, subject, body, scheduled_at: action.scheduled_at || null,
      policy_version: PREPARED_POLICY_VERSION
    };
  }

  async requireCurrent(action, expectedRevisionId) {
    assertWorkspaceTransaction(this.db, action.organization_id);
    if (typeof expectedRevisionId !== "string" || !expectedRevisionId) {
      throw reviewError("APPROVAL_REVISION_REQUIRED", "Open the exact message preview and supply expected_revision_id.", 400);
    }
    const current = await this.repository.current(action);
    if (!current || current.id !== expectedRevisionId) {
      throw reviewError("APPROVAL_REVISION_STALE", "The reviewed draft changed. Open its current preview before deciding.");
    }
    const { lead, channelConfig, businessContextRevisions, freshness } = await this.inputs(action);
    this.assertBinding(action, current, lead, channelConfig, businessContextRevisions, freshness);
    return current;
  }

  assertBinding(action, revision, lead, channelConfig, businessContextRevisions, freshness = null) {
    assertLeadActive(lead);
    let envelope;
    try { envelope = JSON.parse(revision.envelope_json); } catch { throw reviewError("APPROVAL_REVISION_STALE", "The prepared review cannot be verified."); }
    if (revision.context_fingerprint !== this.contextFingerprint(action, lead, businessContextRevisions, freshness)
      || revision.sender_config_fingerprint !== fingerprint(channelConfig)
      || revision.content_hash !== fingerprint(envelope)
      || envelope.policy_version !== PREPARED_POLICY_VERSION
      || envelope.organization_id !== action.organization_id || envelope.action_id !== action.id
      || envelope.action_type !== action.type
      || (action.type === "SEND_EMAIL" && envelope.sender?.reply_to !== emailReplyTo(channelConfig))) {
      throw reviewError("APPROVAL_REVISION_STALE", "Recipient, content, sender configuration, sources or evidence freshness changed. Review a new preview.");
    }
    return envelope;
  }

  async validateForDispatch({ action, lead, channelConfig }) {
    assertWorkspaceTransaction(this.db, action.organization_id);
    if (!SEND_ACTION_TYPES.has(action.type)) {
      throw reviewError("UNSUPPORTED_ACTION", "A prepared external dispatch requires a supported message action.");
    }
    lead = await this.db.get("SELECT * FROM leads WHERE id=? AND organization_id=?", [action.lead_id, action.organization_id]);
    if (!lead) throw reviewError("LEAD_UNAVAILABLE", "The action lead is unavailable.");
    assertLeadActive(lead);
    // Re-read inside the workspace gate; an early caller read is not authority.
    channelConfig = await new SettingsRepository(this.db).getCategory(action.organization_id, CHANNEL_CONFIGURATION[action.type].category);
    const revision = await this.repository.current(action);
    if (!revision) throw reviewError("APPROVAL_REQUIRED", "This message needs an exact recipient, sender and content review.");
    const businessContext = await loadLeadBusinessContext(this.db, { organization_id: action.organization_id, lead_id: action.lead_id });
    const freshness = await evaluateFreshness(this.db, lead, { now: this.now });
    const envelope = this.assertBinding(action, revision, lead, channelConfig, reviewContextRevisions(businessContext), freshness);
    const decision = await this.repository.decision(revision);
    if (!decision || decision.decision !== "APPROVED" || decision.reviewed_hash !== revision.content_hash || !decision.reviewer_user_id) {
      throw reviewError("APPROVAL_REQUIRED", "This message has no approval for its current revision.");
    }
    if (!["APPROVED", "RETRYING"].includes(action.status)) {
      throw reviewError("APPROVAL_REQUIRED", "Only an approved current revision can authorize a new dispatch.");
    }
    await requireDispatchChannelCapability(this.db, { action, configuration: channelConfig, envelope, now: this.now });
    return {
      revision_id: revision.id, envelope_hash: revision.content_hash,
      envelope: structuredClone(envelope), provider_config: structuredClone(channelConfig)
    };
  }

  publicRevision(revision) {
    if (!revision) return null;
    return {
      id: revision.id, revision: revision.revision,
      envelope: JSON.parse(revision.envelope_json), content_hash: revision.content_hash
    };
  }
}

function senderFor(actionType, config) {
  const provider = config.provider || "sandbox";
  if (!CHANNEL_CONFIGURATION[actionType].providers.includes(provider)) {
    throw reviewError("UNSUPPORTED_PROVIDER", "The selected channel provider is not implemented.");
  }
  const replyTo = actionType === "SEND_EMAIL" ? emailReplyTo(config) : null;
  if (provider === "sandbox") return { provider, from: "Sandbox simulation", account_id: null, reply_to: replyTo };
  if (actionType === "SEND_EMAIL") {
    const from = typeof config.from_email === "string" ? config.from_email.trim().toLowerCase() : "";
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from) || !text(config.api_key)) {
      throw reviewError("SENDER_UNAVAILABLE", "Configure an explicit sender email and provider key before reviewing a real email.");
    }
    return { provider, from, account_id: null, reply_to: replyTo };
  }
  if (actionType === "SEND_WHATSAPP") {
    if (!text(config.phone_number_id) || !text(config.api_key)) {
      throw reviewError("SENDER_UNAVAILABLE", "Configure a WhatsApp phone number ID and provider key before review.");
    }
    return { provider, from: config.phone_number_id, account_id: config.phone_number_id, reply_to: null };
  }
  if (!text(config.account_sid) || !text(config.auth_token) || !/^\+[1-9]\d{7,14}$/.test(String(config.from_number || ""))) {
    throw reviewError("SENDER_UNAVAILABLE", "Configure an account, credential and international sender number before review.");
  }
  return { provider, from: config.from_number, account_id: config.account_sid, reply_to: null };
}

function emailReplyTo(config) {
  const value = config.reply_to == null || config.reply_to === "" ? null : config.reply_to;
  if (value !== null && !isValidEmailMailbox(value)) throw reviewError("SENDER_UNAVAILABLE", "Configure a valid explicit return email address before review.");
  return value === null ? null : value.toLowerCase();
}

function validateEdits(edits) {
  if (edits === null || edits === undefined) return {};
  if (typeof edits !== "object" || Array.isArray(edits) || Object.keys(edits).some((key) => !["subject", "body"].includes(key))) {
    throw reviewError("INVALID_REVIEW_EDIT", "Preview edits support subject and body only.", 400);
  }
  const result = {};
  if (Object.hasOwn(edits, "subject")) {
    if (typeof edits.subject !== "string" || !edits.subject.trim() || edits.subject.length > 200 || /[\r\n]/.test(edits.subject)) {
      throw reviewError("INVALID_REVIEW_EDIT", "Subject must contain 1 to 200 characters on one line.", 400);
    }
    result.subject = edits.subject.trim();
  }
  if (Object.hasOwn(edits, "body")) {
    if (typeof edits.body !== "string" || !edits.body.trim() || edits.body.length > 10000) {
      throw reviewError("INVALID_REVIEW_EDIT", "Body must contain 1 to 10000 characters.", 400);
    }
    result.body = edits.body;
  }
  return result;
}

function text(value) { return typeof value === "string" && value.trim().length > 0; }
function parsePayload(value) { return typeof value === "string" ? JSON.parse(value || "{}") : value || {}; }
