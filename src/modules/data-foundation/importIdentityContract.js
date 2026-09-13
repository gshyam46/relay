import { importError, importFingerprint, importText } from "./reviewedImportContract.js";
export const IDENTITY_EXISTING_LIMIT = 50, IDENTITY_ROW_LIMIT = 20, IDENTITY_SCAN_LIMIT = 5000, IDENTITY_SOURCE_LIMIT = 100;
export { importFingerprint as identityFingerprint };
export function identityInput(input, resolve = false) {
  const allowed = ["organization_id", "import_id", "import_row_id", "actor", ...(resolve ? ["review_token", "decision", "classification", "target_lead_id", "reason"] : [])];
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) throw importError("IDENTITY_INVALID_INPUT", "Supply only the documented identity review fields.");
  const result = Object.fromEntries(["organization_id", "import_id", "import_row_id"].map(key => [key, importText(input[key], key)]));
  if (!input.actor || input.actor.role !== "OWNER") throw importError("IMPORT_OWNER_REQUIRED", "A current workspace owner is required.", 403);
  result.owner = importText(input.actor.id, "actor.id");
  if (!resolve) return result;
  if (typeof input.review_token !== "string" || !/^[a-f0-9]{64}$/.test(input.review_token)) throw importError("IDENTITY_INVALID_INPUT", "Supply the exact identity review token.");
  if (!["LINK_EXISTING", "CREATE_SEPARATE"].includes(input.decision)) throw importError("IDENTITY_INVALID_INPUT", "Choose an explicit identity decision.");
  if ((input.decision === "LINK_EXISTING" && input.classification !== "SAME_ENQUIRY") || (input.decision === "CREATE_SEPARATE" && !["REPEATED_ENQUIRY", "SHARED_CONTACT", "DISTINCT_ENQUIRY"].includes(input.classification))) throw importError("IDENTITY_INVALID_INPUT", "Classification must match the identity decision.");
  const target = input.decision === "LINK_EXISTING" ? importText(input.target_lead_id, "target_lead_id") : null;
  if (input.decision === "CREATE_SEPARATE" && input.target_lead_id !== null) throw importError("IDENTITY_INVALID_INPUT", "A separate enquiry requires a null target.");
  return { ...result, review_token: input.review_token, decision: input.decision, classification: input.classification, target_lead_id: target, reason: importText(input.reason, "reason", 2000) };
}
export async function requireIdentityOwner(tx, org, owner) {
  const user = await tx.get("SELECT id FROM users WHERE organization_id=? AND id=? AND role='OWNER'", [org, owner]);
  if (!user) throw importError("IMPORT_OWNER_REQUIRED", "A current workspace owner is required.", 403);
}
export function identityUnavailable(batch, row, resolved = false) {
  if (resolved) return "IDENTITY_ALREADY_RESOLVED";
  if (batch.contract_version !== 2) return "IDENTITY_REVIEWED_IMPORT_REQUIRED";
  if (row.validation_state !== "VALID") return "IDENTITY_ROW_INVALID";
  if (["COMMITTING", "FAILED"].includes(batch.state)) return "IDENTITY_RESUME_IMPORT_FIRST";
  if (row.committed || row.created_lead_id || row.commit_state === "COMMITTED") return "IDENTITY_ROW_ALREADY_COMMITTED";
  if (row.commit_state === "HELD" && row.selected && batch.state === "COMMITTED") return null;
  if (row.commit_state === "PENDING" && !row.selected && (batch.state === "COMMITTED" || (batch.state === "READY_TO_COMMIT" && !batch.frozen_selection_json))) return null;
  return "IDENTITY_ROW_UNAVAILABLE";
}
export function publicIdentityLead(lead) {
  const short = value => typeof value === "string" ? value.slice(0, 4096) : null;
  return { id: lead.id, name: short(lead.name), email: short(lead.email), phone: short(lead.phone), normalized_email: short(lead.normalized_email), normalized_phone: short(lead.normalized_phone), company: short(lead.company), status: lead.status, data_revision: Number(lead.data_revision || 0), archived_at: lead.archived_at || null };
}
export function serializeIdentityResolution(row, { withSnapshot = false } = {}) {
  if (!row) return null;
  const { id, import_id, import_row_id, review_revision, decision, classification, target_lead_id, lead_id, event_id, reason, created_at, created_by } = row;
  if (!withSnapshot) return { id, import_id, import_row_id, review_revision, decision, classification, target_lead_id, lead_id, event_id, reason, created_at, created_by };
  let review_snapshot;
  try { review_snapshot = JSON.parse(row.review_snapshot_json); } catch { throw importError("IDENTITY_STATE_INVALID", "Saved identity review requires operational review.", 503); }
  return { id, import_id, import_row_id, review_revision, decision, classification, target_lead_id, lead_id, event_id, reason, created_at, created_by, review_snapshot };
}
export function identitySummary(rows) {
  return { linked_rows: rows.filter(row => row.identity_resolution?.decision === "LINK_EXISTING").length,
    created_rows: rows.filter(row => row.identity_resolution?.decision === "CREATE_SEPARATE").length,
    resolved_held_rows: rows.filter(row => row.identity_resolution && row.commit_state === "HELD").length,
    unresolved_duplicate_rows: rows.filter(row => !row.identity_resolution && !row.committed && (row.commit_state === "HELD" || row.duplicate_candidates.length > 0)).length };
}
