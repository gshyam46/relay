import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { stringifyJson } from "../../database/database.js";

export class EventsRepository {
  constructor(db) {
    this.db = db;
  }

  async publish({ organization_id, lead_id = null, type, payload = {} }) {
    const event = {
      id: createId("evt"),
      organization_id,
      lead_id,
      type,
      payload_json: stringifyJson(payload),
      status: "PENDING",
      attempts: 0,
      created_at: nowIso()
    };
    await this.db.run(
      `INSERT INTO domain_events
          (id, organization_id, lead_id, type, payload_json, status, attempts, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.organization_id,
        event.lead_id,
        event.type,
        event.payload_json,
        event.status,
        event.attempts,
        event.created_at
      ]
    );
    return event;
  }

  async nextPending(limit = 25) {
    return await this.db.all("SELECT * FROM domain_events WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT ?", [limit]);
  }

  async markProcessed(id) {
    await this.db.run("UPDATE domain_events SET status = 'PROCESSED', processed_at = ?, attempts = attempts + 1 WHERE id = ?", [
      nowIso(),
      id
    ]);
  }

  async markFailed(id, error) {
    await this.db.run("UPDATE domain_events SET status = 'FAILED', attempts = attempts + 1, last_error = ? WHERE id = ?", [
      error.message || String(error),
      id
    ]);
  }
}
