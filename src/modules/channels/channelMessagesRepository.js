import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { parseJson, stringifyJson } from "../../database/database.js";

export class ChannelMessagesRepository {
  constructor(db) {
    this.db = db;
  }

  create({
    organization_id,
    lead_id,
    action_id = null,
    inbound_event_id = null,
    direction,
    channel,
    status,
    subject = null,
    body = null,
    summary = null,
    provider = "mock-channel",
    provider_reference = null,
    provider_event_id = null,
    idempotency_key,
    payload = {},
    occurred_at = nowIso()
  }) {
    const existing = this.getByIdempotencyKey(organization_id, idempotency_key);
    if (existing) {
      return existing;
    }

    const timestamp = nowIso();
    const message = {
      id: createId("msg"),
      organization_id,
      lead_id,
      action_id,
      inbound_event_id,
      direction,
      channel,
      status,
      subject,
      body,
      summary,
      provider,
      provider_reference,
      provider_event_id,
      idempotency_key,
      payload_json: stringifyJson(payload),
      occurred_at,
      created_at: timestamp,
      updated_at: timestamp
    };
    this.db.run(
      `INSERT INTO channel_messages
          (id, organization_id, lead_id, action_id, inbound_event_id, direction, channel, status,
           subject, body, summary, provider, provider_reference, provider_event_id, idempotency_key,
           payload_json, occurred_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        message.organization_id,
        message.lead_id,
        message.action_id,
        message.inbound_event_id,
        message.direction,
        message.channel,
        message.status,
        message.subject,
        message.body,
        message.summary,
        message.provider,
        message.provider_reference,
        message.provider_event_id,
        message.idempotency_key,
        message.payload_json,
        message.occurred_at,
        message.created_at,
        message.updated_at
      ]
    );
    return this.messageDetail(message);
  }

  getByIdempotencyKey(organizationId, idempotencyKey) {
    const row = this.db.get("SELECT * FROM channel_messages WHERE organization_id = ? AND idempotency_key = ?", [
      organizationId,
      idempotencyKey
    ]);
    return row ? this.messageDetail(row) : null;
  }

  latestOutboundForAction(actionId, organizationId) {
    const row = this.db.get(
      `SELECT * FROM channel_messages
       WHERE organization_id = ? AND action_id = ? AND direction = 'OUTBOUND'
       ORDER BY occurred_at DESC, created_at DESC
       LIMIT 1`,
      [organizationId, actionId]
    );
    return row ? this.messageDetail(row) : null;
  }

  updateStatus(id, status, { provider_reference = null, summary = null } = {}) {
    this.db.run(
      `UPDATE channel_messages
       SET status = ?, provider_reference = COALESCE(provider_reference, ?), summary = COALESCE(?, summary), updated_at = ?
       WHERE id = ?`,
      [status, provider_reference, summary, nowIso(), id]
    );
    const row = this.db.get("SELECT * FROM channel_messages WHERE id = ?", [id]);
    return row ? this.messageDetail(row) : null;
  }

  listForLead(organizationId, leadId) {
    return this.db
      .all(
        `SELECT * FROM channel_messages
         WHERE organization_id = ? AND lead_id = ?
         ORDER BY occurred_at DESC, created_at DESC`,
        [organizationId, leadId]
      )
      .map((row) => this.messageDetail(row));
  }

  listForOrganization(organizationId, { limit = 50 } = {}) {
    return this.db
      .all(
        `SELECT cm.*, l.name AS lead_name, l.company AS lead_company
         FROM channel_messages cm
         JOIN leads l ON l.id = cm.lead_id
         WHERE cm.organization_id = ?
         ORDER BY cm.occurred_at DESC, cm.created_at DESC
         LIMIT ?`,
        [organizationId, limit]
      )
      .map((row) => this.messageDetail(row));
  }

  messageDetail(row) {
    return {
      ...row,
      payload: parseJson(row.payload_json) || {}
    };
  }
}

