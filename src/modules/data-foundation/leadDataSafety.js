import { assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";
import { ContactPolicyRepository } from "../contact-policy/contactPolicyRepository.js";
import { canonicalContactsForLead } from "../contact-policy/contactPolicyContract.js";
import { WorkflowsRepository } from "../workflows/workflowsRepository.js";

export function leadDataError(code, message) { return Object.assign(new Error(message), { code, statusCode: 409 }); }
export function leadDataRevision(lead) {
  const revision = Number(lead.data_revision ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) throw leadDataError("LEAD_DATA_INVALID", "Lead data revision requires review.");
  return revision;
}
export function assertLeadActive(lead) {
  if (lead.archived_at) throw leadDataError("LEAD_ARCHIVED", "This enquiry is archived. Restore it before creating new work.");
  return lead;
}
export async function currentLeadData(db, lead, { allowArchived = false, checkRevision = true } = {}) {
  const current = await db.get("SELECT * FROM leads WHERE organization_id=? AND id=?", [lead.organization_id, lead.id]);
  if (!current) throw Object.assign(new Error("Lead not found for workspace."), { code: "LEAD_NOT_FOUND", statusCode: 404 });
  if (!allowArchived) assertLeadActive(current);
  if (checkRevision && leadDataRevision(current) !== leadDataRevision(lead)) {
    throw leadDataError("INTELLIGENCE_CONTEXT_CHANGED", "Lead data changed. Refresh and run analysis for the current facts.");
  }
  return current;
}
export function activeLeadSql(alias) {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(alias)) throw new TypeError("Invalid lead query alias.");
  return "EXISTS (SELECT 1 FROM leads active_lead WHERE active_lead.id=" + alias + ".lead_id AND active_lead.organization_id=" + alias + ".organization_id AND active_lead.archived_at IS NULL)";
}

export async function applyLeadDataSafetyInTransaction(tx, { organization_id, lead_id, before, after, change_id, kind, actor, reason, timestamp = new Date().toISOString() }) {
  assertWorkspaceTransaction(tx, organization_id);
  const result = { carried_restriction_ids: [], blocked_actions: 0, cancelled_follow_ups: 0, stopped_workflows: 0 };
  if (kind === "RESTORE") return result;
  if (!["CORRECT", "ARCHIVE"].includes(kind)) throw new TypeError("Invalid lead data change kind.");
  const lead = await tx.get("SELECT * FROM leads WHERE organization_id=? AND id=?", [organization_id, lead_id]);
  if (!lead || leadDataRevision(lead) !== before.data_revision || after.data_revision !== before.data_revision + 1) throw leadDataError("LEAD_DATA_STALE", "Lead data changed before safety effects.");
  const counts = await Promise.all([
    tx.get("SELECT COUNT(*) n FROM actions WHERE organization_id=? AND lead_id=? AND status IN ('PLANNED','AWAITING_APPROVAL','APPROVED','RETRYING')", [organization_id, lead_id]),
    tx.get("SELECT COUNT(*) n FROM workflow_runs WHERE organization_id=? AND lead_id=? AND status IN ('ACTIVE','WAITING','WAITING_APPROVAL','WAITING_EXECUTION')", [organization_id, lead_id]),
    tx.get("SELECT COUNT(*) n FROM follow_up_tasks WHERE organization_id=? AND lead_id=? AND status IN ('PLANNED','DUE')", [organization_id, lead_id])
  ]);
  if (counts.reduce((total, row) => total + Number(row.n), 0) > 10000) throw leadDataError("LEAD_DATA_WORK_LIMIT", "Open work exceeds the reviewed change limit.");
  if (kind === "CORRECT") {
    const repository = new ContactPolicyRepository(tx);
    const old = await repository.restrictionsFor(organization_id, canonicalContactsForLead(lead), "ALL");
    if (old.length > 10000) throw leadDataError("LEAD_DATA_REVIEW_LIMIT", "Restriction history exceeds the reviewed change limit.");
    for (const restriction of old.filter(row => row.contact_kind !== "LEAD")) {
      const carried = await repository.append({ organization_id, lead_id, channel: restriction.channel,
        reason: restriction.reason, source: restriction.source,
        source_event_id: "lead-data:" + change_id + ":" + restriction.id,
        actor_id: actor.id, effective_at: restriction.effective_at }, { kind: "LEAD", value: lead_id });
      result.carried_restriction_ids.push(carried.restriction.id);
    }
  }
  const code = kind === "ARCHIVE" ? "LEAD_ARCHIVED" : "LEAD_DATA_CHANGED";
  // Preserve ambiguous/authorized execution facts even if an old coarse status is inconsistent.
  result.blocked_actions = (await tx.run("UPDATE actions SET status='BLOCKED',execution_hold_reason=?,next_attempt_at=NULL,last_error=?,updated_at=? WHERE organization_id=? AND lead_id=? AND status IN ('PLANNED','AWAITING_APPROVAL','APPROVED','RETRYING') AND NOT EXISTS (SELECT 1 FROM action_executions execution WHERE execution.action_id=actions.id AND (execution.outcome_class IS NULL OR execution.outcome_class NOT IN ('RETRYABLE_FAILURE','PERMANENT_FAILURE')))", [code, reason, timestamp, organization_id, lead_id])).changes;
  const runs = await tx.all("SELECT * FROM workflow_runs WHERE organization_id=? AND lead_id=? AND status IN ('ACTIVE','WAITING','WAITING_APPROVAL','WAITING_EXECUTION')", [organization_id, lead_id]);
  const workflows = new WorkflowsRepository(tx);
  for (const run of runs) await workflows.advanceRun(run, { status: "STOPPED", next_run_at: null, stop_reason: code }, timestamp);
  result.stopped_workflows = runs.length;
  const automatic = kind === "CORRECT" ? " AND action_id IS NOT NULL AND idempotency_key='action:' || action_id || ':no-response-follow-up:v1'" : "";
  result.cancelled_follow_ups = (await tx.run("UPDATE follow_up_tasks SET status='CANCELLED',updated_at=? WHERE organization_id=? AND lead_id=? AND status IN ('PLANNED','DUE')" + automatic, [timestamp, organization_id, lead_id])).changes;
  return result;
}
