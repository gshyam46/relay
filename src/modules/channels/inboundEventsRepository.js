import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { parseJson, stringifyJson } from "../../database/database.js";

export class InboundEventsRepository {
  constructor(db) {
    this.db = db;
  }

  async create({
    organization_id,
    lead_id,
    channel,
    provider = "mock-channel",
    provider_event_id,
    event_type,
    sentiment = null,
    confidence = null,
    reason = null,
    suggested_next_step = null,
    payload = {},
    received_at = nowIso(),
    webhook_receipt_id = null,
    effects_status = "LEGACY_UNKNOWN"
  }) {
    const existing = await this.getByProviderEventId({ organization_id, provider, provider_event_id });
    if (existing) {
      this.assertCompatibleReceipt(existing, { lead_id, channel, payload });
      return { inbound_event: existing, duplicate: true };
    }

    const event = {
      id: createId("inb"),
      organization_id,
      lead_id,
      channel,
      provider,
      provider_event_id,
      event_type,
      sentiment,
      confidence,
      reason,
      suggested_next_step,
      payload_json: stringifyJson(payload),
      received_at,
      created_at: nowIso(),
      webhook_receipt_id, effects_status, effects_completed_at: null
    };
    const inserted = await this.db.run(
      `INSERT INTO inbound_events
          (id, organization_id, lead_id, channel, provider, provider_event_id, event_type, sentiment,
           confidence, reason, suggested_next_step, payload_json, received_at, created_at, webhook_receipt_id, effects_status, effects_completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (organization_id, provider, provider_event_id) DO NOTHING`,
      [
        event.id,
        event.organization_id,
        event.lead_id,
        event.channel,
        event.provider,
        event.provider_event_id,
        event.event_type,
        event.sentiment,
        event.confidence,
        event.reason,
        event.suggested_next_step,
        event.payload_json,
        event.received_at,
        event.created_at, event.webhook_receipt_id, event.effects_status, event.effects_completed_at
      ]
    );
    if (inserted.changes === 0) {
      const canonical = await this.getByProviderEventId({ organization_id, provider, provider_event_id });
      if (!canonical) throw new Error("Inbound receipt was not persisted.");
      this.assertCompatibleReceipt(canonical, { lead_id, channel, payload });
      return { inbound_event: canonical, duplicate: true };
    }
    return { inbound_event: this.eventDetail(event), duplicate: false };
  }

  assertCompatibleReceipt(existing, { lead_id, channel, payload = {} }) {
    const identityConflict = existing.lead_id !== lead_id || existing.channel !== channel;
    const contentConflict = ["text", "transcript", "summary", "subject"].some((key) =>
      (payload[key] ?? null) !== (existing.payload?.[key] ?? null));
    if (identityConflict || contentConflict) {
      const error = new Error("Inbound event identity conflicts with its recorded receipt.");
      error.statusCode = 409;
      error.code = "INBOUND_IDENTITY_CONFLICT";
      throw error;
    }
  }

  async getByProviderEventId({ organization_id, provider, provider_event_id }) {
    const row = await this.db.get(
      "SELECT * FROM inbound_events WHERE organization_id = ? AND provider = ? AND provider_event_id = ?",
      [organization_id, provider, provider_event_id]
    );
    return row ? this.eventDetail(row) : null;
  }

  async markEffectsDone(id, organizationId, receiptId) {
    await this.db.run("UPDATE inbound_events SET effects_status = 'DONE', effects_completed_at = ? WHERE id = ? AND organization_id = ? AND webhook_receipt_id = ? AND effects_status = 'PENDING'", [nowIso(), id, organizationId, receiptId]);
  }

  async listForLead(organizationId, leadId) {
    const rows = await this.db.all(
      `SELECT * FROM inbound_events
         WHERE organization_id = ? AND lead_id = ?
         ORDER BY received_at DESC, created_at DESC`,
      [organizationId, leadId]
    );
    return rows.map((row) => this.eventDetail(row));
  }

  eventDetail(row) {
    return {
      ...row,
      payload: parseJson(row.payload_json) || {}
    };
  }
}

