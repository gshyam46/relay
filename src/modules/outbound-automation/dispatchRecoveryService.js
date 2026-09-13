import { ActionsRepository } from "./actionsRepository.js";
import { ExecutionsRepository } from "./executionsRepository.js";
import { AuditRepository } from "../events/auditRepository.js";
import { createId } from "../../shared/ids.js";
import { currentTime, dispatchError, executionDetail, instantMs, iso } from "./dispatchPolicy.js";

const DECISIONS = ["ACCEPTED", "CLOSE_WITHOUT_RETRY"];
export class DispatchRecoveryService {
  constructor({ db, contactPolicyService, now = Date.now }) {
    Object.assign(this, { db, contactPolicyService, now });
  }

  async inspectAction({ organization_id, action_id }) {
    const action = await new ActionsRepository(this.db).getActionForOrganization(action_id, organization_id);
    if (!action) throw dispatchError("ACTION_NOT_FOUND", "Action not found.", 404);
    return detail(this.db, action, currentTime(this.now));
  }

  async listForOrganization({ organization_id, limit = 50 }) {
    requireText(organization_id, "organization_id", 256);
    const bounded = boundedLimit(limit, 100);
    const actions = await this.db.all(`SELECT a.* FROM actions a WHERE a.organization_id = ?
      AND a.status NOT IN ('COMPLETED','BLOCKED','FAILED')
      AND (a.status = 'RETRYING' OR a.execution_hold_reason IN ('LEGACY_OUTCOME_REVIEW_REQUIRED','OUTCOME_REVIEW_REQUIRED')
        OR EXISTS (SELECT 1 FROM action_executions e WHERE e.id = a.active_execution_id AND e.outcome_class IN ('UNCERTAIN','DISPATCHING','LEGACY_UNKNOWN')))
      AND NOT EXISTS (SELECT 1 FROM dispatch_resolutions r WHERE r.action_execution_id = a.active_execution_id)
      ORDER BY CASE WHEN EXISTS (SELECT 1 FROM action_executions e WHERE e.id = a.active_execution_id AND e.outcome_class = 'UNCERTAIN') THEN 0 ELSE 1 END,
        a.updated_at ASC, a.id ASC LIMIT ?`, [organization_id, bounded]);
    const items = [];
    const nowMs = currentTime(this.now);
    for (const action of actions) items.push(await detail(this.db, action, nowMs));
    return { items };
  }

  async expireLeases({ organization_id = null, limit = 25 } = {}) {
    const nowMs = currentTime(this.now), timestamp = iso(nowMs);
    const scope = organization_id === null ? "" : " AND a.organization_id = ?";
    const params = organization_id === null ? [timestamp, boundedLimit(limit, 100)] : [timestamp, organization_id, boundedLimit(limit, 100)];
    const candidates = await this.db.all(`SELECT e.id, e.action_id, a.organization_id FROM action_executions e
      JOIN actions a ON a.id = e.action_id WHERE e.outcome_class = 'DISPATCHING'
      AND (e.lease_expires_at IS NULL OR LENGTH(e.lease_expires_at) <> 24 OR e.lease_expires_at <= ?)${scope}
      ORDER BY e.lease_expires_at ASC, e.id ASC LIMIT ?`, params);
    const items = [];
    for (const candidate of candidates) {
      const item = await this.contactPolicyService.withWorkspacePolicyTransaction(candidate.organization_id, async (tx) => {
        const actions = new ActionsRepository(tx);
        const action = await actions.getActionForUpdate(candidate.action_id, candidate.organization_id);
        const execution = await new ExecutionsRepository(tx).getExecution(candidate.id);
        if (!action || !execution || execution.outcome_class !== "DISPATCHING") return null;
        const expires = instantMs(execution.lease_expires_at);
        if (expires !== null && expires > currentTime(this.now)) return null;
        await expire(tx, action, execution, iso(currentTime(this.now)));
        return detail(tx, await actions.getAction(action.id), currentTime(this.now));
      });
      if (item) items.push(item);
    }
    return { items, expired: items.length };
  }

  async resolve(input) {
    requireText(input.organization_id, "organization_id", 256);
    requireText(input.action_id, "action_id", 256);
    requireText(input.expected_execution_id, "expected_execution_id", 256);
    requireText(input.reviewer_user_id, "reviewer_user_id", 256);
    const evidence = requireText(input.evidence_note, "evidence_note", 2000);
    if (!DECISIONS.includes(input.decision)) throw dispatchError("INVALID_RECOVERY_DECISION", "Choose ACCEPTED or CLOSE_WITHOUT_RETRY.", 400);
    if (!Object.hasOwn(input, "expected_fence") || (input.expected_fence !== null && (!Number.isSafeInteger(input.expected_fence) || input.expected_fence < 1))) {
      throw dispatchError("INVALID_RECOVERY_FENCE", "Supply the exact execution fence, or null for a legacy execution.", 400);
    }
    const reference = input.provider_reference === null || input.provider_reference === undefined || input.provider_reference === ""
      ? null : requireText(input.provider_reference, "provider_reference", 512);
    if (input.decision === "ACCEPTED" && !reference) throw dispatchError("RECOVERY_REFERENCE_REQUIRED", "Acceptance evidence requires a provider reference.", 400);
    return this.contactPolicyService.withWorkspacePolicyTransaction(input.organization_id, async (tx) => {
      const actions = new ActionsRepository(tx), executions = new ExecutionsRepository(tx);
      let action = await actions.getActionForUpdate(input.action_id, input.organization_id);
      if (!action) throw dispatchError("ACTION_NOT_FOUND", "Action not found.", 404);
      const rows = await executions.listForAction(action.id);
      let execution = currentExecution(action, rows);
      if (!execution || execution.id !== input.expected_execution_id || execution.fence_token !== input.expected_fence
        || (execution.fence_token !== null && Number(action.execution_fence) !== Number(execution.fence_token))) {
        throw dispatchError("STALE_RECOVERY_TARGET", "The current execution changed or cannot be identified safely.");
      }
      const existing = await tx.get("SELECT * FROM dispatch_resolutions WHERE action_execution_id = ? AND organization_id = ? AND action_id = ?",
        [execution.id, input.organization_id, action.id]);
      if (existing) {
        if (existing.decision !== input.decision || existing.evidence_note !== evidence || existing.provider_reference !== reference || existing.fence_token !== input.expected_fence) {
          throw dispatchError("RECOVERY_ALREADY_DECIDED", "This execution already has a different recovery decision.");
        }
        return { ...await detail(tx, action, currentTime(this.now)), duplicate: true, resolution: existing };
      }
      if (!recoverableAction(action, execution)) throw dispatchError("EXECUTION_NOT_RECOVERABLE", "Historical terminal work cannot be reopened through recovery.");
      const nowMs = currentTime(this.now), timestamp = iso(nowMs);
      if (execution.outcome_class === "DISPATCHING") {
        const expires = instantMs(execution.lease_expires_at);
        if (expires === null || expires > nowMs) throw dispatchError("EXECUTION_STILL_IN_FLIGHT", "This execution may still be active; wait for bounded expiry.");
        await expire(tx, action, execution, timestamp);
        execution = await executions.getExecution(execution.id);
      }
      if (!["UNCERTAIN", "LEGACY_UNKNOWN"].includes(execution.outcome_class)) {
        throw dispatchError("EXECUTION_NOT_RECOVERABLE", "This execution does not require an operator uncertainty decision.");
      }
      const row = {
        id: createId("dres"), organization_id: input.organization_id, action_id: action.id,
        action_execution_id: execution.id, fence_token: execution.fence_token,
        decision: input.decision, evidence_note: evidence, provider_reference: reference,
        reviewer_user_id: input.reviewer_user_id, created_at: timestamp
      };
      await tx.run(`INSERT INTO dispatch_resolutions
        (id, organization_id, action_id, action_execution_id, fence_token, decision, evidence_note, provider_reference, reviewer_user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, Object.values(row));
      if (input.decision === "ACCEPTED") {
        // This is operator-reported acceptance. It is not a delivery callback.
        await tx.run("UPDATE action_executions SET outcome_class = 'ACCEPTED', outcome_at = ?, provider_reference = COALESCE(provider_reference, ?), error = NULL WHERE id = ?",
          [timestamp, reference, execution.id]);
        await tx.run("UPDATE actions SET status = 'EXECUTING', execution_hold_reason = 'OPERATOR_REPORTED_ACCEPTED', next_attempt_at = NULL, last_error = ?, updated_at = ? WHERE id = ? AND organization_id = ?",
          ["Operator recorded acceptance evidence; delivery remains unconfirmed.", timestamp, action.id, input.organization_id]);
      } else {
        await tx.run("UPDATE action_executions SET outcome_class = 'CLOSED_UNRESOLVED', outcome_at = ?, error = ? WHERE id = ?",
          [timestamp, "Closed without retry; historical delivery may remain unknown.", execution.id]);
        await tx.run("UPDATE actions SET status = 'BLOCKED', execution_hold_reason = 'CLOSED_WITHOUT_RETRY', next_attempt_at = NULL, last_error = ?, updated_at = ? WHERE id = ? AND organization_id = ?",
          ["Closed without retry; historical delivery may remain unknown.", timestamp, action.id, input.organization_id]);
      }
      await new AuditRepository(tx).record({ organization_id: input.organization_id, lead_id: action.lead_id, action_id: action.id,
        event_type: "DispatchRecoveryResolved",
        message: input.decision === "ACCEPTED" ? "Operator recorded provider acceptance evidence; delivery is not asserted." : "Operator closed uncertain work without authorizing another send.",
        metadata: { execution_id: execution.id, fence: execution.fence_token, resolution_id: row.id,
          decision: input.decision, reviewer_user_id: input.reviewer_user_id } });
      action = await actions.getAction(action.id);
      return { ...await detail(tx, action, nowMs), duplicate: false, resolution: row };
    });
  }
}

async function expire(tx, action, execution, timestamp) {
  await tx.run("UPDATE action_executions SET outcome_class = 'UNCERTAIN', outcome_at = ?, error = ? WHERE id = ? AND outcome_class = 'DISPATCHING'",
    [timestamp, "Expired dispatch ownership requires reconciliation; no automatic retry.", execution.id]);
  if (action.active_execution_id === execution.id && Number(action.execution_fence) === Number(execution.fence_token)) {
    await tx.run("UPDATE actions SET execution_hold_reason = 'LEASE_EXPIRED', last_error = ?, updated_at = ? WHERE id = ?",
      ["Expired dispatch ownership requires reconciliation; no automatic retry.", timestamp, action.id]);
  }
  await new AuditRepository(tx).record({ organization_id: action.organization_id, lead_id: action.lead_id, action_id: action.id,
    event_type: "DispatchLeaseExpired", message: "Expired dispatch ownership was held as uncertain without another provider call.",
    metadata: { execution_id: execution.id, fence: execution.fence_token } });
}

async function detail(db, action, nowMs) {
  const rows = await new ExecutionsRepository(db).listForAction(action.id);
  const execution = currentExecution(action, rows);
  const summary = executionDetail(action, rows);
  const resolutions = await db.all("SELECT * FROM dispatch_resolutions WHERE organization_id = ? AND action_id = ? ORDER BY created_at ASC",
    [action.organization_id, action.id]);
  const expired = execution?.outcome_class === "DISPATCHING" && instantMs(execution.lease_expires_at) !== null && instantMs(execution.lease_expires_at) <= nowMs;
  const uncertain = ["UNCERTAIN", "LEGACY_UNKNOWN"].includes(execution?.outcome_class);
  const resolved = resolutions.some((row) => row.action_execution_id === execution?.id);
  const canResolve = !!execution && recoverableAction(action, execution) && !resolved && (uncertain || expired)
    && (execution.fence_token === null || Number(action.execution_fence) === Number(execution.fence_token));
  return {
    ...summary, execution, executions: rows, resolutions,
    outcome_class: execution?.outcome_class || (rows.length ? "LEGACY_UNKNOWN" : null),
    recovery_required: !!action.execution_hold_reason || uncertain || expired,
    can_resolve: canResolve, allowed_decisions: canResolve ? DECISIONS : []
  };
}
function recoverableAction(action, execution) {
  if (["COMPLETED", "BLOCKED", "FAILED"].includes(action.status)) return false;
  if (execution.outcome_class === "LEGACY_UNKNOWN") {
    return execution.status !== "COMPLETED" && ["LEGACY_OUTCOME_REVIEW_REQUIRED", "OUTCOME_REVIEW_REQUIRED"].includes(action.execution_hold_reason);
  }
  return true;
}
function currentExecution(action, rows) {
  return action.active_execution_id ? rows.find((row) => row.id === action.active_execution_id) || null
    : rows.length === 1 ? rows[0] : null;
}
function requireText(value, field, limit) {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw dispatchError("INVALID_RECOVERY_INPUT", field + " must contain 1 to " + limit + " characters.", 400);
  return value.trim();
}
function boundedLimit(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw dispatchError("INVALID_RECOVERY_LIMIT", "Recovery limit must be between 1 and " + maximum + ".", 400);
  return value;
}
