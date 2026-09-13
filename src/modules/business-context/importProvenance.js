import { assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";
import { ENQUIRY_FIELDS, contextError, normalizeEnquiry } from "./businessContextContract.js";

export function bindImportEnquiry(enquiry, { import_id, import_row_id }) {
  const normalized = normalizeEnquiry(enquiry);
  for (const field of ENQUIRY_FIELDS) {
    const fact = normalized[field];
    const assertions = fact.state === "KNOWN" ? [fact] : fact.state === "CONFLICTED" ? fact.alternatives : [];
    for (const item of assertions) item.provenance = { assertion: item.provenance.assertion, source_type: "IMPORT_ROW", source_reference: "import_row:" + import_row_id,
      observed_at: item.provenance.observed_at, import_id, import_row_id, field };
  }
  return normalizeEnquiry(normalized);
}

// Schema validation alone cannot authorize a citation. Its original committed row
// or immutable resolution must associate this lead with the exact reviewed source.
export async function validateImportedEnquiryProvenance(tx, { organization_id, lead_id, enquiry }) {
  assertWorkspaceTransaction(tx, organization_id);
  const rows = new Map();
  for (const field of ENQUIRY_FIELDS) {
    const fact = enquiry[field];
    const assertions = fact.state === "KNOWN" ? [fact] : fact.state === "CONFLICTED" ? fact.alternatives : [];
    for (const item of assertions) {
      const source = item.provenance;
      if (source.source_type !== "IMPORT_ROW") continue;
      if (source.field !== field) invalid();
      const key = source.import_id + ":" + source.import_row_id;
      if (!rows.has(key)) {
        const row = await tx.get("SELECT r.normalized_values_json FROM import_rows r JOIN leads l ON l.id=r.created_lead_id AND l.organization_id=r.organization_id " +
          "WHERE r.organization_id=? AND r.import_id=? AND r.id=? AND r.committed=1 AND r.created_lead_id=? AND l.import_batch_id=r.import_id AND l.import_row_id=r.id",
          [organization_id, source.import_id, source.import_row_id, lead_id]);
        const resolution = row ? null : await tx.get("SELECT x.review_snapshot_json FROM import_identity_resolutions x " +
          "JOIN import_rows r ON r.organization_id=x.organization_id AND r.import_id=x.import_id AND r.id=x.import_row_id " +
          "JOIN leads l ON l.organization_id=x.organization_id AND l.id=x.lead_id " +
          "WHERE x.organization_id=? AND x.import_id=? AND x.import_row_id=? AND x.lead_id=?",
          [organization_id, source.import_id, source.import_row_id, lead_id]);
        if (!row && !resolution) invalid();
        try { rows.set(key, normalizeEnquiry(row ? JSON.parse(row.normalized_values_json).enquiry
          : JSON.parse(resolution.review_snapshot_json).normalized_values.enquiry)); }
        catch { throw contextError("IMPORT_SOURCE_INVALID", "Saved import source requires operational review.", 503); }
      }
      const expected = rows.get(key)[field];
      if (expected.state !== "KNOWN" || JSON.stringify(expected.value) !== JSON.stringify(item.value) || JSON.stringify(expected.provenance) !== JSON.stringify(source)) invalid();
    }
  }
}
function invalid() { throw contextError("INVALID_IMPORT_PROVENANCE", "Imported source must match this enquiry's associated reviewed row and exact fact. Use a manual source for a correction."); }
