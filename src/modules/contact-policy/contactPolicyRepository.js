import { createHash } from "node:crypto";
import { canonicalContactsForLead, channelsForRestriction, ACTION_FOR_CHANNEL, policyError } from "./contactPolicyContract.js";

export class ContactPolicyRepository {
  constructor(db) { this.db = db; }

  getLead(organizationId, leadId) {
    return this.db.get("SELECT * FROM leads WHERE organization_id = ? AND id = ?", [organizationId, leadId]);
  }

  async restrictionsFor(organizationId, contacts, channel) {
    if (contacts.length === 0) return [];
    const parameters = [organizationId];
    const scopes = contacts.map(({ kind, value }) => {
      parameters.push(kind, value);
      return "(contact_kind = ? AND contact_value = ?)";
    });
    const channelClause = channel === "ALL" ? "" : " AND channel IN ('ALL', ?)";
    if (channel !== "ALL") parameters.push(channel);
    return this.db.all("SELECT * FROM contact_restrictions WHERE organization_id = ? AND (" +
      scopes.join(" OR ") + ")" + channelClause + " ORDER BY created_at, id", parameters);
  }

  async append(input, contact) {
    const identity = [input.organization_id, contact.kind, contact.value, input.channel, input.source, input.source_event_id];
    const id = "restriction_" + createHash("sha256").update(JSON.stringify(identity)).digest("hex");
    const existing = await this.db.get("SELECT * FROM contact_restrictions WHERE id = ?", [id]);
    if (existing) {
      if (existing.reason !== input.reason || existing.lead_id !== (input.lead_id || null)) {
        throw policyError(409, "Restriction event identity conflicts with its recorded scope.");
      }
      return { restriction: existing, inserted: false };
    }
    const created_at = new Date().toISOString();
    const restriction = {
      id, organization_id: input.organization_id, contact_kind: contact.kind, contact_value: contact.value,
      channel: input.channel, reason: input.reason, source: input.source, source_event_id: input.source_event_id,
      lead_id: input.lead_id || null, actor_id: input.actor_id || null, effective_at: input.effective_at || created_at, created_at
    };
    await this.db.run(
      "INSERT INTO contact_restrictions (id, organization_id, contact_kind, contact_value, channel, reason, source, source_event_id, lead_id, actor_id, effective_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      Object.values(restriction)
    );
    return { restriction, inserted: true };
  }

  async cancelApplicableWork(organizationId, restrictions) {
    // Exact contact matching only; no name/company inference or transitive
    // expansion through another lead's unrelated email/phone.
    const leads = await this.db.all("SELECT * FROM leads WHERE organization_id = ?", [organizationId]);
    const affected_lead_ids = [];
    let blocked_actions = 0, cancelled_follow_ups = 0, stopped_workflows = 0;
    const timestamp = new Date().toISOString();
    for (const lead of leads) {
      const contacts = canonicalContactsForLead(lead);
      const applicable = restrictions.filter((restriction) => contacts.some((contact) =>
        contact.kind === restriction.contact_kind && contact.value === restriction.contact_value));
      const channels = [...new Set(applicable.flatMap(channelsForRestriction))];
      if (channels.length === 0) continue;
      affected_lead_ids.push(lead.id);
      const actions = channels.map((channel) => ACTION_FOR_CHANNEL[channel]);
      const actionSlots = actions.map(() => "?").join(", ");
      const channelSlots = channels.map(() => "?").join(", ");
      blocked_actions += (await this.db.run(
        "UPDATE actions SET status = 'BLOCKED', last_error = ?, updated_at = ? WHERE organization_id = ? AND lead_id = ? AND type IN (" + actionSlots + ") AND status IN ('PLANNED', 'AWAITING_APPROVAL', 'APPROVED', 'RETRYING')",
        ["Contact restriction prevents outbound communication.", timestamp, organizationId, lead.id, ...actions]
      )).changes;
      cancelled_follow_ups += (await this.db.run(
        "UPDATE follow_up_tasks SET status = 'CANCELLED', updated_at = ? WHERE organization_id = ? AND lead_id = ? AND channel IN (" + channelSlots + ") AND status IN ('PLANNED', 'DUE')",
        [timestamp, organizationId, lead.id, ...channels]
      )).changes;
      stopped_workflows += (await this.db.run(
        "UPDATE workflow_runs SET status = 'STOPPED', revision = revision + 1, stop_reason = ?, next_run_at = NULL, updated_at = ?, completed_at = ? WHERE organization_id = ? AND lead_id = ? AND status IN ('ACTIVE', 'WAITING', 'WAITING_APPROVAL', 'WAITING_EXECUTION') AND EXISTS (SELECT 1 FROM sequence_steps s WHERE s.organization_id = workflow_runs.organization_id AND s.sequence_id = workflow_runs.sequence_id AND s.step_order >= workflow_runs.current_step_order AND s.type IN (" + actionSlots + "))",
        ["Contact restriction stopped outbound workflow.", timestamp, timestamp, organizationId, lead.id, ...actions]
      )).changes;
    }
    return { affected_lead_ids, blocked_actions, cancelled_follow_ups, stopped_workflows };
  }

  async recordAudit(input, restrictions, effects) {
    const id = "policy_audit_" + createHash("sha256").update(JSON.stringify([
      input.organization_id, input.source, input.source_event_id, restrictions.map((row) => row.id).sort()
    ])).digest("hex");
    await this.db.run(
      "INSERT INTO audit_logs (id, organization_id, lead_id, action_id, event_type, message, metadata_json, created_at) VALUES (?, ?, ?, NULL, 'ContactRestricted', ?, ?, ?) ON CONFLICT (id) DO NOTHING",
      [id, input.organization_id, input.lead_id || null, "Contact restriction recorded; applicable queued outbound work stopped.",
        JSON.stringify({ reason: input.reason, source: input.source, source_event_id: input.source_event_id, actor_id: input.actor_id || null, restriction_ids: restrictions.map((row) => row.id), ...effects }),
        new Date().toISOString()]
    );
  }
}
