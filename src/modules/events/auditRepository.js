import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { stringifyJson } from "../../database/database.js";

export class AuditRepository {
  constructor(db) {
    this.db = db;
  }

  record({ organization_id, lead_id = null, action_id = null, event_type, message, metadata = {} }) {
    const auditLog = {
      id: createId("audit"),
      organization_id,
      lead_id,
      action_id,
      event_type,
      message,
      metadata_json: stringifyJson(metadata),
      created_at: nowIso()
    };
    this.db.run(
      `INSERT INTO audit_logs
          (id, organization_id, lead_id, action_id, event_type, message, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        auditLog.id,
        auditLog.organization_id,
        auditLog.lead_id,
        auditLog.action_id,
        auditLog.event_type,
        auditLog.message,
        auditLog.metadata_json,
        auditLog.created_at
      ]
    );
    return auditLog;
  }
}
