import { leadDataRevision } from "../data-foundation/leadDataSafety.js";
import { providerReference } from "./providerRequest.js";
import { inspectWorkflowDispatch } from "../workflows/workflowsRepository.js";
import { randomUUID } from "node:crypto";
import { ACTION_STATUS, EXECUTION_STATUS, EXECUTABLE_ACTION_STATUSES } from "../outbound-automation/actionContract.js";
import { ActionsRepository } from "../outbound-automation/actionsRepository.js";
import { ExecutionsRepository } from "../outbound-automation/executionsRepository.js";
import { PreparedActionService } from "../outbound-automation/preparedActionService.js";
import { CHANNEL_CONFIGURATION, SEND_ACTION_TYPES } from "../outbound-automation/preparedActionContract.js";
import { LeadsRepository } from "../data-foundation/leadsRepository.js";
import { SettingsRepository } from "../settings/settingsRepository.js";
import { isChannelCapabilityError } from "../channels/channelCapability.js";
import { AuditRepository } from "../events/auditRepository.js";
import { currentTime, dispatchError, executionDetail, instantMs, iso, providerIntentKey, resolveDispatchPolicy, retryDue } from "../outbound-automation/dispatchPolicy.js";

export class ActionExecutor {
  constructor({ actionsRepository, executionsRepository, auditRepository, adapter, contactPolicyService,
    channelWorkflowService = null, dispatchControlsService = null, now = Date.now, random = Math.random, dispatchPolicy = {}, leaseOwner = randomUUID() }) {
    Object.assign(this, { actionsRepository, executionsRepository, auditRepository, adapter, contactPolicyService, channelWorkflowService, now, random, leaseOwner });
    if (!dispatchControlsService?.inspectInTransaction) throw new TypeError("Dispatch requires explicit operational controls.");
    this.dispatchControlsService = dispatchControlsService;
    this.policy = resolveDispatchPolicy(dispatchPolicy);
    this.accepting = true;
    this.operations = new Set();
  }

  stopAccepting() { this.accepting = false; }
  async drain() {
    while (this.operations.size) await Promise.allSettled([...this.operations]);
  }

  execute(requestedAction) {
    if (!this.accepting) return Promise.reject(dispatchError("DISPATCH_DRAINING", "Dispatch is draining; try again after restart.", 503));
    const operation = this.#execute(requestedAction);
    this.operations.add(operation);
    operation.then(() => this.operations.delete(operation), () => this.operations.delete(operation));
    return operation;
  }

  async #execute(requestedAction) {
    if (!this.contactPolicyService) throw new Error("Dispatch requires the workspace policy boundary.");
    const claim = await this.contactPolicyService.withWorkspacePolicyTransaction(requestedAction.organization_id, async (tx) => {
      const actions = new ActionsRepository(tx);
      const executions = new ExecutionsRepository(tx);
      const audit = new AuditRepository(tx);
      const action = await actions.getActionForUpdate(requestedAction.id, requestedAction.organization_id);
      if (!action) throw dispatchError("ACTION_NOT_FOUND", "Action not found.", 404);
      const previous = await executions.listForAction(action.id);
      const held = (reason) => ({ held: { ...executionDetail(action, previous), executable: false, reason } });
      if (!this.accepting) return held("Dispatch is draining.");
      if (action.execution_hold_reason) return held("Execution is held for review: " + action.execution_hold_reason + ".");
      if (!EXECUTABLE_ACTION_STATUSES.has(action.status)) return held("Action is " + action.status + ".");

      const nowMs = currentTime(this.now);
      const timestamp = iso(nowMs);
      // A coarse action status must never erase durable evidence of a possible send.
      if (previous.some((row) => !["RETRYABLE_FAILURE", "PERMANENT_FAILURE"].includes(row.outcome_class))
        || (previous.length && !action.first_dispatch_at)) {
        return { held: await holdAction(tx, audit, action, previous, "EXECUTING", "OUTCOME_REVIEW_REQUIRED", "Prior execution outcome requires review.", timestamp) };
      }
      const lead = await new LeadsRepository(tx).getLead(action.lead_id);
      if (!lead || lead.organization_id !== action.organization_id) throw dispatchError("LEAD_NOT_FOUND", "Action lead not found.", 404);
      if (lead.archived_at) return { held: await holdAction(tx, audit, action, previous, "BLOCKED", "LEAD_ARCHIVED", "This enquiry is archived.", timestamp) };
      const payload = actions.actionPayload(action);
      const workflow = await inspectWorkflowDispatch(tx, action, payload);
      if (workflow?.deferred) return { held: { ...executionDetail(action, previous), executable: false, deferred: true,
        workflow_paused: true, reason: workflow.reason } };
      if (workflow) return { held: await holdAction(tx, audit, action, previous, "BLOCKED", workflow.code, workflow.reason, timestamp) };
      let approvedDispatch = null;
      if (SEND_ACTION_TYPES.has(action.type)) {
        const channel = CHANNEL_CONFIGURATION[action.type];
        const eligibility = await this.contactPolicyService.inspectLeadInTransaction(tx, {
          organization_id: action.organization_id, lead_id: action.lead_id, channel: channel.channel
        });
        if (eligibility.restricted) {
          return { held: await holdAction(tx, audit, action, previous, "BLOCKED", "CONTACT_RESTRICTED", eligibility.reason || "Contact is restricted.", timestamp) };
        }
        if (eligibility.policy_pending) {
          return { held: { ...executionDetail(action, previous), executable: false, deferred: true, policy_pending: true,
            reason: "Workspace contact policy checks are still pending." } };
        }
        const channelConfig = await new SettingsRepository(tx).getCategory(action.organization_id, channel.category);
        try {
          approvedDispatch = await new PreparedActionService(tx, { now: this.now }).validateForDispatch({ action, lead, channelConfig });
        } catch (error) {
          if (isChannelCapabilityError(error)) return { held: { ...executionDetail(action, previous), executable: false, deferred: true, channel_hold: true, hold_code: error.code, reason: error.message } };
          if (!["APPROVAL_REQUIRED", "APPROVAL_REVISION_STALE"].includes(error.code)) throw error;
          // This hold can be cleared by the existing exact-review flow.
          return { held: await holdAction(tx, audit, action, previous, "AWAITING_APPROVAL", null, "Review the current recipient, sender and message before dispatch.", timestamp) };
        }
        const checked = typeof eligibility.contact === "string" ? eligibility.contact : eligibility.contact?.value;
        if (checked && checked !== approvedDispatch.envelope.recipient) {
          return { held: await holdAction(tx, audit, action, previous, "BLOCKED", "RECIPIENT_MISMATCH", "Reviewed recipient does not match the checked contact.", timestamp) };
        }
      } else if (action.type !== "CREATE_HUMAN_TASK") {
        return { held: await holdAction(tx, audit, action, previous, "BLOCKED", "UNSUPPORTED_HANDLER", "This action type has no supported execution adapter.", timestamp) };
      }

      for (const [field, code] of [["scheduled_at", "INVALID_SCHEDULE_TIME"], ["next_attempt_at", "INVALID_RETRY_TIME"]]) {
        if (action[field] !== null && action[field] !== undefined && instantMs(action[field]) === null) {
          return { held: await holdAction(tx, audit, action, previous, "BLOCKED", code, "The action has an invalid due time.", timestamp) };
        }
      }
      const eligibleAt = Math.max(instantMs(action.scheduled_at) || 0, instantMs(action.next_attempt_at) || 0);
      if (eligibleAt > nowMs) return { held: { ...executionDetail(action, previous), executable: false, deferred: true, eligible_at: iso(eligibleAt), reason: "Action is not due yet." } };

      const firstDispatch = action.first_dispatch_at || timestamp;
      const deadline = action.retry_deadline_at || (previous.length === 0 ? iso(nowMs + this.policy.retryWindowMs) : null);
      const maxAttempts = action.first_dispatch_at ? Number(action.max_attempts) : Math.min(Number(action.max_attempts), this.policy.maxAttempts);
      if (instantMs(firstDispatch) === null || instantMs(deadline) === null || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
        return { held: await holdAction(tx, audit, action, previous, "BLOCKED", "INVALID_RETRY_POLICY", "The saved execution policy requires review.", timestamp) };
      }
      if (previous.length >= maxAttempts || nowMs >= instantMs(deadline)) {
        return { held: await holdAction(tx, audit, action, previous, "FAILED", "RETRY_BUDGET_EXHAUSTED", "Execution attempt or elapsed-time budget is exhausted.", timestamp) };
      }

      const key = providerIntentKey(action, approvedDispatch?.revision_id);
      const matchingKey = previous.filter((row) => row.provider_intent_key === key);
      const resend = approvedDispatch?.envelope.sender.provider === "resend";
      const keyExpiry = resend ? (matchingKey[0]?.provider_key_expires_at || iso(nowMs + this.policy.providerKeyWindowMs)) : null;
      if (resend && ((matchingKey.length && !matchingKey[0].provider_key_expires_at) || instantMs(keyExpiry) === null || nowMs >= instantMs(keyExpiry))) {
        return { held: await holdAction(tx, audit, action, previous, "FAILED", "PROVIDER_KEY_EXPIRED", "The provider retry-key window is unavailable or expired.", timestamp) };
      }
      const operations = await this.dispatchControlsService.inspectInTransaction(tx, { organization_id: action.organization_id, action_type: action.type, authorized_at: timestamp });
      if (!operations.allowed) return { held: { ...executionDetail(action, previous), executable: false, deferred: true,
        operations_hold: operations.code, reason: operations.reason, next_eligible_at: operations.next_eligible_at } };
      const attempt = await executions.nextAttempt(action.id);
      const fence = Number(action.execution_fence || 0) + 1;
      if (!Number.isSafeInteger(fence) || fence < 1) throw dispatchError("INVALID_EXECUTION_FENCE", "Execution ownership requires review.");
      const execution = await executions.createExecution({
        action_id: action.id, status: EXECUTION_STATUS.STARTED, attempt,
        provider: approvedDispatch?.envelope.sender.provider || "human-task",
        idempotency_key: action.idempotency_key + ":attempt:" + attempt,
        started_at: timestamp, action_revision_id: approvedDispatch?.revision_id || null,
        envelope_hash: approvedDispatch?.envelope_hash || null,
        provider_intent_key: key, provider_key_expires_at: keyExpiry,
        lease_owner: this.leaseOwner, fence_token: fence, lease_expires_at: iso(nowMs + this.policy.leaseMs),
        dispatch_authorized_at: timestamp, outcome_class: "DISPATCHING", outcome_at: null
      });
      await tx.run(`UPDATE actions SET status = 'EXECUTING', active_execution_id = ?, execution_fence = ?,
        first_dispatch_at = ?, retry_deadline_at = ?, max_attempts = ?, next_attempt_at = NULL,
        execution_hold_reason = NULL, last_error = NULL, updated_at = ? WHERE id = ? AND organization_id = ?`,
        [execution.id, fence, firstDispatch, deadline, maxAttempts, timestamp, action.id, action.organization_id]);
      await audit.record({ organization_id: action.organization_id, lead_id: action.lead_id, action_id: action.id,
        event_type: "DispatchAuthorized", message: "Fenced execution ownership persisted before invoking the adapter.",
        metadata: { execution_id: execution.id, attempt, fence, revision_id: approvedDispatch?.revision_id || null,
          envelope_hash: approvedDispatch?.envelope_hash || null } });
      return { action, payload, attempt, execution, approvedDispatch, authorizedDataRevision: leadDataRevision(lead) };
    });
    if (claim.held) return claim.held;
    const { action, payload, attempt, execution, approvedDispatch, authorizedDataRevision } = claim;
    let result;
    try {
      result = await this.adapter.invoke(action, payload, attempt, {
        approvedDispatch, execution_id: execution.id, provider_intent_key: execution.provider_intent_key
      });
      if (!result || typeof result.ok !== "boolean") throw new Error("Invalid adapter result");
    } catch {
      result = { ok: false, uncertain: true, retryable: false, error: "Provider outcome is uncertain; reconciliation is required before another attempt." };
    }
    const persisted = await this.#persistOutcome({ action, attempt, execution, result, authorizedDataRevision });
    if (persisted.callbackAlreadyApplied || (!persisted.uncertain && !persisted.stale_result)) {
      await this.channelWorkflowService?.recordOutboundExecutionAttempt({
        action, payload, attempt, result, execution: persisted.execution, approvedDispatch
      });
    }
    return { action_id: action.id, ...persisted, dispatched: true };
  }

  async #persistOutcome({ action, attempt, execution, result, authorizedDataRevision }) {
    return this.contactPolicyService.withWorkspacePolicyTransaction(action.organization_id, async (tx) => {
      const actions = new ActionsRepository(tx);
      const executions = new ExecutionsRepository(tx);
      const audit = new AuditRepository(tx);
      let current = await actions.getActionForUpdate(action.id, action.organization_id);
      let stored = await executions.getExecution(execution.id);
      const nowMs = currentTime(this.now), timestamp = iso(nowMs);
      const owned = current?.active_execution_id === execution.id && Number(current.execution_fence) === Number(execution.fence_token)
        && stored?.lease_owner === this.leaseOwner && Number(stored.fence_token) === Number(execution.fence_token);
      const dispatching = stored?.status === "STARTED" && stored.outcome_class === "DISPATCHING";
      const leaseValid = instantMs(stored?.lease_expires_at) !== null && instantMs(stored.lease_expires_at) > nowMs;
      if (!owned || !dispatching || !leaseValid) {
        if (owned && dispatching && !leaseValid) {
          await tx.run("UPDATE action_executions SET outcome_class = 'UNCERTAIN', outcome_at = ?, error = ? WHERE id = ? AND outcome_class = 'DISPATCHING'",
            [timestamp, "Execution ownership expired before its outcome was persisted.", execution.id]);
          await tx.run("UPDATE actions SET execution_hold_reason = 'LEASE_EXPIRED', last_error = ?, updated_at = ? WHERE id = ? AND active_execution_id = ? AND execution_fence = ?",
            ["Expired dispatch ownership requires reconciliation.", timestamp, action.id, execution.id, execution.fence_token]);
        }
        await audit.record({ organization_id: action.organization_id, lead_id: action.lead_id, action_id: action.id,
          event_type: "StaleDispatchResult", message: "Late provider result preserved as an audit signal; current execution state was not replaced.",
          metadata: { execution_id: execution.id, fence: execution.fence_token,
            reported_outcome: result.uncertain ? "UNCERTAIN" : result.ok ? "ACCEPTED" : "REJECTED" } });
        current = await actions.getAction(action.id);
        const rows = await executions.listForAction(action.id);
        return { ...executionDetail(current, rows), stale_result: true,
          uncertain: ["UNCERTAIN", "LEGACY_UNKNOWN"].includes(rows.find((row) => row.id === execution.id)?.outcome_class),
          callbackAlreadyApplied: owned && ["DELIVERED", "DELIVERY_FAILED"].includes(stored?.outcome_class) };
      }
      if (result.uncertain) {
        await tx.run("UPDATE action_executions SET outcome_class = 'UNCERTAIN', outcome_at = ?, error = ? WHERE id = ?",
          [timestamp, "Provider outcome uncertain; reconcile before retry.", execution.id]);
        await tx.run("UPDATE actions SET execution_hold_reason = 'PROVIDER_OUTCOME_UNCERTAIN', last_error = ?, updated_at = ? WHERE id = ?",
          ["Provider outcome uncertain; reconcile before retry.", timestamp, action.id]);
        await audit.record({ organization_id: action.organization_id, lead_id: action.lead_id, action_id: action.id,
          event_type: "ActionExecutionUncertain", message: "Provider outcome requires reconciliation; automatic retry is held.",
          metadata: { execution_id: execution.id, attempt } });
      } else if (!result.ok) {
        const failureClass = result.retryable ? "RETRYABLE_FAILURE" : "PERMANENT_FAILURE";
        await tx.run("UPDATE action_executions SET status = 'FAILED', outcome_class = ?, outcome_at = ?, error = ?, completed_at = ? WHERE id = ?",
          [failureClass, timestamp, safeFailure(result.error), timestamp, execution.id]);
        const rows = await executions.listForAction(action.id);
        let status = "BLOCKED", hold = "PERMANENT_PROVIDER_FAILURE", due = null;
        if (result.retryable) {
          const candidate = retryDue({ nowMs, attempt, retryAfterMs: result.retry_after_ms, policy: this.policy, random: this.random });
          const deadline = instantMs(current.retry_deadline_at);
          const keyExpiry = stored.provider_key_expires_at ? instantMs(stored.provider_key_expires_at) : Infinity;
          if (rows.length >= Number(current.max_attempts) || deadline === null || candidate >= deadline) {
            status = "FAILED"; hold = "RETRY_BUDGET_EXHAUSTED";
          } else if (keyExpiry === null || candidate >= keyExpiry) {
            status = "FAILED"; hold = "PROVIDER_KEY_EXPIRED";
          } else {
            status = "RETRYING"; hold = null; due = iso(candidate);
          }
        }
        if (SEND_ACTION_TYPES.has(action.type)) {
          const restriction = await this.contactPolicyService.inspectLeadInTransaction(tx, {
            organization_id: action.organization_id, lead_id: action.lead_id, channel: CHANNEL_CONFIGURATION[action.type].channel
          });
          if (restriction.restricted) { status = "BLOCKED"; hold = "CONTACT_RESTRICTED"; due = null; }
        }
        const currentLead = await new LeadsRepository(tx).getLead(action.lead_id);
        if (currentLead?.archived_at) { status = "BLOCKED"; hold = "LEAD_ARCHIVED"; due = null; }
        else if (currentLead && leadDataRevision(currentLead) !== authorizedDataRevision) { status = "BLOCKED"; hold = "LEAD_DATA_CHANGED"; due = null; }
        if (current.status !== ACTION_STATUS.EXECUTING) { status = current.status; hold = current.execution_hold_reason; due = null; }
        await tx.run("UPDATE actions SET status = ?, execution_hold_reason = ?, next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?",
          [status, hold, due, safeFailure(result.error), timestamp, action.id]);
        await audit.record({ organization_id: action.organization_id, lead_id: action.lead_id, action_id: action.id,
          event_type: "ActionExecutionFailed", message: "Provider rejected this attempt; retry policy was evaluated.",
          metadata: { retryable: status === "RETRYING", next_attempt_at: due, hold_reason: hold, attempt, execution_id: execution.id } });
      } else {
        const reference = providerReference(result.provider_reference);
        await tx.run("UPDATE action_executions SET outcome_class = 'ACCEPTED', outcome_at = ?, provider = ?, provider_reference = ? WHERE id = ?",
          [timestamp, result.provider || stored.provider, reference, execution.id]);
        await audit.record({ organization_id: action.organization_id, lead_id: action.lead_id, action_id: action.id,
          event_type: "ActionStarted", message: "Provider accepted the request; delivery remains unconfirmed.",
          metadata: { attempt, execution_id: execution.id, provider_reference: reference, response_issue: safeResponseIssue(result.response_issue) } });
      }
      current = await actions.getAction(action.id);
      const detail = executionDetail(current, await executions.listForAction(action.id));
      return { ...detail, uncertain: detail.outcome_class === "UNCERTAIN", retryable: current.status === "RETRYING", response_issue: result.ok ? safeResponseIssue(result.response_issue) : null };
    });
  }
}

async function holdAction(tx, audit, action, rows, status, code, reason, timestamp) {
  await tx.run("UPDATE actions SET status = ?, execution_hold_reason = ?, last_error = ?, updated_at = ? WHERE id = ? AND organization_id = ?",
    [status, code, reason, timestamp, action.id, action.organization_id]);
  await audit.record({ organization_id: action.organization_id, lead_id: action.lead_id, action_id: action.id,
    event_type: "ActionDispatchBlocked", message: reason, metadata: { status, hold_reason: code } });
  return { ...executionDetail({ ...action, status, execution_hold_reason: code }, rows), executable: false, reason };
}
function safeFailure(value) {
  return typeof value === "string" && value.length <= 500 ? value : "Provider rejected this attempt.";
}

function safeResponseIssue(value) {
  return ["MISSING_PROVIDER_REFERENCE", "NON_JSON_RESPONSE", "MISSING_RESPONSE_BODY", "RESPONSE_TOO_LARGE", "INVALID_JSON_RESPONSE", "RESPONSE_TIMEOUT", "RESPONSE_READ_FAILED"].includes(value) ? value : null;
}
