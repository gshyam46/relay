import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { parseJson, stringifyJson } from "../../database/database.js";
import { APPROVAL_STATUS } from "./approvalContract.js";

export class ApprovalsRepository {
  constructor(db) {
    this.db = db;
  }

  async createPendingForAction(action, { requested_reason }) {
    const existing = await this.getByActionId(action.id, action.organization_id);
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

    await this.db.run(
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

  async getByActionId(actionId, organizationId) {
    const row = await this.db.get("SELECT * FROM action_approvals WHERE action_id = ? AND organization_id = ?", [
      actionId,
      organizationId
    ]);
    return this.approvalDetail(row);
  }

  async listForOrganization(organizationId, { status = null } = {}) {
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
    const approvals = await this.db.all(sql, params);
    return approvals.map((approval) => this.approvalDetail(approval));
  }

  async approve(actionId, organizationId, { reviewer_name = null, reviewer_note = null, edited_payload = null } = {}) {
    return await this.decide(actionId, organizationId, {
      status: APPROVAL_STATUS.APPROVED,
      reviewer_name,
      reviewer_note,
      edited_payload
    });
  }

  async reject(actionId, organizationId, { reviewer_name = null, reviewer_note = null } = {}) {
    return await this.decide(actionId, organizationId, {
      status: APPROVAL_STATUS.REJECTED,
      reviewer_name,
      reviewer_note,
      edited_payload: null
    });
  }

  async decide(actionId, organizationId, { status, reviewer_name, reviewer_note, edited_payload }) {
    const timestamp = nowIso();
    await this.db.run(
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
    return await this.getByActionId(actionId, organizationId);
  }


  async bindPendingRevision(action, revision, requestedReason = "Review the exact recipient, sender and content.") {
    await this.createPendingForAction(action, { requested_reason: requestedReason });
    await this.db.run(`UPDATE action_approvals SET status = 'PENDING', action_revision_id = ?,
      reviewed_hash = NULL, reviewer_user_id = NULL, reviewer_name = NULL, reviewer_note = NULL,
      edited_payload_json = NULL, decided_at = NULL, updated_at = ?
      WHERE organization_id = ? AND action_id = ?`,
      [revision.id, nowIso(), action.organization_id, action.id]);
    return this.getByActionId(action.id, action.organization_id);
  }

  async projectRevisionDecision(action, revision, decision) {
    const envelope = JSON.parse(revision.envelope_json);
    await this.db.run(`UPDATE action_approvals SET status = ?, action_revision_id = ?, reviewed_hash = ?,
      reviewer_user_id = ?, reviewer_name = ?, reviewer_note = ?, edited_payload_json = ?,
      decided_at = ?, updated_at = ? WHERE organization_id = ? AND action_id = ?`,
      [decision.decision, revision.id, revision.content_hash, decision.reviewer_user_id,
        decision.reviewer_name, decision.reviewer_note, stringifyJson({ subject: envelope.subject, body: envelope.body }),
        decision.decided_at, decision.decided_at, action.organization_id, action.id]);
    return this.getByActionId(action.id, action.organization_id);
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
