import { activeLeadSql } from "../data-foundation/leadDataSafety.js";
import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { parseJson, stringifyJson } from "../../database/database.js";
import { ACTION_STATUS, EXECUTION_MODE } from "./actionContract.js";

export class ActionsRepository {
  constructor(db) {
    this.db = db;
  }

  async createAction({
    organization_id,
    lead_id,
    type,
    payload = {},
    idempotency_key,
    scheduled_at = null,
    status = ACTION_STATUS.PLANNED,
    next_best_action_plan_id = null,
    approval_requirement = "NOT_REQUIRED",
    execution_mode = EXECUTION_MODE.SANDBOX,
    provider = "mock-n8n",
    max_attempts = 3,
    workflow_run_id = null,
    sequence_step_id = null
  }) {
    if (Boolean(workflow_run_id) !== Boolean(sequence_step_id)) throw new Error("Both workflow action links are required.");
    if (workflow_run_id) {
      const link = await this.db.get(`SELECT wr.id FROM workflow_runs wr
        JOIN sequence_steps ss ON ss.id = ? AND ss.sequence_id = wr.sequence_id AND ss.organization_id = wr.organization_id
        WHERE wr.id = ? AND wr.organization_id = ? AND wr.lead_id = ? AND ss.type = ?`,
        [sequence_step_id, workflow_run_id, organization_id, lead_id, type]);
      if (!link) throw new Error("Workflow action links do not match this workspace, lead and step.");
    }
    const existing = await this.getByIdempotencyKey(idempotency_key);
    if (existing) {
      if (existing.organization_id !== organization_id || existing.lead_id !== lead_id
        || existing.workflow_run_id !== workflow_run_id || existing.sequence_step_id !== sequence_step_id) {
        throw new Error("Action idempotency key belongs to different work.");
      }
      return existing;
    }

    const timestamp = nowIso();
    const action = {
      id: createId("act"),
      organization_id,
      lead_id,
      type,
      status,
      payload_json: stringifyJson(payload),
      idempotency_key,
      next_best_action_plan_id,
      approval_requirement,
      execution_mode,
      provider,
      last_error: null,
      scheduled_at,
      max_attempts,
      workflow_run_id,
      sequence_step_id,
      next_attempt_at: null,
      first_dispatch_at: null,
      retry_deadline_at: null,
      execution_fence: 0,
      active_execution_id: null,
      execution_hold_reason: null,
      created_at: timestamp,
      updated_at: timestamp
    };

    await this.db.run(
      `INSERT INTO actions
          (id, organization_id, lead_id, type, status, payload_json, idempotency_key,
           next_best_action_plan_id, approval_requirement, execution_mode, provider, last_error,
           scheduled_at, created_at, updated_at, max_attempts, workflow_run_id, sequence_step_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        action.id,
        action.organization_id,
        action.lead_id,
        action.type,
        action.status,
        action.payload_json,
        action.idempotency_key,
        action.next_best_action_plan_id,
        action.approval_requirement,
        action.execution_mode,
        action.provider,
        action.last_error,
        action.scheduled_at,
        action.created_at,
        action.updated_at,
        action.max_attempts,
        workflow_run_id,
        sequence_step_id
      ]
    );
    return action;
  }

  async getByIdempotencyKey(idempotencyKey) {
    return await this.db.get("SELECT * FROM actions WHERE idempotency_key = ?", [idempotencyKey]);
  }

  async getAction(id) {
    return await this.db.get("SELECT * FROM actions WHERE id = ?", [id]);
  }

  async getActionForOrganization(id, organizationId) {
    return await this.db.get("SELECT * FROM actions WHERE id = ? AND organization_id = ?", [id, organizationId]);
  }

  async getActionForUpdate(id, organizationId) {
    if (!this.db.transactionBound) throw new Error("Action locking requires a transaction-scoped repository.");
    // SQLite already reserves its writer in BEGIN IMMEDIATE. PostgreSQL locks
    // this tenant-owned row so competing approval decisions see the winner.
    const lock = this.db.kind === "postgres" ? " FOR UPDATE" : "";
    return this.db.get("SELECT * FROM actions WHERE id = ? AND organization_id = ?" + lock, [id, organizationId]);
  }

  async getByPlanId(planId, organizationId) {
    return await this.db.get("SELECT * FROM actions WHERE next_best_action_plan_id = ? AND organization_id = ?", [
      planId,
      organizationId
    ]);
  }

  async listForLead(leadId) {
    return await this.db.all("SELECT * FROM actions WHERE lead_id = ? ORDER BY created_at DESC", [leadId]);
  }

  async listForLeadScoped(leadId, organizationId) {
    return await this.db.all("SELECT * FROM actions WHERE lead_id = ? AND organization_id = ? ORDER BY created_at DESC", [
      leadId,
      organizationId
    ]);
  }

  async nextExecutable(limit = 25, organizationId = null, at = nowIso(), operationsPredicate = null) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new TypeError("Queue limit must be an integer between 1 and 1000.");
    if (typeof at !== "string" || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) {
      throw new TypeError("Queue time must be a canonical UTC ISO instant.");
    }
    if (operationsPredicate && (typeof operationsPredicate.sql !== "string" || !Array.isArray(operationsPredicate.params))) {
      throw new TypeError("Invalid internal dispatch candidate predicate.");
    }
    const operations = operationsPredicate ? " AND (" + operationsPredicate.sql + ")" : "";
    const scope = organizationId === null ? "" : " AND organization_id = ?";
    const due = ["scheduled_at", "next_attempt_at"].map((column) =>
      "(" + column + " IS NULL OR " + column + " <= ? OR NOT (" + validInstantSql(column, this.db.kind) + "))"
    ).join(" AND ");
    return this.db.all(
      "SELECT * FROM actions WHERE " + activeLeadSql("actions") + " AND " + workflowDispatchCandidateSql("actions") + " AND status IN ('PLANNED', 'APPROVED', 'RETRYING') AND execution_hold_reason IS NULL AND "
        + due + scope + operations + " ORDER BY created_at ASC, id ASC LIMIT ?",
      [at, at, ...(organizationId === null ? [] : [organizationId]), ...(operationsPredicate?.params || []), limit]
    );
  }

  async listByStatus(status, limit = 50) {
    return await this.db.all("SELECT * FROM actions WHERE status = ? ORDER BY created_at ASC LIMIT ?", [status, limit]);
  }

  async updateStatus(id, status, { last_error = null } = {}) {
    await this.db.run("UPDATE actions SET status = ?, last_error = ?, updated_at = ? WHERE id = ?", [status, last_error, nowIso(), id]);
    return await this.getAction(id);
  }

  async mergePayload(id, patch) {
    const action = await this.getAction(id);
    const payload = {
      ...this.actionPayload(action),
      ...patch
    };
    await this.db.run("UPDATE actions SET payload_json = ?, updated_at = ? WHERE id = ?", [stringifyJson(payload), nowIso(), id]);
    return await this.getAction(id);
  }

  actionPayload(action) {
    return parseJson(action.payload_json) || {};
  }
}

// Only the two literal column names above enter this SQL. Canonical dates sort
// chronologically as text. Malformed/future-looking dates remain candidates so
// the authoritative executor can persist an actionable hold instead of hiding
// a broken item forever. CASE protects PostgreSQL integer casts from bad text.
export function validInstantSql(column, kind) {
  const digits = "[0-9]";
  const format = kind === "postgres"
    ? column + " ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$'"
    : column + " GLOB '" + digits.repeat(4) + "-" + digits.repeat(2) + "-" + digits.repeat(2)
      + "T" + digits.repeat(2) + ":" + digits.repeat(2) + ":" + digits.repeat(2) + "." + digits.repeat(3) + "Z'";
  const part = (start, length) => "CAST(substr(" + column + ", " + start + ", " + length + ") AS INTEGER)";
  const year = part(1, 4), month = part(6, 2), day = part(9, 2);
  const leap = "(" + year + " % 4 = 0 AND (" + year + " % 100 <> 0 OR " + year + " % 400 = 0))";
  const days = "CASE WHEN " + month + " = 2 THEN CASE WHEN " + leap + " THEN 29 ELSE 28 END WHEN "
    + month + " IN (4,6,9,11) THEN 30 ELSE 31 END";
  return "CASE WHEN " + format + " THEN (" + month + " BETWEEN 1 AND 12 AND " + day + " BETWEEN 1 AND (" + days
    + ") AND " + part(12, 2) + " BETWEEN 0 AND 23 AND " + part(15, 2) + " BETWEEN 0 AND 59 AND "
    + part(18, 2) + " BETWEEN 0 AND 59) ELSE FALSE END";
}

// Paused linked work must not monopolize a bounded dispatch queue. Malformed,
// stopped and historical links remain candidates for the authoritative guard.
export function workflowDispatchCandidateSql(alias) {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(alias)) throw new TypeError("Invalid action query alias.");
  return `NOT EXISTS (SELECT 1 FROM workflow_runs wr JOIN sequences s ON s.id = wr.sequence_id
    AND s.organization_id = wr.organization_id JOIN campaigns c ON c.id = wr.campaign_id
    AND c.organization_id = wr.organization_id AND s.campaign_id = c.id
    JOIN sequence_steps ss ON ss.id = ${alias}.sequence_step_id AND ss.sequence_id = wr.sequence_id
    AND ss.organization_id = wr.organization_id AND ss.type = ${alias}.type AND ss.step_order = wr.current_step_order
    WHERE wr.id = ${alias}.workflow_run_id AND wr.organization_id = ${alias}.organization_id
    AND wr.lead_id = ${alias}.lead_id AND wr.last_action_id = ${alias}.id AND wr.processing_version = 1
    AND wr.status IN ('WAITING_APPROVAL','WAITING_EXECUTION') AND wr.scheduler_hold_reason IS NULL
    AND s.status IN ('ACTIVE','PAUSED') AND c.status IN ('ACTIVE','PAUSED')
    AND (wr.paused_at IS NOT NULL OR s.status = 'PAUSED' OR c.status = 'PAUSED'))`;
}
