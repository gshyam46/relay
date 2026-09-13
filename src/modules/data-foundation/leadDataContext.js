import { emptyLeadFieldProvenance, leadDataSnapshot, leadDataError, LEAD_DATA_FIELDS } from "./leadDataContract.js";
export async function loadLeadDataContext(db, { organization_id, lead_id }) {
  const lead = await db.get("SELECT name,email,phone,company,normalized_email,normalized_phone,data_revision,archived_at FROM leads WHERE organization_id=? AND id=?", [organization_id, lead_id]);
  if (!lead) throw leadDataError("LEAD_DATA_NOT_FOUND", "Lead not found in this workspace.", 404);
  const current = leadDataSnapshot(lead);
  if (!current.data_revision) return current;
  const change = await db.get("SELECT id,revision,after_json FROM lead_data_changes WHERE organization_id=? AND lead_id=? AND revision=?", [organization_id, lead_id, current.data_revision]);
  try {
    if (!change) throw new Error();
    const snapshot = JSON.parse(change.after_json);
    if (snapshot.data_revision !== current.data_revision || snapshot.archived_at !== current.archived_at || LEAD_DATA_FIELDS.some(field => snapshot.values[field] !== current.values[field]) || snapshot.normalized_values.normalized_email !== current.normalized_values.normalized_email || snapshot.normalized_values.normalized_phone !== current.normalized_values.normalized_phone) throw new Error();
    const provenance = snapshot.field_provenance || emptyLeadFieldProvenance();
    for (const field of LEAD_DATA_FIELDS) {
      const origin = provenance[field];
      if (origin !== null && (!origin || origin.source_type !== "LEAD_DATA_CHANGE" || typeof origin.change_id !== "string" || !Number.isInteger(origin.revision) || origin.revision < 1 || origin.revision > current.data_revision || typeof origin.created_by !== "string" || typeof origin.created_at !== "string")) throw new Error();
    }
    return { ...current, field_provenance: provenance };
  } catch { throw leadDataError("LEAD_DATA_STATE_INVALID", "Saved current data history requires operational review.", 503); }
}
