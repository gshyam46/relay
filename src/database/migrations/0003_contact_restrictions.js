// Immutable additive restriction schema and conservative historical backfill.
// Helpers are frozen here instead of importing mutable runtime policy code.
import { createHash } from "node:crypto";
export const id = "0003_contact_restrictions";

export async function up(db) {
  await db.exec(`
    CREATE TABLE contact_restrictions (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      contact_kind TEXT NOT NULL CHECK (contact_kind IN ('LEAD', 'EMAIL', 'PHONE')),
      contact_value TEXT NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('ALL', 'EMAIL', 'WHATSAPP', 'SMS', 'VOICE')),
      reason TEXT NOT NULL CHECK (reason IN ('OPT_OUT', 'SUPPRESSED', 'UNSUBSCRIBE', 'COMPLAINT', 'HARD_BOUNCE', 'DELIVERY_REVIEW')),
      source TEXT NOT NULL,
      source_event_id TEXT NOT NULL,
      lead_id TEXT REFERENCES leads(id),
      actor_id TEXT,
      effective_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(organization_id, contact_kind, contact_value, channel, source, source_event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_leads_contact_email ON leads(organization_id, normalized_email);
    CREATE INDEX IF NOT EXISTS idx_leads_contact_phone ON leads(organization_id, normalized_phone);
  `);
  const leads = await db.all("SELECT * FROM leads");
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  const cases = [];
  for (const lead of leads) {
    if (["OPTED_OUT", "SUPPRESSED"].includes(lead.status)) {
      cases.push({ lead, channel: "ALL", reason: lead.status === "OPTED_OUT" ? "OPT_OUT" : "SUPPRESSED",
        source: "LEGACY_STATUS", event: lead.id, effective: lead.updated_at });
    }
  }
  for (const inbound of await db.all("SELECT * FROM inbound_events WHERE event_type = 'OPT_OUT'")) {
    const lead = leadById.get(inbound.lead_id);
    if (lead?.organization_id === inbound.organization_id) {
      cases.push({ lead, channel: "ALL", reason: "OPT_OUT", source: "LEGACY_INBOUND", event: inbound.id, effective: inbound.received_at });
    }
  }
  for (const audit of await db.all("SELECT * FROM audit_logs WHERE event_type = 'EmailTrackingEvent'")) {
    const lead = leadById.get(audit.lead_id);
    const metadata = json(audit.metadata_json);
    const reason = ["unsubscribe", "group_unsubscribe"].includes(metadata.event) ? "UNSUBSCRIBE"
      : metadata.event === "spamreport" ? "COMPLAINT" : null;
    if (reason && lead?.organization_id === audit.organization_id) {
      cases.push({ lead, channel: "EMAIL", reason, source: "LEGACY_PROVIDER", event: "audit:" + audit.id, effective: audit.created_at });
    }
  }
  const actions = new Map((await db.all("SELECT id, organization_id, lead_id FROM actions")).map((action) => [action.id, action]));
  for (const callback of await db.all("SELECT * FROM callbacks")) {
    const action = actions.get(callback.action_id);
    const lead = leadById.get(action?.lead_id);
    const event = json(callback.payload_json).details?.reason;
    const reason = ["unsubscribe", "group_unsubscribe"].includes(event) ? "UNSUBSCRIBE"
      : event === "spamreport" ? "COMPLAINT" : event === "bounce" ? "DELIVERY_REVIEW" : null;
    if (reason && action && lead?.organization_id === action.organization_id &&
        (!callback.organization_id || callback.organization_id === action.organization_id)) {
      cases.push({ lead, channel: "EMAIL", reason, source: "LEGACY_PROVIDER", event: "callback:" + callback.id, effective: callback.received_at });
    }
  }
  const timestamp = new Date().toISOString();
  const restrictions = [];
  for (const item of cases) {
    for (const contact of contacts(item.lead).filter((value) => item.channel === "ALL" || value.kind !== "PHONE")) {
      const identity = [item.lead.organization_id, contact.kind, contact.value, item.channel, item.source, item.event];
      const recordId = "restriction_" + createHash("sha256").update(JSON.stringify(identity)).digest("hex");
      await db.run(
        "INSERT INTO contact_restrictions (id, organization_id, contact_kind, contact_value, channel, reason, source, source_event_id, lead_id, actor_id, effective_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)",
        [recordId, item.lead.organization_id, contact.kind, contact.value, item.channel, item.reason, item.source, item.event, item.lead.id, item.effective || timestamp, timestamp]
      );
      restrictions.push({ organization_id: item.lead.organization_id, contact_kind: contact.kind, contact_value: contact.value, channel: item.channel });
    }
  }
  const byIdentity = new Map();
  for (const restriction of restrictions) {
    const key = JSON.stringify([restriction.organization_id, restriction.contact_kind, restriction.contact_value]);
    if (!byIdentity.has(key)) byIdentity.set(key, []);
    byIdentity.get(key).push(restriction);
  }
  for (const lead of leads) {
    const identifiers = contacts(lead);
    const matching = identifiers.flatMap((contact) => byIdentity.get(JSON.stringify([lead.organization_id, contact.kind, contact.value])) || []);
    const channels = [...new Set(matching.flatMap((restriction) => {
      const possible = restriction.contact_kind === "EMAIL" ? ["EMAIL"] : restriction.contact_kind === "PHONE" ? ["WHATSAPP", "SMS", "VOICE"] : ["EMAIL", "WHATSAPP", "SMS", "VOICE"];
      return restriction.channel === "ALL" ? ["EMAIL", "WHATSAPP", "SMS", "VOICE"] : possible.filter((channel) => channel === restriction.channel);
    }))];
    if (channels.length === 0) continue;
    const types = channels.map((channel) => ({ EMAIL: "SEND_EMAIL", WHATSAPP: "SEND_WHATSAPP", SMS: "SEND_SMS", VOICE: "SEND_VOICE_CALL" })[channel]);
    const slots = types.map(() => "?").join(", ");
    await db.run("UPDATE actions SET status = 'BLOCKED', last_error = 'Historical contact restriction requires review.', updated_at = ? WHERE organization_id = ? AND lead_id = ? AND type IN (" + slots + ") AND status IN ('PLANNED', 'AWAITING_APPROVAL', 'APPROVED', 'RETRYING')",
      [timestamp, lead.organization_id, lead.id, ...types]);
    await db.run("UPDATE follow_up_tasks SET status = 'CANCELLED', updated_at = ? WHERE organization_id = ? AND lead_id = ? AND channel IN (" + channels.map(() => "?").join(", ") + ") AND status IN ('PLANNED', 'DUE')",
      [timestamp, lead.organization_id, lead.id, ...channels]);
    await db.run("UPDATE workflow_runs SET status = 'STOPPED', stop_reason = 'Historical contact restriction requires review.', next_run_at = NULL, updated_at = ?, completed_at = ? WHERE organization_id = ? AND lead_id = ? AND status IN ('ACTIVE', 'WAITING', 'WAITING_APPROVAL') AND EXISTS (SELECT 1 FROM sequence_steps s WHERE s.organization_id = workflow_runs.organization_id AND s.sequence_id = workflow_runs.sequence_id AND s.step_order >= workflow_runs.current_step_order AND s.type IN (" + slots + "))",
      [timestamp, timestamp, lead.organization_id, lead.id, ...types]);
  }
}

function json(value) { try { return JSON.parse(value || "{}") || {}; } catch { return {}; } }
function contacts(lead) {
  const result = [{ kind: "LEAD", value: lead.id }];
  for (const raw of [lead.normalized_email, lead.email]) {
    const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) result.push({ kind: "EMAIL", value });
  }
  for (const raw of [lead.normalized_phone, lead.phone]) {
    const value = typeof raw === "string" ? raw.trim().replace(/[\s().-]/g, "") : "";
    if (/^\+[1-9]\d{7,14}$/.test(value)) result.push({ kind: "PHONE", value });
  }
  return result.filter((contact, index) => result.findIndex((other) => other.kind === contact.kind && other.value === contact.value) === index);
}
