import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";

export class FollowUpsRepository {
  constructor(db) {
    this.db = db;
  }

  async create({
    organization_id,
    lead_id,
    action_id = null,
    inbound_event_id = null,
    channel,
    status,
    due_at,
    reason,
    idempotency_key,
    escalated = false
  }) {
    const existing = await this.getByIdempotencyKey(organization_id, idempotency_key);
    if (existing) {
      return existing;
    }

    const timestamp = nowIso();
    const followUp = {
      id: createId("fu"),
      organization_id,
      lead_id,
      action_id,
      inbound_event_id,
      channel,
      status,
      due_at,
      reason,
      idempotency_key,
      escalated: escalated ? 1 : 0,
      created_at: timestamp,
      updated_at: timestamp,
      completed_at: null
    };
    await this.db.run(
      `INSERT INTO follow_up_tasks
          (id, organization_id, lead_id, action_id, inbound_event_id, channel, status, due_at, reason,
           idempotency_key, escalated, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        followUp.id,
        followUp.organization_id,
        followUp.lead_id,
        followUp.action_id,
        followUp.inbound_event_id,
        followUp.channel,
        followUp.status,
        followUp.due_at,
        followUp.reason,
        followUp.idempotency_key,
        followUp.escalated,
        followUp.created_at,
        followUp.updated_at,
        followUp.completed_at
      ]
    );
    return followUp;
  }

  async getByIdempotencyKey(organizationId, idempotencyKey) {
    return await this.db.get("SELECT * FROM follow_up_tasks WHERE organization_id = ? AND idempotency_key = ?", [
      organizationId,
      idempotencyKey
    ]);
  }

  async getForOrganization(id, organizationId) {
    return await this.db.get("SELECT * FROM follow_up_tasks WHERE id = ? AND organization_id = ?", [id, organizationId]);
  }

  async listForLead(organizationId, leadId) {
    return await this.db.all(
      `SELECT * FROM follow_up_tasks
       WHERE organization_id = ? AND lead_id = ?
       ORDER BY due_at ASC, created_at DESC`,
      [organizationId, leadId]
    );
  }

  async listForOrganization(organizationId, { status = null } = {}) {
    const params = [organizationId];
    const statusClause = status ? "AND f.status = ?" : "";
    if (status) {
      params.push(status);
    }
    return await this.db.all(
      `SELECT f.*, l.name AS lead_name, l.company AS lead_company
       FROM follow_up_tasks f
       JOIN leads l ON l.id = f.lead_id
       WHERE f.organization_id = ? ${statusClause}
       ORDER BY f.due_at ASC, f.created_at DESC`,
      params
    );
  }

  async complete(id, organizationId) {
    await this.db.run(
      "UPDATE follow_up_tasks SET status = 'COMPLETED', completed_at = ?, updated_at = ? WHERE id = ? AND organization_id = ?",
      [nowIso(), nowIso(), id, organizationId]
    );
    return await this.getForOrganization(id, organizationId);
  }

  async cancel(id, organizationId) {
    await this.db.run(
      "UPDATE follow_up_tasks SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND organization_id = ?",
      [nowIso(), id, organizationId]
    );
    return await this.getForOrganization(id, organizationId);
  }

  async cancelOpenForLead(organizationId, leadId, { action_id = null } = {}) {
    const params = [nowIso(), organizationId, leadId];
    let actionClause = "";
    if (action_id) {
      actionClause = "AND action_id = ?";
      params.push(action_id);
    }
    await this.db.run(
      `UPDATE follow_up_tasks
       SET status = 'CANCELLED', updated_at = ?
       WHERE organization_id = ? AND lead_id = ? ${actionClause}
         AND status IN ('PLANNED', 'DUE')`,
      params
    );
  }
}

