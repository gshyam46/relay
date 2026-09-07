import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { parseJson, stringifyJson } from "../../database/database.js";

export class CallbacksRepository {
  constructor(db) {
    this.db = db;
  }

  getByProviderEventId(providerEventId) {
    return this.db.get("SELECT * FROM callbacks WHERE provider_event_id = ?", [providerEventId]);
  }

  record({
    organization_id = null,
    lead_id = null,
    action_id,
    action_execution_id = null,
    provider_event_id,
    status = "RECEIVED",
    provider_reference = null,
    payload
  }) {
    const existing = this.getByProviderEventId(provider_event_id);
    if (existing) {
      return { callback: this.callbackDetail(existing), duplicate: true };
    }

    const callback = {
      id: createId("cb"),
      organization_id,
      lead_id,
      action_id,
      action_execution_id,
      provider_event_id,
      status,
      provider_reference,
      payload_json: stringifyJson(payload),
      received_at: nowIso()
    };
    this.db.run(
      `INSERT INTO callbacks
          (id, organization_id, lead_id, action_id, action_execution_id, provider_event_id, status,
           provider_reference, payload_json, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        callback.id,
        callback.organization_id,
        callback.lead_id,
        callback.action_id,
        callback.action_execution_id,
        callback.provider_event_id,
        callback.status,
        callback.provider_reference,
        callback.payload_json,
        callback.received_at
      ]
    );
    return { callback: this.callbackDetail(callback), duplicate: false };
  }

  listForAction(actionId) {
    return this.db.all("SELECT * FROM callbacks WHERE action_id = ? ORDER BY received_at ASC", [actionId]).map((callback) => {
      return this.callbackDetail(callback);
    });
  }

  callbackDetail(callback) {
    return {
      ...callback,
      payload: parseJson(callback.payload_json) || {}
    };
  }
}
