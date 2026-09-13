import { ActionsRepository } from "./actionsRepository.js";
import { ExecutionsRepository } from "./executionsRepository.js";
import { CallbacksRepository } from "./callbacksRepository.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { EventsRepository } from "../events/eventsRepository.js";
import { AuditRepository } from "../events/auditRepository.js";
import { assertReceiptOwnership } from "../webhook-inbox/webhookInboxService.js";

export class CallbacksService {
  constructor({ callbacksRepository, actionsRepository, executionsRepository, leadsRepository,
    eventsRepository, auditRepository, channelWorkflowService = null, contactPolicyService = null,
    webhookInbox = null, now = () => Date.now() }) {
    Object.assign(this, { callbacksRepository, actionsRepository, executionsRepository, leadsRepository,
      eventsRepository, auditRepository, channelWorkflowService, webhookInbox });
    this.contactPolicyService = contactPolicyService || new ContactPolicyService(callbacksRepository.db);
    this.now = now;
  }

  async receiveExecutionCallback(input) {
    if (!this.webhookInbox) throw callbackError("Webhook receipt processing is unavailable.", 503, "WEBHOOK_INBOX_UNAVAILABLE");
    const normalized = callbackInput(input);
    const received = await this.webhookInbox.receiveAndProcess({
      organization_id: normalized.organization_id, provider: normalized.provider || "internal-callback",
      connection_key: "application", event_kind: "EXECUTION_CALLBACK",
      provider_event_id: normalized.provider_event_id, verification_kind: "TRUSTED_INTERNAL", input: normalized
    });
    let result = received.result;
    if (!result) {
      const callback = await this.callbacksRepository.getByReceiptId(received.receipt.id);
      result = callback ? {
        applied: false, callback, action_applied: Boolean(callback.action_applied),
        reason: callback.payload.effect_reason || null,
        action: await this.actionsRepository.getActionForOrganization(callback.action_id, normalized.organization_id),
        execution: await this.executionsRepository.getExecutionForOrganization(callback.action_execution_id, normalized.organization_id)
      } : { applied: false };
    }
    return { ...result, duplicate: received.duplicate || Boolean(result.duplicate), webhook_receipt: received.receipt };
  }

  async applyExecutionCallback(input, { receipt } = {}) {
    const { organization_id, action_id, action_execution_id, revision_id, provider, provider_event_id,
      status, provider_reference, details } = callbackInput(input);
    // Internal callbacks have no mandatory contact-policy effect. Commit that
    // determination even if later correlation requires operator review.
    await this.contactPolicyService.withWorkspacePolicyTransaction(organization_id, async (tx) => {
      await assertReceiptOwnership(tx, receipt);
      if (receipt.organization_id !== organization_id) throw callbackError("Callback workspace conflicts with receipt.", 409, "CALLBACK_IDENTITY_CONFLICT");
      if (receipt.event_kind === "EXECUTION_CALLBACK") {
        await tx.run("UPDATE webhook_receipts SET mandatory_policy_status = 'DONE' WHERE id = ?", [receipt.id]);
      }
    });
    requiredText(action_id, "An action reference is required.", 200);
    requiredText(action_execution_id, "An exact execution reference is required.", 200);
    requiredText(provider_event_id, "A bounded provider event identity is required.", 4096);
    if (!["COMPLETED", "FAILED"].includes(status)) throw callbackError("Callback status is invalid.");
    if (revision_id !== null) requiredText(revision_id, "Revision reference is invalid.", 200);
    if (provider_reference !== null) requiredText(provider_reference, "Provider message reference is invalid.", 2048);
    if (provider !== null) requiredText(provider, "Provider is invalid.", 80);
    if (!details || typeof details !== "object" || Array.isArray(details)) throw callbackError("Callback details must be an object.");

    const result = await this.contactPolicyService.withWorkspacePolicyTransaction(organization_id, async (tx) => {
      await assertReceiptOwnership(tx, receipt);
      const actions = new ActionsRepository(tx);
      const executions = new ExecutionsRepository(tx);
      const callbacks = new CallbacksRepository(tx);
      const audit = new AuditRepository(tx);
      const action = await actions.getActionForUpdate(action_id, organization_id);
      const execution = await executions.getExecutionForOrganization(action_execution_id, organization_id);
      if (!action || !execution || execution.action_id !== action.id) throw callbackError("Action execution not found.", 404, "CALLBACK_EXECUTION_NOT_FOUND");
      if (revision_id !== null && execution.action_revision_id !== revision_id) throw callbackError("Callback revision does not match the execution.", 409, "CALLBACK_IDENTITY_CONFLICT");
      if (provider !== null && ![provider, "email-" + provider, "sms-" + provider, "voice-" + provider, "whatsapp-" + provider].includes(execution.provider)) {
        throw callbackError("Callback provider does not match the execution.", 409, "CALLBACK_IDENTITY_CONFLICT");
      }
      // SendGrid HTTP acceptance and webhook message IDs are different namespaces.
      if (provider !== "sendgrid" && provider_reference && execution.provider_reference && provider_reference !== execution.provider_reference) {
        throw callbackError("Callback message reference does not match the execution.", 409, "CALLBACK_IDENTITY_CONFLICT");
      }
      const legacy = await callbacks.getByProviderEventId(provider_event_id);
      if (legacy && !legacy.webhook_receipt_id && legacy.organization_id === organization_id) {
        throw callbackError("Historical callback effects require review.", 409, "LEGACY_REVIEW_REQUIRED");
      }
      let { callback, duplicate } = await callbacks.record({
        organization_id, lead_id: action.lead_id, action_id, action_execution_id,
        provider_event_id: "receipt:" + receipt.id, webhook_receipt_id: receipt.id, received_at: receipt.received_at,
        status, provider_reference, payload: { status, provider_reference, revision_id, provider, details,
          source_provider_event_id: receipt.event_kind === "SENDGRID_EVENT" ? receipt.provider_event_id : provider_event_id }
      });
      if (duplicate) {
        if (callback.effects_status === "LEGACY_UNKNOWN" || callback.core_applied === null) {
          throw callbackError("Historical callback effects require review.", 409, "LEGACY_REVIEW_REQUIRED");
        }
        return { duplicate: true, applied: false, action_applied: Boolean(callback.action_applied),
          reason: callback.payload.effect_reason || null, callback, action, execution };
      }
      const timestamp = new Date(this.now()).toISOString();
      const current = action.active_execution_id === execution.id && execution.fence_token !== null
        && Number(action.execution_fence) === Number(execution.fence_token);
      const mutable = ["DISPATCHING", "ACCEPTED", "UNCERTAIN"].includes(execution.outcome_class);
      if (!current || !mutable) {
        const reason = !current ? "STALE_EXECUTION"
          : execution.outcome_class === "CLOSED_UNRESOLVED" ? "CLOSED_UNRESOLVED"
          : execution.outcome_class === "DELIVERED" && status === "COMPLETED" ? "ALREADY_DELIVERED"
          : "TERMINAL_OUTCOME_PRESERVED";
        await audit.record({ organization_id, lead_id: action.lead_id, action_id,
          event_type: "ExecutionCallbackEvidence", message: "Callback evidence retained without changing active execution state.",
          metadata: { execution_id: execution.id, provider_event_id, reason, status, webhook_receipt_id: receipt.id } });
        callback = await callbacks.markCore(callback.id, { applied: false, action_applied: false, reason, completed_at: timestamp });
        return { duplicate: false, applied: false, reason, callback, action, execution };
      }
      const reference = provider === "sendgrid" ? null : provider_reference;
      const updatedExecution = status === "COMPLETED"
        ? await executions.markExecutionCompleted(execution.id, { providerReference: reference, completedAt: timestamp })
        : await executions.markExecutionFailed(execution.id, { providerReference: reference,
          error: "Provider callback reported delivery failure.", completedAt: timestamp });
      const actionApplied = action.status === "EXECUTING";
      if (actionApplied) {
        await tx.run("UPDATE actions SET status = ?, execution_hold_reason = NULL, next_attempt_at = NULL, last_error = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND active_execution_id = ? AND execution_fence = ? AND status = 'EXECUTING'",
          [status, status === "FAILED" ? "Provider callback reported delivery failure." : null, timestamp,
            action.id, organization_id, execution.id, execution.fence_token]);
        if (status === "COMPLETED") {
          await new EventsRepository(tx).publish({ organization_id, lead_id: action.lead_id, type: "ActionCompleted",
            payload: { action_id: action.id, action_execution_id: execution.id, provider_event_id } });
        }
      }
      await audit.record({ organization_id, lead_id: action.lead_id, action_id,
        event_type: status === "COMPLETED" ? "ActionCompleted" : "ActionFailed",
        message: status === "COMPLETED" ? "Exact execution callback confirmed delivery." : "Exact execution callback reported delivery failure.",
        metadata: { execution_id: execution.id, revision_id: execution.action_revision_id, provider_event_id,
          action_applied: actionApplied, webhook_receipt_id: receipt.id } });
      callback = await callbacks.markCore(callback.id, { applied: true, action_applied: actionApplied, completed_at: timestamp });
      return { duplicate: false, applied: true, action_applied: actionApplied, callback,
        action: await actions.getActionForOrganization(action.id, organization_id), execution: updatedExecution };
    });
    if (result.callback.effects_status !== "PENDING") return result;

    // Message, follow-up and cursor are one local transaction. A failed effect
    // rolls all three back; replay never repeats the already committed core.
    result.channel_result = await this.contactPolicyService.withWorkspacePolicyTransaction(organization_id, async (tx) => {
      await assertReceiptOwnership(tx, receipt);
      const callbacks = new CallbacksRepository(tx);
      const pending = await callbacks.getByReceiptId(receipt.id);
      if (pending.effects_status !== "PENDING") return null;
      if (!this.channelWorkflowService) throw callbackError("Channel effects are unavailable.", 503, "CALLBACK_EFFECTS_UNAVAILABLE");
      const effects = await this.channelWorkflowService.recordExecutionCallbackInTransaction(tx, {
        action: result.action, execution: result.execution, callback: pending, status: pending.status,
        provider_reference: pending.payload.provider === "sendgrid" ? null : pending.provider_reference,
        allow_follow_up: Boolean(pending.action_applied)
      });
      await assertReceiptOwnership(tx, receipt);
      result.callback = await callbacks.markEffects(pending.id, {
        skipped: Boolean(effects.skipped), reason: effects.reason || effects.follow_up_skipped_reason || null,
        completed_at: new Date(this.now()).toISOString()
      });
      return effects;
    });
    return result;
  }
}

function callbackInput(input) {
  return { organization_id: input.organization_id, action_id: input.action_id,
    action_execution_id: input.action_execution_id, revision_id: input.revision_id ?? null,
    provider: input.provider ?? null, provider_event_id: input.provider_event_id,
    status: input.status ?? "COMPLETED", provider_reference: input.provider_reference ?? null,
    details: input.details ?? {} };
}
function requiredText(value, message, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw callbackError(message);
}
function callbackError(message, statusCode = 400, code = "CALLBACK_INPUT_INVALID") {
  return Object.assign(new Error(message), { statusCode, code });
}
