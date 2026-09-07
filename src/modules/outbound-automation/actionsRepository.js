import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { parseJson, stringifyJson } from "../../database/database.js";
import { ACTION_STATUS, EXECUTION_MODE } from "./actionContract.js";

export class ActionsRepository {
  constructor(db) {
    this.db = db;
  }

  createAction({
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
    provider = "mock-n8n"
  }) {
    const existing = this.getByIdempotencyKey(idempotency_key);
    if (existing) {
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
      created_at: timestamp,
      updated_at: timestamp
    };

    this.db.run(
      `INSERT INTO actions
          (id, organization_id, lead_id, type, status, payload_json, idempotency_key,
           next_best_action_plan_id, approval_requirement, execution_mode, provider, last_error,
           scheduled_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        action.updated_at
      ]
    );
    return action;
  }

  getByIdempotencyKey(idempotencyKey) {
    return this.db.get("SELECT * FROM actions WHERE idempotency_key = ?", [idempotencyKey]);
  }

  getAction(id) {
    return this.db.get("SELECT * FROM actions WHERE id = ?", [id]);
  }

  getActionForOrganization(id, organizationId) {
    return this.db.get("SELECT * FROM actions WHERE id = ? AND organization_id = ?", [id, organizationId]);
  }

  getByPlanId(planId, organizationId) {
    return this.db.get("SELECT * FROM actions WHERE next_best_action_plan_id = ? AND organization_id = ?", [
      planId,
      organizationId
    ]);
  }

  listForLead(leadId) {
    return this.db.all("SELECT * FROM actions WHERE lead_id = ? ORDER BY created_at DESC", [leadId]);
  }

  listForLeadScoped(leadId, organizationId) {
    return this.db.all("SELECT * FROM actions WHERE lead_id = ? AND organization_id = ? ORDER BY created_at DESC", [
      leadId,
      organizationId
    ]);
  }

  nextExecutable(limit = 25) {
    return this.db.all(
      "SELECT * FROM actions WHERE status IN ('PLANNED', 'APPROVED', 'RETRYING') ORDER BY created_at ASC LIMIT ?",
      [limit]
    );
  }

  updateStatus(id, status, { last_error = null } = {}) {
    this.db.run("UPDATE actions SET status = ?, last_error = ?, updated_at = ? WHERE id = ?", [status, last_error, nowIso(), id]);
    return this.getAction(id);
  }

  mergePayload(id, patch) {
    const action = this.getAction(id);
    const payload = {
      ...this.actionPayload(action),
      ...patch
    };
    this.db.run("UPDATE actions SET payload_json = ?, updated_at = ? WHERE id = ?", [stringifyJson(payload), nowIso(), id]);
    return this.getAction(id);
  }

  actionPayload(action) {
    return parseJson(action.payload_json) || {};
  }
}
