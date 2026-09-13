import { assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";
import { canonicalContact } from "../contact-policy/contactPolicyContract.js";
import { WorkflowsRepository } from "../workflows/workflowsRepository.js";
import { nowIso } from "../../shared/time.js";

export const AMBIGUOUS_REPLY_LIMIT = 100;
const EVENT = "AmbiguousInboundWorkStopped";
const markerId = receiptId => "ambiguous_inbound_stop:" + receiptId;
const slots = values => values.map(() => "?").join(",");
const failure = (code = "AMBIGUOUS_REPLY_LIMIT") => Object.assign(new Error("Ambiguous reply safety requires operational review."), { code, statusCode: 503 });
const openRuns = "('ACTIVE','WAITING','WAITING_APPROVAL','WAITING_EXECUTION')";
const queuedActions = "('PLANNED','AWAITING_APPROVAL','APPROVED','RETRYING')";

// A previously quarantined receipt can already say policy DONE. Re-establish
// the dispatch hold before any new processing that has no frozen lead identity.
export async function prepareUnassignedInboundInTransaction(tx, receipt) {
  assertWorkspaceTransaction(tx, receipt.organization_id);
  const marker = await tx.get("SELECT id FROM audit_logs WHERE id=? AND organization_id=? AND event_type=?", [markerId(receipt.id), receipt.organization_id, EVENT]);
  if (marker) return { already_stopped: true };
  await tx.run("UPDATE webhook_receipts SET mandatory_policy_status='PENDING' WHERE id=? AND organization_id=?", [receipt.id, receipt.organization_id]);
  return { already_stopped: false };
}

export async function stopAmbiguousInboundWorkInTransaction(tx, { receipt, contact }) {
  const org = receipt.organization_id;
  assertWorkspaceTransaction(tx, org);
  if (await tx.get("SELECT id FROM audit_logs WHERE id=? AND organization_id=? AND event_type=?", [markerId(receipt.id), org, EVENT])) return { duplicate: true };
  const sender = { email: canonicalContact("EMAIL", contact?.email)?.value || null, phone: canonicalContact("PHONE", contact?.phone)?.value || null };
  const leads = await tx.all("SELECT id FROM leads WHERE organization_id=? AND ((? IS NOT NULL AND normalized_email=?) OR (? IS NOT NULL AND normalized_phone=?)) ORDER BY id LIMIT ?",
    [org, sender.email, sender.email, sender.phone, sender.phone, AMBIGUOUS_REPLY_LIMIT + 1]);
  if (leads.length > AMBIGUOUS_REPLY_LIMIT) throw failure();
  if (leads.length < 2) throw failure("AMBIGUOUS_REPLY_STATE_INVALID");
  const ids = leads.map(lead => lead.id);
  const runs = await tx.all("SELECT * FROM workflow_runs WHERE organization_id=? AND lead_id IN (" + slots(ids) + ") AND status IN " + openRuns + " ORDER BY id LIMIT ?", [org, ...ids, AMBIGUOUS_REPLY_LIMIT + 1]);
  const tasks = await tx.all("SELECT id FROM follow_up_tasks WHERE organization_id=? AND lead_id IN (" + slots(ids) + ") AND status IN ('PLANNED','DUE') AND action_id IS NOT NULL AND idempotency_key='action:' || action_id || ':no-response-follow-up:v1' ORDER BY id LIMIT ?", [org, ...ids, AMBIGUOUS_REPLY_LIMIT + 1]);
  if (runs.length > AMBIGUOUS_REPLY_LIMIT || tasks.length > AMBIGUOUS_REPLY_LIMIT) throw failure();
  const runIds = runs.map(run => run.id);
  const actions = runIds.length ? await tx.all("SELECT id FROM actions WHERE organization_id=? AND workflow_run_id IN (" + slots(runIds) + ") AND status IN " + queuedActions + " ORDER BY id LIMIT ?", [org, ...runIds, AMBIGUOUS_REPLY_LIMIT + 1]) : [];
  if (actions.length > AMBIGUOUS_REPLY_LIMIT) throw failure();
  const timestamp = nowIso(), workflows = new WorkflowsRepository(tx);
  for (const run of runs) {
    await workflows.advanceRun(run, { status: "STOPPED", next_run_at: null, stop_reason: "A reply matches several enquiries. Review the received event before continuing." }, timestamp);
    await workflows.cancelQueuedActions(run, timestamp);
  }
  if (tasks.length) await tx.run("UPDATE follow_up_tasks SET status='CANCELLED',updated_at=? WHERE organization_id=? AND id IN (" + slots(tasks) + ") AND status IN ('PLANNED','DUE')", [timestamp, org, ...tasks.map(task => task.id)]);
  const metadata = { receipt_id: receipt.id, received_at: receipt.received_at, contact: sender, matched_lead_ids: ids,
    stopped_workflows: runs.length, blocked_actions: actions.length, cancelled_no_response_tasks: tasks.length };
  await tx.run("INSERT INTO audit_logs(id,organization_id,lead_id,action_id,event_type,message,metadata_json,created_at) VALUES (?,?,NULL,NULL,?,?,?,?)",
    [markerId(receipt.id), org, EVENT, "Ambiguous sender reply stopped directly matching automated work without assigning an enquiry.", JSON.stringify(metadata), timestamp]);
  return { duplicate: false, ...metadata };
}

// Join the immutable receipt to its committed stop marker. This includes the
// actual original recipient even when the lead contact was subsequently edited.
export async function hasAmbiguousReplySinceInTransaction(tx, { organization_id, lead_id, recipient, since }) {
  assertWorkspaceTransaction(tx, organization_id);
  const rows = await tx.all("SELECT a.metadata_json FROM webhook_receipts r JOIN audit_logs a ON a.id='ambiguous_inbound_stop:' || r.id AND a.organization_id=r.organization_id AND a.event_type=? WHERE r.organization_id=? AND r.event_kind='INBOUND_MESSAGE' AND r.received_at>=? ORDER BY r.received_at DESC,r.id DESC LIMIT ?",
    [EVENT, organization_id, since, AMBIGUOUS_REPLY_LIMIT + 1]);
  for (const row of rows.slice(0, AMBIGUOUS_REPLY_LIMIT)) {
    let metadata;
    try { metadata = JSON.parse(row.metadata_json); } catch { throw failure("AMBIGUOUS_REPLY_STATE_INVALID"); }
    if (!metadata?.contact || !Array.isArray(metadata.matched_lead_ids) || metadata.matched_lead_ids.length < 2 || metadata.matched_lead_ids.length > AMBIGUOUS_REPLY_LIMIT
      || metadata.matched_lead_ids.some(id => typeof id !== "string")) throw failure("AMBIGUOUS_REPLY_STATE_INVALID");
    for (const [field, kind] of [["email", "EMAIL"], ["phone", "PHONE"]]) {
      if (metadata.contact[field] !== null && canonicalContact(kind, metadata.contact[field])?.value !== metadata.contact[field]) throw failure("AMBIGUOUS_REPLY_STATE_INVALID");
    }
    if (!metadata.contact.email && !metadata.contact.phone) throw failure("AMBIGUOUS_REPLY_STATE_INVALID");
    if (metadata.matched_lead_ids.includes(lead_id)
      || (recipient?.kind === "EMAIL" && metadata.contact.email === recipient.value)
      || (recipient?.kind === "PHONE" && metadata.contact.phone === recipient.value)) return true;
  }
  if (rows.length > AMBIGUOUS_REPLY_LIMIT) throw failure();
  return false;
}
