import { activeLeadSql } from "../data-foundation/leadDataSafety.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { AuditRepository } from "../events/auditRepository.js";
import { validInstantSql } from "../outbound-automation/actionsRepository.js";

export class FollowUpDueService {
  constructor({ db, contactPolicyService = new ContactPolicyService(db), now = Date.now }) {
    this.db = db; this.contactPolicyService = contactPolicyService; this.now = now;
  }
  async processDue({ organization_id, limit = 5 }) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError("Invalid follow-up limit.");
    const now = new Date(this.now()).toISOString();
    const rows = await this.db.all("SELECT id FROM follow_up_tasks WHERE " + activeLeadSql("follow_up_tasks") + " AND organization_id=? AND status='PLANNED' AND (due_at<=? OR due_at IS NULL OR NOT (" +
      validInstantSql("due_at", this.db.kind) + ")) ORDER BY due_at,created_at,id LIMIT ?", [organization_id, now, limit]);
    const due = [];
    for (const candidate of rows) {
      const row = await this.contactPolicyService.withWorkspacePolicyTransaction(organization_id, async (tx) => {
        const task = await tx.get("SELECT * FROM follow_up_tasks WHERE id=? AND organization_id=?", [candidate.id, organization_id]);
        if (!task || task.status !== "PLANNED") return null;
        const lead = await tx.get("SELECT archived_at FROM leads WHERE organization_id=? AND id=?", [organization_id, task.lead_id]);
        if (!lead || lead.archived_at) return null;
        const instant = typeof task.due_at === "string" ? Date.parse(task.due_at) : NaN;
        const valid = Number.isFinite(instant) && new Date(instant).toISOString() === task.due_at;
        const timestamp = new Date(this.now()).toISOString();
        if (valid && task.due_at > timestamp) return null;
        const result = await tx.run("UPDATE follow_up_tasks SET status=?,updated_at=? WHERE id=? AND organization_id=? AND status='PLANNED'",
          [valid ? "DUE" : "BLOCKED", timestamp, task.id, organization_id]);
        if (!result.changes) return null;
        await new AuditRepository(tx).record({ organization_id, lead_id: task.lead_id, action_id: task.action_id,
          event_type: valid ? "FollowUpBecameDue" : "FollowUpSchedulingBlocked",
          message: valid ? "A scheduled human follow-up is now due." : "A follow-up needs review because its scheduled time is invalid.",
          metadata: { follow_up_id: task.id, code: valid ? "FOLLOW_UP_DUE" : "INVALID_FOLLOW_UP_TIME" } });
        return tx.get("SELECT * FROM follow_up_tasks WHERE id=? AND organization_id=?", [task.id, organization_id]);
      });
      if (row) due.push(row);
    }
    return { due_follow_ups: due };
  }
}
