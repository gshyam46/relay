import { parseFreshnessAssessment } from "../lead-intelligence/freshnessContract.js";
import { CLAIM_FIELDS } from "../lead-intelligence/intelligenceContract.js";

export const GROUNDING_VERSION = "l1-extractive-grounding-v1";
const fields = new Set(Object.values(CLAIM_FIELDS));
const confidenceLevels = new Set(["LOW", "MEDIUM", "HIGH"]);

// This catches explicit instruction-shaped data; it is not a semantic injection
// detector. The actual trust boundary is exact selection and app-owned rendering.
export function isUnsafeSourceText(value) {
  return typeof value !== "string" || !value.trim() || value.length > 500 ||
    /[\u0000-\u001f\u007f<>]/u.test(value) ||
    /\b(ignore|override|disregard)\b.{0,60}\b(instructions?|rules?|prompts?|previous|above)\b/i.test(value) ||
    /\b(system prompt|developer message|assistant message|reveal secrets?|api[_ -]?key|execute code)\b/i.test(value);
}

function refuse(reason) {
  throw new Error("Grounding input rejected: " + reason + ". Review the source data.");
}

function owns(record, lead, snapshotId = null) {
  return record && record.organization_id === lead.organization_id && record.lead_id === lead.id &&
    (!snapshotId || record.snapshot_id === snapshotId);
}

export function buildGroundedContext({ lead, snapshot, researchEvidenceItems = [] }) {
  if (!lead?.id || !lead.organization_id || !snapshot?.id || !owns(snapshot, lead) || snapshot.status !== "READY") {
    refuse("snapshot context");
  }
  if (!Array.isArray(snapshot.claims) || !Array.isArray(snapshot.evidence) ||
      !Array.isArray(researchEvidenceItems) || snapshot.claims.length > 100 ||
      snapshot.evidence.length > 200 || researchEvidenceItems.length > 100) {
    refuse("input bounds");
  }

  const freshness = parseFreshnessAssessment(snapshot.freshness);
  const factFields = { ENQUIRY_INTEREST: "interest", ENQUIRY_LOCATION: "location", ENQUIRY_BUDGET: "budget", ENQUIRY_TIMELINE: "timeline", ENQUIRY_DATE: "enquiry_date", ENQUIRY_LAST_INTERACTION: "last_interaction" };
  const researchFreshness = new Map((freshness?.research || []).map(item => [item.id, item]));
  const evidence = new Map();
  for (const item of snapshot.evidence) {
    if (!owns(item, lead, snapshot.id) || !item.id || evidence.has(item.id)) refuse("evidence ownership");
    evidence.set(item.id, item);
  }
  const findings = [];
  for (const claim of snapshot.claims) {
    if (!owns(claim, lead, snapshot.id) || !fields.has(claim.field) || isUnsafeSourceText(claim.value) ||
        !confidenceLevels.has(claim.confidence) || !Array.isArray(claim.evidence_ids) || !claim.evidence_ids.length) {
      refuse("claim context or value");
    }
    const refs = [];
    for (const id of claim.evidence_ids) {
      const item = evidence.get(id);
      if (!item || item.claim_field !== claim.field || item.claim_value !== claim.value) refuse("claim evidence mismatch");
      refs.push("snapshot_evidence:" + id);
    }
    if (freshness?.policy_version && factFields[claim.field] && !freshness.facts[factFields[claim.field]].usable) continue;
    findings.push({
      field: claim.field, value: claim.value, source: "CURRENT_INTELLIGENCE_SNAPSHOT",
      confidence: claim.confidence, evidence_refs: [...new Set(refs)].sort()
    });
  }
  const seenResearch = new Set();
  for (const item of researchEvidenceItems) {
    if (!owns(item, lead) || !item.id || seenResearch.has(item.id) || !fields.has(item.claim_field) ||
        isUnsafeSourceText(item.claim_value) || !confidenceLevels.has(item.confidence)) {
      refuse("research context or value");
    }
    seenResearch.add(item.id);
    if (freshness?.policy_version) {
      const assessment = researchFreshness.get(item.id);
      if (!assessment || assessment.ingestion_id !== item.ingestion_id || assessment.field !== item.claim_field) refuse("research freshness authority");
      if (!assessment.usable) continue;
    }
    findings.push({
      field: item.claim_field, value: item.claim_value, source: "APPROVED_RESEARCH_EVIDENCE",
      confidence: item.confidence, evidence_refs: ["research_evidence:" + item.id]
    });
  }
  if (!findings.length) refuse("no usable evidence");

  const valuesByField = new Map();
  for (const finding of findings) {
    const values = valuesByField.get(finding.field) || new Set();
    values.add(finding.value);
    valuesByField.set(finding.field, values);
  }
  const conflicts = [...valuesByField].filter(([, values]) => values.size > 1).map(([field]) => field);
  const stale = [
    ["LEAD_NAME", lead.name],
    ["COMPANY_NAME", lead.company],
    ["CONTACT_EMAIL", lead.normalized_email || lead.email],
    ["CONTACT_PHONE", lead.normalized_phone || lead.phone],
    ["LEAD_SOURCE", lead.source]
  ].some(([field, value]) => {
    const stored = findings.filter((finding) => finding.source === "CURRENT_INTELLIGENCE_SNAPSHOT" && finding.field === field);
    return stored.some((finding) => finding.value !== value) || (value && !stored.length);
  });

  const contextReview = snapshot.evidence.some(item => item.metadata?.context_review_required === true);
  const freshnessIssues = freshness?.policy_version ? freshness.review_reasons.flatMap(item => item.fields.map(field => item.code + ":" + field)) : [];
  const freshnessReview = freshness?.policy_version && [...Object.values(freshness.facts), ...freshness.research].some(item => !item.usable && item.reasons.some(reason => reason !== "UNKNOWN_FACT" || freshness.current_revisions.enquiry_revision));
  return { findings, conflicts, stale, freshnessIssues, lowConfidence: contextReview || freshnessReview || findings.some((finding) => finding.confidence === "LOW"), evidenceRefs: refsFor(findings) };
}

export function validateSelection(result, context) {
  if (!result || Array.isArray(result) || typeof result !== "object" ||
      Object.keys(result).length !== 1 || !Object.hasOwn(result, "selected_claims") ||
      !Array.isArray(result.selected_claims) || result.selected_claims.length > 8) {
    throw new Error("MODEL_OUTPUT_REJECTED");
  }
  const selected = [];
  for (const item of result.selected_claims) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        Object.keys(item).sort().join(",") !== "evidence_refs,field,value" ||
        !Array.isArray(item.evidence_refs) || !item.evidence_refs.length ||
        item.evidence_refs.length > 20 || new Set(item.evidence_refs).size !== item.evidence_refs.length) {
      throw new Error("MODEL_OUTPUT_REJECTED");
    }
    const match = context.findings.find((finding) =>
      finding.field === item.field && finding.value === item.value &&
      item.evidence_refs.every((ref) => finding.evidence_refs.includes(ref))
    );
    if (!match || context.conflicts.includes(item.field) || selected.some((finding) => finding.field === item.field)) throw new Error("MODEL_OUTPUT_REJECTED");
    selected.push({ ...match, evidence_refs: [...item.evidence_refs].sort() });
  }
  return selected;
}

export function refsFor(findings) {
  return [...new Set(findings.flatMap((finding) => finding.evidence_refs))].sort();
}

export function renderGroundedSynthesis({ lead, context, selected, mode, reason = null }) {
  selected = selected.filter(item => !context.conflicts.includes(item.field));
  const review = Boolean(reason) || context.conflicts.length > 0 || context.stale || context.lowConfidence ||
    lead.status === "OPTED_OUT" || lead.status === "SUPPRESSED" ||
    context.findings.some((finding) => finding.source === "APPROVED_RESEARCH_EVIDENCE");
  const available = new Set(context.findings.map((finding) => finding.field));
  const missing = [];
  if (!available.has("LEAD_NAME")) missing.push("Lead name");
  if (!available.has("CONTACT_EMAIL") && !available.has("CONTACT_PHONE")) missing.push("Contact information");
  if (!available.has("COMPANY_NAME")) missing.push("Company");
  const outcome = review ? "NEEDS_REVIEW" : missing.length ? "NEEDS_MORE_DATA" : "READY_FOR_DEEPER_INTELLIGENCE";
  const recommendation = outcome === "NEEDS_REVIEW" ? "REVIEW_LEAD_INTELLIGENCE" :
    outcome === "NEEDS_MORE_DATA" ? "GATHER_MORE_DATA" : "READY_FOR_DEEPER_INTELLIGENCE";
  const prefix = mode === "DETERMINISTIC_FALLBACK"
    ? "Deterministic fallback: generated output was not used. Human review is required."
    : "Extractive summary of recorded source values.";
  const summary = selected.map((finding) => finding.field + ": " + JSON.stringify(finding.value) + ".");
  return {
    summary: {
      text: [prefix, ...summary, "Source extraction does not decide business fit, buying intent or contact permission. Review the separate configured criteria and contact policy."].join(" "),
      evidence_refs: refsFor(selected),
      claims: selected.map(({ field, value, evidence_refs }) => ({ field, value, evidence_refs, kind: "RECORDED_VALUE" })),
      generation: { mode, reason, grounding_version: GROUNDING_VERSION }
    },
    findings: context.findings,
    qualification: {
      outcome,
      reasons: [review
        ? "Review source context and safety flags before using these recorded values."
        : missing.length
          ? "Identity, contact or company data is missing."
          : "Recorded identity, contact and company data are available for further review; this does not establish buying intent."],
      missing, evidence_refs: context.evidenceRefs,
      review_flags: [...context.conflicts.map((field) => "CONFLICT:" + field), ...(context.freshnessIssues || []),
        ...(context.stale ? ["STALE_SNAPSHOT"] : []), ...(context.lowConfidence ? ["LOW_CONFIDENCE_SOURCE"] : []), ...(reason ? [reason] : []),
        ...(["OPTED_OUT", "SUPPRESSED"].includes(lead.status) ? ["CONTACT_RESTRICTED"] : [])]
    },
    recommendation: {
      type: recommendation,
      reason: review ? "Human review is required. This assessment does not authorize contact." :
        missing.length ? "Collect missing data before further assessment." : "Review business relevance separately before considering any outreach.",
      evidence_refs: context.evidenceRefs
    }
  };
}
