import { fingerprint } from "../outbound-automation/preparedActionContract.js";
import { loadLeadDataContext } from "../data-foundation/leadDataContext.js";
import { ContactPolicyRepository } from "../contact-policy/contactPolicyRepository.js";
import { createHash } from "node:crypto";
import { LocalReplyClassifier } from "./replyClassifier.js";
import { AuditRepository } from "../events/auditRepository.js";
import { WebhookInboxService, assertReceiptOwnership, markReceiptProcessedInTransaction } from "../webhook-inbox/webhookInboxService.js";
import { normalizeEmail } from "../data-foundation/normalization.js";

const TRACKING_EVENTS = new Set(["processed", "deferred", "open", "click", "group_resubscribe"]);
const TERMINAL_EVENTS = { delivered: "COMPLETED", bounce: "FAILED", dropped: "FAILED", spamreport: "FAILED" };

/**
 * Normalize the documented SendGrid Event Webhook shape. The caller must
 * authenticate the original request bytes and resolve the workspace first.
 * The helper never treats event metadata as tenant authorization.
 */
export function normalizeSendgridEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw inputError("SendGrid event must be an object.");
  }
  const type = event.event === "spam report" ? "spamreport" : event.event;
  if (typeof type !== "string"
    || (!Object.hasOwn(TERMINAL_EVENTS, type) && !TRACKING_EVENTS.has(type) && !["unsubscribe", "group_unsubscribe"].includes(type))) {
    throw inputError("SendGrid event type is unsupported.");
  }
  if (typeof event.sg_event_id !== "string" || !event.sg_event_id.trim() || event.sg_event_id.length > 2048) {
    throw inputError("SendGrid sg_event_id is required and must be at most 2048 characters.");
  }
  const topLevel = optionalActionId(event.relay_action_id);
  const nested = optionalActionId(event.custom_args?.relay_action_id);
  if (topLevel && nested && topLevel !== nested) {
    throw inputError("SendGrid action references conflict.");
  }
  const actionId = topLevel || nested || null;
  const email = normalizeEmail(event.email);
  if (event.email != null && (typeof event.email !== "string" || !email.valid || !email.value)) {
    throw inputError("SendGrid recipient email is invalid.");
  }

  let restrictionReason = null;
  if (type === "unsubscribe" || type === "group_unsubscribe") restrictionReason = "UNSUBSCRIBE";
  if (type === "spamreport") restrictionReason = "COMPLAINT";
  // Missing/temporary/unclassified bounce type is not evidence of a permanent
  // address failure. It may fail the attempt without revoking contact consent.
  if (type === "bounce" && event.type === "bounce") restrictionReason = "HARD_BOUNCE";
  if (restrictionReason && !email.value) {
    throw inputError("SendGrid restriction events require the actual recipient email.");
  }
  if (!actionId && !restrictionReason) {
    throw inputError("SendGrid event has no action reference or applicable recipient restriction.");
  }
  const providerReference = typeof event.sg_message_id === "string" ? event.sg_message_id : null;
  return {
    type,
    provider_event_id: event.sg_event_id,
    action_id: actionId,
    recipient: email.value,
    status: TERMINAL_EVENTS[type] || null,
    restriction_reason: restrictionReason,
    provider_reference: providerReference,
    reason: typeof event.reason === "string" ? event.reason.slice(0, 1000) : null
  };
}

/**
 * Apply suppression before ancillary tracking/delivery handling. Expected input
 * failures are typed 4xx; storage failures propagate for HTTP 5xx and provider
 * retry. Replaying a batch repeats only idempotent restriction writes.
 */
export async function applySendgridEvent(services, organizationId, event, { receipt = null } = {}) {
  if (!receipt) {
    const normalizedReceipt = normalizeSendgridEventReceipt(event);
    const inbox = services.webhookInbox || new WebhookInboxService({ db: services.actionsRepository.db, contactPolicyService: services.contactPolicyService,
      handlers: { SENDGRID_EVENT: (input, context) => applySendgridEvent(services, organizationId, input, context) },
      policyHandlers: { SENDGRID_EVENT: (tx, input, context) => applySendgridConflictPolicyInTransaction(services, tx, organizationId, input, context) } });
    const received = await inbox.receiveAndProcess({ organization_id: organizationId, provider: "sendgrid", connection_key: "channel_email",
      event_kind: "SENDGRID_EVENT", provider_event_id: normalizedReceipt.provider_event_id, verification_kind: "TRUSTED_INTERNAL", input: normalizedReceipt.payload });
    return { ...(received.result || { ok: true, applied: false, event: event?.event, action_id: event?.relay_action_id || event?.custom_args?.relay_action_id || null }), receipt: received.receipt, duplicate: received.duplicate };
  }
  let normalized;
  try { normalized = normalizeSendgridEvent(event); }
  catch (error) {
    await services.contactPolicyService.withWorkspacePolicyTransaction(organizationId, async (tx) => {
      await assertReceiptOwnership(tx, receipt);
      await applySendgridConflictPolicyInTransaction(services, tx, organizationId, event, { receipt });
      await tx.run("UPDATE webhook_receipts SET mandatory_policy_status = 'DONE' WHERE id = ? AND organization_id = ?", [receipt.id, organizationId]);
    });
    throw error;
  }
  if (!normalized.restriction_reason) {
    await services.contactPolicyService.withWorkspacePolicyTransaction(organizationId, async (tx) => {
      await assertReceiptOwnership(tx, receipt);
      await tx.run("UPDATE webhook_receipts SET mandatory_policy_status = 'DONE' WHERE id = ? AND organization_id = ?", [receipt.id, organizationId]);
    });
  }
  let action = null;
  if (normalized.action_id) {
    action = await services.actionsRepository.getActionForOrganization(normalized.action_id, organizationId);
    if (!action) {
      // An obsolete reference must not discard an authenticated recipient
      // restriction. A known foreign reference still fails before any effect;
      // the global lookup is only an internal existence check, never returned.
      const referencedAction = await services.actionsRepository.getAction(normalized.action_id);
      if (referencedAction || !normalized.restriction_reason) {
        throw inputError("Action not found for this organization.", 404);
      }
    }
    if (action && action.type !== "SEND_EMAIL") {
      throw inputError("SendGrid event does not identify an email action.");
    }
  }

  let restrictionResult = null;
  await services.contactPolicyService.withWorkspacePolicyTransaction(organizationId, async (tx) => {
    await assertReceiptOwnership(tx, receipt);
    if (normalized.restriction_reason) restrictionResult = await services.contactPolicyService.restrictContactInTransaction(tx, {
      organization_id: organizationId, contact: { kind: "EMAIL", value: normalized.recipient }, channel: "EMAIL",
      reason: normalized.restriction_reason, source: "PROVIDER_EVENT",
      source_event_id: normalized.provider_event_id.length <= 100 ? "sendgrid:" + normalized.provider_event_id
        : "sendgrid:sha256:" + createHash("sha256").update(normalized.provider_event_id).digest("hex")
    });
    if (normalized.restriction_reason && action && !event.normalization_error) await anchorCorrectedEnquiryRestriction(tx, organizationId, event, normalized, action);
    await tx.run("UPDATE webhook_receipts SET mandatory_policy_status = 'DONE' WHERE id = ? AND organization_id = ?", [receipt.id, organizationId]);
  });
  if (event.normalization_error) throw inputError("Provider event requires processing review.", 400, event.normalization_error);

  if (!action) {
    return {
      ok: true,
      applied: !restrictionResult.duplicate,
      restriction_applied: true,
      event: normalized.type,
      action_id: null
    };
  }
  if (!normalized.status) {
    await services.contactPolicyService.withWorkspacePolicyTransaction(organizationId, async (tx) => {
      await assertReceiptOwnership(tx, receipt);
      await new AuditRepository(tx).record({
        organization_id: organizationId, lead_id: action.lead_id, action_id: action.id,
        event_type: normalized.restriction_reason ? "EmailContactRestricted" : "EmailTrackingEvent",
        message: normalized.restriction_reason ? "Provider event applied an email contact restriction." : "Provider email tracking event recorded.",
        metadata: { event: normalized.type, provider_event_id: normalized.provider_event_id, sg_message_id: normalized.provider_reference, webhook_receipt_id: receipt.id }
      });
      await markReceiptProcessedInTransaction(tx, receipt);
    });
    return {
      ok: true,
      applied: Boolean(restrictionResult && !restrictionResult.duplicate),
      restriction_applied: Boolean(normalized.restriction_reason),
      event: normalized.type,
      action_id: action.id
    };
  }

  // Restrictions above are durable even if delivery correlation is incomplete.
  const executionId = matchingReference(event.relay_execution_id, event.custom_args?.relay_execution_id);
  const revisionId = matchingReference(event.relay_revision_id, event.custom_args?.relay_revision_id);
  if (!executionId || !revisionId) throw inputError("SendGrid terminal events require exact execution and revision references.");
  const result = await services.callbacksService.applyExecutionCallback({
    organization_id: organizationId,
    action_id: action.id,
    action_execution_id: executionId, revision_id: revisionId, provider: "sendgrid",
    provider_event_id: "sendgrid:" + organizationId + ":" + normalized.provider_event_id,
    status: normalized.status,
    provider_reference: normalized.provider_reference,
    details: { reason: normalized.type, sendgrid_reason: normalized.reason }
  }, { receipt });
  return {
    ok: true,
    applied: Boolean(result.applied),
    restriction_applied: Boolean(normalized.restriction_reason),
    event: normalized.type,
    action_id: action.id
  };
}

function matchingReference(top, nested) {
  const first = optionalActionId(top), second = optionalActionId(nested);
  if (first && second && first !== second) throw inputError("SendGrid execution or revision references conflict.");
  return first || second || null;
}

function optionalActionId(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    throw inputError("SendGrid action reference is invalid.");
  }
  return value;
}

function inputError(message, statusCode = 400, code = "SENDGRID_EVENT_INVALID") {
  return Object.assign(new Error(message), { statusCode, code });
}

/** Bound stored input before semantic validation; malformed authenticated items
 * retain stable quarantine identity and applicable recipient suppression. */
export function normalizeSendgridEventReceipt(event) {
  const source = event && typeof event === "object" && !Array.isArray(event) ? event : {};
  const payload = {};
  for (const key of ["event", "sg_event_id", "email", "relay_action_id", "relay_execution_id", "relay_revision_id", "sg_message_id", "reason", "type"]) {
    if (typeof source[key] === "string") payload[key] = source[key].slice(0, key === "reason" ? 1000 : 2048);
    else if (source[key] != null) payload[key] = null;
  }
  if (typeof source.timestamp === "number" && Number.isFinite(source.timestamp)) payload.timestamp = source.timestamp;
  if (source.custom_args && typeof source.custom_args === "object" && !Array.isArray(source.custom_args)) {
    payload.custom_args = {};
    for (const key of ["relay_action_id", "relay_execution_id", "relay_revision_id"]) {
      if (typeof source.custom_args[key] === "string") payload.custom_args[key] = source.custom_args[key].slice(0, 2048);
      else if (source.custom_args[key] != null) payload.custom_args[key] = null;
    }
  }
  // Flat and legacy nested echoes with identical values are one semantic input.
  // Conflicting values remain in both locations for quarantine validation.
  for (const key of ["relay_action_id", "relay_execution_id", "relay_revision_id"]) {
    const top = payload[key], nested = payload.custom_args?.[key];
    if (typeof nested === "string" && (!top || top === nested)) { payload[key] = nested; delete payload.custom_args[key]; }
  }
  if (payload.custom_args && Object.keys(payload.custom_args).length === 0) delete payload.custom_args;
  if (!event || typeof event !== "object" || Array.isArray(event)) payload.normalization_error = "SENDGRID_EVENT_INVALID";
  if (typeof source.sg_event_id !== "string" || !source.sg_event_id.trim() || source.sg_event_id.length > 2048) {
    payload.normalization_error = "SENDGRID_EVENT_ID_INVALID";
    payload.sg_event_id = "invalid:" + hashCanonical(payload);
  }
  return { provider_event_id: payload.sg_event_id, payload };
}

export function normalizeSendgridInbound(fields, { organization_id }) {
  const source = fields && typeof fields === "object" ? fields : {};
  const from = parseSingleAddress(source.from);
  const subject = typeof source.subject === "string" ? source.subject.slice(0, 2000) : null;
  const fullText = (typeof source.text === "string" && source.text ? source.text
    : typeof source.html === "string" ? source.html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : "").replace(/\r\n/g, "\n");
  const text = fullText.slice(0, 32768);
  const headers = typeof source.headers === "string" ? source.headers : "";
  const unfolded = headers.replace(/\r?\n[ \t]+/g, " ");
  const ids = [...unfolded.matchAll(/^message-id:[ \t]*(.*)$/gim)].map((match) => match[1].trim());
  const dates = [...unfolded.matchAll(/^date:[ \t]*(.*)$/gim)].map((match) => match[1].trim());
  const recipients = typeof source.to === "string" ? source.to.trim().toLowerCase().slice(0, 2000) : null;
  let identityError = !from ? "INBOUND_SENDER_INVALID" : ids.length > 1 ? "AMBIGUOUS_MESSAGE_ID"
    : ids.length === 0 ? "MISSING_MESSAGE_ID" : !/^<[^<>\s]+@[^<>\s]+>$/.test(ids[0]) || ids[0].length > 512 ? "INVALID_MESSAGE_ID" : null;
  if (fullText.length > 32768) identityError = "INBOUND_CONTENT_TOO_LARGE";
  let envelope = null;
  if (typeof source.envelope === "string") {
    try {
      const parsed = JSON.parse(source.envelope);
      const envelopeFrom = normalizeEmail(parsed.from);
      const to = Array.isArray(parsed.to) ? parsed.to.map((value) => normalizeEmail(value).value).filter(Boolean).sort() : [];
      envelope = { from: envelopeFrom.value, to };
      if (from && envelopeFrom.value && from.email !== envelopeFrom.value) identityError = "INBOUND_SENDER_CONFLICT";
    } catch { identityError = "INBOUND_ENVELOPE_INVALID"; }
  }
  const duplicated = Array.isArray(source.__duplicate_identity_fields) ? source.__duplicate_identity_fields.filter((key) => ["from", "to", "headers", "envelope"].includes(key)).sort() : [];
  if (duplicated.length) identityError = "INBOUND_IDENTITY_AMBIGUOUS";
  const canonical = { from, recipients, envelope, duplicated, subject, text_hash: hashCanonical(fullText), date: dates.length === 1 ? dates[0].slice(0, 200) : null, message_ids: ids.slice(0, 2).map((id) => id.slice(0, 512)) };
  return { organization_id, lead_id: null, contact: ["INBOUND_SENDER_CONFLICT", "INBOUND_ENVELOPE_INVALID"].includes(identityError) || duplicated.some((key) => ["from", "envelope"].includes(key)) ? null : from, channel: "EMAIL", provider: "sendgrid",
    provider_event_id: identityError ? "sendgrid-inbound:sha256:" + hashCanonical(canonical) : ids[0],
    event_type: fullText.length > 32768 && new LocalReplyClassifier().classify(fullText).event_type === "OPT_OUT" ? "OPT_OUT" : null, payload: { text, subject }, identity_context: { recipients, envelope, date: canonical.date, text_hash: canonical.text_hash }, ...(identityError ? { identity_error: identityError } : {}) };
}

function parseSingleAddress(value) {
  if (typeof value !== "string" || /[\r\n]/.test(value)) return null;
  const match = /^\s*(?:([^<>]*)<([^<>]+)>|([^<>]+))\s*$/.exec(value);
  if (!match) return null;
  const address = normalizeEmail((match[2] || match[3] || "").trim());
  if (!address.valid || !address.value) return null;
  return { email: address.value, name: (match[1] || "").trim().replace(/^"|"$/g, "") || null };
}
function hashCanonical(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

/** A quarantined changed-input receipt may still contain a valid contact stop.
 * This helper performs no callback, lead capture, messaging or event effects. */
export async function applySendgridConflictPolicyInTransaction(services, tx, organizationId, event, { receipt } = {}) {
  services.contactPolicyService.assertWorkspaceTransaction(tx, organizationId);
  if (!receipt?.id || receipt.organization_id !== organizationId) throw inputError("Receipt scope is invalid.", 409, "RECEIPT_IDENTITY_CONFLICT");
  const references = [event?.relay_action_id, event?.custom_args?.relay_action_id];
  for (const reference of references) {
    if (reference == null || reference === "") continue;
    if (typeof reference !== "string" || reference.length > 200) throw inputError("Action reference requires review.");
    const action = await tx.get("SELECT organization_id FROM actions WHERE id = ?", [reference]);
    if (action && action.organization_id !== organizationId) throw inputError("Action not found for this organization.", 404, "CORRELATION_REVIEW_REQUIRED");
  }
  const type = event?.event === "spam report" ? "spamreport" : event?.event;
  const reason = ["unsubscribe", "group_unsubscribe"].includes(type) ? "UNSUBSCRIBE" : type === "spamreport" ? "COMPLAINT" : type === "bounce" && event?.type === "bounce" ? "HARD_BOUNCE" : null;
  if (!reason) {
    if (!TRACKING_EVENTS.has(type) && !Object.hasOwn(TERMINAL_EVENTS, type)) throw inputError("Provider event policy requires review.", 400, "UNSUPPORTED_EVENT");
    return { restriction_applied: false };
  }
  const recipient = normalizeEmail(event?.email);
  if (!recipient.valid || !recipient.value) throw inputError("Actual recipient is required.", 400, "INVALID_RECIPIENT");
  await services.contactPolicyService.restrictContactInTransaction(tx, { organization_id: organizationId,
    contact: { kind: "EMAIL", value: recipient.value }, channel: "EMAIL", reason, source: "PROVIDER_EVENT",
    source_event_id: "conflict:receipt:" + receipt.id });
  return { restriction_applied: true };
}

// A late provider stop can retain its proven enquiry association after a reviewed
// email correction. Missing proof remains scoped only to the actual recipient.
async function anchorCorrectedEnquiryRestriction(tx, organizationId, event, normalized, action) {
  let executionId, revisionId;
  try { executionId = matchingReference(event.relay_execution_id, event.custom_args?.relay_execution_id); revisionId = matchingReference(event.relay_revision_id, event.custom_args?.relay_revision_id); }
  catch { return; }
  if (!executionId || !revisionId) return;
  const proof = await tx.get("SELECT e.envelope_hash,e.dispatch_authorized_at,r.content_hash,r.envelope_json,a.lead_id FROM action_executions e JOIN actions a ON a.id=e.action_id JOIN action_revisions r ON r.id=e.action_revision_id AND r.action_id=a.id AND r.organization_id=a.organization_id WHERE a.organization_id=? AND a.id=? AND a.type='SEND_EMAIL' AND e.id=? AND r.id=? AND e.provider='sendgrid'", [organizationId, action.id, executionId, revisionId]);
  if (!proof || !proof.dispatch_authorized_at || !Number.isFinite(Date.parse(proof.dispatch_authorized_at)) || proof.envelope_hash !== proof.content_hash) return;
  let envelope;
  try { envelope = JSON.parse(proof.envelope_json); } catch { return; }
  if (!envelope || fingerprint(envelope) !== proof.content_hash || envelope.organization_id !== organizationId || envelope.action_id !== action.id || envelope.action_type !== "SEND_EMAIL" || envelope.channel !== "EMAIL" || envelope.sender?.provider !== "sendgrid" || envelope.recipient !== normalized.recipient) return;
  const data = await loadLeadDataContext(tx, { organization_id: organizationId, lead_id: proof.lead_id });
  const origin = data.field_provenance.email;
  if (!data.data_revision || !origin || data.normalized_values.normalized_email === normalized.recipient) return;
  const correction = await tx.get("SELECT before_json,after_json FROM lead_data_changes WHERE organization_id=? AND lead_id=? AND id=? AND kind='CORRECT'", [organizationId, proof.lead_id, origin.change_id]);
  if (!correction) return;
  let before, after;
  try { before = JSON.parse(correction.before_json); after = JSON.parse(correction.after_json); } catch { return; }
  if (before.normalized_values?.normalized_email === after.normalized_values?.normalized_email) return;
  const input = { organization_id: organizationId, lead_id: proof.lead_id, channel: "EMAIL", reason: normalized.restriction_reason, source: "PROVIDER_EVENT",
    source_event_id: "sendgrid:corrected-enquiry:" + createHash("sha256").update(normalized.provider_event_id).digest("hex") };
  const repository = new ContactPolicyRepository(tx), result = await repository.append(input, { kind: "LEAD", value: proof.lead_id });
  const effects = await repository.cancelApplicableWork(organizationId, [result.restriction]);
  await repository.recordAudit(input, [result.restriction], { ...effects, original_recipient: normalized.recipient, execution_id: executionId, revision_id: revisionId });
}
