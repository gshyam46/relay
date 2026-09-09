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
    received_at = nowIso()
  }) {
    const existing = await this.getByProviderEventId({ organization_id, provider, provider_event_id });
    if (existing) {
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
      created_at: nowIso()
    };
    await this.db.run(
      `INSERT INTO inbound_events
          (id, organization_id, lead_id, channel, provider, provider_event_id, event_type, sentiment,
           confidence, reason, suggested_next_step, payload_json, received_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        event.created_at
      ]
    );
    return { inbound_event: this.eventDetail(event), duplicate: false };
  }

  async getByProviderEventId({ organization_id, provider, provider_event_id }) {
    const row = await this.db.get(
      "SELECT * FROM inbound_events WHERE organization_id = ? AND provider = ? AND provider_event_id = ?",
      [organization_id, provider, provider_event_id]
    );
    return row ? this.eventDetail(row) : null;
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

