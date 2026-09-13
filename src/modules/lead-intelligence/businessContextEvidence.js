import { BUSINESS_FIT_VERSION } from "./businessFit.js";
const FIELDS = { interest: "ENQUIRY_INTEREST", location: "ENQUIRY_LOCATION", budget: "ENQUIRY_BUDGET", timeline: "ENQUIRY_TIMELINE", enquiry_date: "ENQUIRY_DATE", last_interaction: "ENQUIRY_LAST_INTERACTION" };

export function contextFingerprintPart(context) {
  const revisions = context.revisions;
  return { ...(revisions.profile_revision || revisions.enquiry_revision ? { business_context: revisions } : {}), ...(context.profile?.fit_criteria ? { business_fit_version: BUSINESS_FIT_VERSION } : {}) };
}
export function enquiryValueText(field, value) {
  if (field === "budget") return value.currency + " " + decimal(value.minimum_minor, value.scale) + (value.minimum_minor === value.maximum_minor ? "" : " to " + decimal(value.maximum_minor, value.scale));
  if (field === "location") return value.locality + (value.country_code ? ", " + value.country_code : "");
  if (field === "timeline") return value.description + (value.target_date ? " (target date: " + value.target_date + ")" : "");
  return value;
}
function decimal(digits, scale) {
  if (!scale) return digits;
  const padded = digits.padStart(scale + 1, "0");
  return padded.slice(0, -scale) + "." + padded.slice(-scale);
}
export function contextWarnings(context, freshness = null) {
  if (!context.revisions.enquiry_revision) return [];
  return Object.entries(context.enquiry.enquiry).filter(([field, fact]) => fact.state !== "KNOWN" || fact.provenance?.assertion === "INFERRED" || (freshness?.policy_version && !freshness.facts[field].usable) || enquiryValueText(field, fact.value).length > 500)
    .map(([field, fact]) => ({ field, state: fact.state, ...(freshness?.policy_version ? { freshness: freshness.facts[field].freshness, reasons: freshness.facts[field].reasons } : {}), ...(fact.provenance?.assertion === "INFERRED" ? { assertion: "INFERRED" } : {}), ...(fact.state === "KNOWN" && enquiryValueText(field, fact.value).length > 500 ? { reason: "EXTRACTION_LIMIT" } : {}) }));
}
export async function addEnquiryEvidence(repository, lead, snapshotId, context, freshness = null) {
  const records = [], claims = [];
  for (const [field, fact] of Object.entries(context.enquiry.enquiry)) {
    if (fact.state !== "KNOWN" || fact.provenance.assertion === "INFERRED" || (freshness?.policy_version && !freshness.facts[field].usable)) continue;
    const value = enquiryValueText(field, fact.value);
    // Values fit the existing bounded extractive grounding contract. Long combined values stay visible as source context.
    if (typeof value !== "string" || value.length > 500) continue;
    const evidence = await repository.createEvidence({
      organization_id: lead.organization_id, lead_id: lead.id, snapshot_id: snapshotId,
      source_type: fact.provenance.source_type === "IMPORT_ROW" ? "CSV" : "MANUAL", source_reference: fact.provenance.source_reference,
      raw_content_reference: fact.provenance.source_type === "IMPORT_ROW" ? "import_row:" + fact.provenance.import_row_id : "enquiry:" + lead.id + ":revision:" + context.revisions.enquiry_revision + ":" + field,
      claim_field: FIELDS[field], claim_value: value,
      title: fact.provenance.source_type === "IMPORT_ROW" ? (fact.provenance.assertion === "CUSTOMER_STATED" ? "Imported customer statement, reviewed by operator" : "Imported record, reviewed by operator") : fact.provenance.assertion === "CUSTOMER_STATED" ? "Operator-recorded customer statement" : "Operator-recorded observation",
      evidence_timestamp: fact.provenance.observed_at, confidence: "MEDIUM",
      metadata: { assertion: fact.provenance.assertion, source_verified: false, source_type: fact.provenance.source_type, ...(fact.provenance.source_type === "IMPORT_ROW" ? { import_id: fact.provenance.import_id, import_row_id: fact.provenance.import_row_id, field } : {}), enquiry_revision: context.revisions.enquiry_revision,
        captured_at: context.enquiry.created_at, captured_by: context.enquiry.created_by }
    });
    records.push(evidence);
    claims.push(await repository.createClaim({ organization_id: lead.organization_id, lead_id: lead.id, snapshot_id: snapshotId,
      field: FIELDS[field], value, confidence: "MEDIUM", evidence_ids: [evidence.id] }));
  }
  const needsReview = contextWarnings(context, freshness).filter(item => item.state === "CONFLICTED" || item.assertion === "INFERRED" || item.reason === "EXTRACTION_LIMIT" || (!freshness?.facts[item.field]?.usable && item.reasons?.some(reason => reason !== "UNKNOWN_FACT")));
  if (needsReview.length) records.push(await repository.createEvidence({
    organization_id: lead.organization_id, lead_id: lead.id, snapshot_id: snapshotId, source_type: "MANUAL",
    source_reference: "enquiry:" + lead.id + ":revision:" + context.revisions.enquiry_revision,
    title: "Recorded enquiry facts require review", confidence: "LOW",
    metadata: { context_review_required: true, fields: needsReview, enquiry_revision: context.revisions.enquiry_revision }
  }));
  return { records, claims };
}
