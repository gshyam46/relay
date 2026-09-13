import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { parseJson, stringifyJson } from "../../database/database.js";

export class CallbacksRepository {
  constructor(db) { this.db = db; }

  async getByProviderEventId(providerEventId) {
    return this.db.get("SELECT * FROM callbacks WHERE provider_event_id = ?", [providerEventId]);
  }

  async getByReceiptId(receiptId) {
    const row = await this.db.get("SELECT * FROM callbacks WHERE webhook_receipt_id = ?", [receiptId]);
    return row ? this.callbackDetail(row) : null;
  }

  async record({ organization_id = null, lead_id = null, action_id, action_execution_id = null,
    provider_event_id, status = "RECEIVED", provider_reference = null, payload,
    webhook_receipt_id = null, received_at = nowIso() }) {
    const existing = await this.getByProviderEventId(provider_event_id);
    if (existing) {
      const prior = parseJson(existing.payload_json) || {};
      if (existing.organization_id !== organization_id || existing.action_id !== action_id
        || existing.action_execution_id !== action_execution_id || existing.status !== status
        || existing.provider_reference !== provider_reference || existing.webhook_receipt_id !== webhook_receipt_id
        || (prior.revision_id || null) !== (payload?.revision_id || null)
        || (prior.provider || null) !== (payload?.provider || null)
        || (prior.source_provider_event_id || null) !== (payload?.source_provider_event_id || null)) {
        throw Object.assign(new Error("Callback event conflicts with this action."),
          { statusCode: 409, code: "CALLBACK_IDENTITY_CONFLICT" });
      }
      return { callback: this.callbackDetail(existing), duplicate: true };
    }
    const callback = { id: createId("cb"), organization_id, lead_id, action_id, action_execution_id,
      provider_event_id, status, provider_reference, payload_json: stringifyJson(payload), received_at,
      webhook_receipt_id, core_applied: null, action_applied: null,
      effects_status: webhook_receipt_id ? "PENDING" : "LEGACY_UNKNOWN", effects_completed_at: null };
    await this.db.run(
      `INSERT INTO callbacks (id, organization_id, lead_id, action_id, action_execution_id,
        provider_event_id, status, provider_reference, payload_json, received_at, webhook_receipt_id,
        core_applied, action_applied, effects_status, effects_completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (provider_event_id) DO NOTHING`,
      [callback.id, organization_id, lead_id, action_id, action_execution_id, provider_event_id, status,
        provider_reference, callback.payload_json, received_at, webhook_receipt_id, null, null,
        callback.effects_status, null]);
    const persisted = await this.getByProviderEventId(provider_event_id);
    if (persisted.id !== callback.id) return this.record({ organization_id, lead_id, action_id,
      action_execution_id, provider_event_id, status, provider_reference, payload, webhook_receipt_id, received_at });
    return { callback: this.callbackDetail(persisted), duplicate: false };
  }

  async markCore(id, { applied, action_applied, reason = null, completed_at }) {
    const row = await this.db.get("SELECT * FROM callbacks WHERE id = ?", [id]);
    const payload = { ...(parseJson(row.payload_json) || {}), effect_reason: reason };
    await this.db.run(`UPDATE callbacks SET core_applied = ?, action_applied = ?, effects_status = ?,
      effects_completed_at = ?, payload_json = ? WHERE id = ? AND core_applied IS NULL`,
      [applied ? 1 : 0, action_applied ? 1 : 0, applied ? "PENDING" : "SKIPPED",
        applied ? null : completed_at, stringifyJson(payload), id]);
    return this.getByReceiptId(row.webhook_receipt_id);
  }

  async markEffects(id, { skipped = false, reason = null, completed_at }) {
    const row = await this.db.get("SELECT * FROM callbacks WHERE id = ?", [id]);
    const payload = { ...(parseJson(row.payload_json) || {}), effect_reason: reason };
    await this.db.run(`UPDATE callbacks SET effects_status = ?, effects_completed_at = ?, payload_json = ?
      WHERE id = ? AND effects_status = 'PENDING'`,
      [skipped ? "SKIPPED" : "DONE", completed_at, stringifyJson(payload), id]);
    return this.getByReceiptId(row.webhook_receipt_id);
  }

  async listForAction(actionId) {
    const rows = await this.db.all("SELECT * FROM callbacks WHERE action_id = ? ORDER BY received_at ASC", [actionId]);
    return rows.map((row) => this.callbackDetail(row));
  }

  callbackDetail(row) {
    const payload = parseJson(row.payload_json) || {};
    return { ...row, storage_provider_event_id: row.provider_event_id,
      provider_event_id: payload.source_provider_event_id || row.provider_event_id, payload };
  }
}
