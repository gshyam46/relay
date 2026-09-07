import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { parseJson, stringifyJson } from "../../database/database.js";
import { APPROVAL_STATUS } from "./approvalContract.js";

export class ApprovalsRepository {
  constructor(db) {
    this.db = db;
  }

  createPendingForAction(action, { requested_reason }) {
    const existing = this.getByActionId(action.id, action.organization_id);
    if (existing) {
      return existing;
    }

    const timestamp = nowIso();
    const approval = {
      id: createId("appr"),
      organization_id: action.organization_id,
      lead_id: action.lead_id,
      action_id: action.id,
      status: APPROVAL_STATUS.PENDING,
      requested_reason,
      reviewer_name: null,
      reviewer_note: null,
      edited_payload_json: null,
      created_at: timestamp,
      updated_at: timestamp,
      decided_at: null
    };

    this.db.run(
      `INSERT INTO action_approvals
          (id, organization_id, lead_id, action_id, status, requested_reason, reviewer_name,
           reviewer_note, edited_payload_json, created_at, updated_at, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        approval.id,
        approval.organization_id,
        approval.lead_id,
        approval.action_id,
        approval.status,
        approval.requested_reason,
        approval.reviewer_name,
        approval.reviewer_note,
        approval.edited_payload_json,
        approval.created_at,
        approval.updated_at,
        approval.decided_at
      ]
    );
    return approval;
  }

  getByActionId(actionId, organizationId) {
    const row = this.db.get("SELECT * FROM action_approvals WHERE action_id = ? AND organization_id = ?", [
      actionId,
      organizationId
    ]);
    return this.approvalDetail(row);
  }

  listForOrganization(organizationId, { status = null } = {}) {
    const params = [organizationId];
    let sql = `
      SELECT action_approvals.*, leads.name AS lead_name, leads.company AS lead_company, actions.type AS action_type,
             actions.status AS action_status
      FROM action_approvals
      JOIN actions ON actions.id = action_approvals.action_id
      JOIN leads ON leads.id = action_approvals.lead_id
      WHERE action_approvals.organization_id = ?`;
    if (status) {
      sql += " AND action_approvals.status = ?";
      params.push(status);
    }
    sql += " ORDER BY action_approvals.created_at DESC";
    return this.db.all(sql, params).map((approval) => this.approvalDetail(approval));
  }

  approve(actionId, organizationId, { reviewer_name = null, reviewer_note = null, edited_payload = null } = {}) {
    return this.decide(actionId, organizationId, {
      status: APPROVAL_STATUS.APPROVED,
      reviewer_name,
      reviewer_note,
      edited_payload
    });
  }

  reject(actionId, organizationId, { reviewer_name = null, reviewer_note = null } = {}) {
    return this.decide(actionId, organizationId, {
      status: APPROVAL_STATUS.REJECTED,
      reviewer_name,
      reviewer_note,
      edited_payload: null
    });
  }

  decide(actionId, organizationId, { status, reviewer_name, reviewer_note, edited_payload }) {
    const timestamp = nowIso();
    this.db.run(
      `UPDATE action_approvals
          SET status = ?, reviewer_name = ?, reviewer_note = ?, edited_payload_json = ?,
              updated_at = ?, decided_at = ?
        WHERE action_id = ? AND organization_id = ?`,
      [
        status,
        reviewer_name,
        reviewer_note,
        edited_payload ? stringifyJson(edited_payload) : null,
        timestamp,
        timestamp,
        actionId,
        organizationId
      ]
    );
    return this.getByActionId(actionId, organizationId);
  }

  approvalDetail(row) {
    if (!row) {
      return null;
    }
    return {
      ...row,
      edited_payload: parseJson(row.edited_payload_json) || null
    };
  }
}
