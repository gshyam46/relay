import { QUALIFICATION_OUTCOMES, SYNTHESIS_RECOMMENDATION_TYPES } from "./synthesisContract.js";

export class LocalSynthesisAgent {
  synthesize({ lead, snapshot, researchEvidenceItems = [] }) {
    const snapshotFindings = findingsFromSnapshot(snapshot);
    const researchFindings = researchEvidenceItems.map((item) => ({
      field: item.claim_field,
      value: item.claim_value,
      source: "APPROVED_RESEARCH_EVIDENCE",
      confidence: item.confidence,
      evidence_refs: [`research_evidence:${item.id}`]
    }));
    const findings = [...snapshotFindings, ...researchFindings];
    const evidenceRefs = evidenceRefsFor(findings);
    const qualification = qualificationFor({ snapshot, researchEvidenceItems, evidenceRefs });
    const recommendation = recommendationFor({ qualification, evidenceRefs });

    return {
      summary: {
        text: summaryTextFor({ lead, snapshot, researchEvidenceItems }),
        evidence_refs: evidenceRefs
      },
      findings,
      qualification,
      recommendation
    };
  }
}

function findingsFromSnapshot(snapshot) {
  return (snapshot.claims || []).map((claim) => ({
    field: claim.field,
    value: String(claim.value),
    source: "CURRENT_INTELLIGENCE_SNAPSHOT",
    confidence: claim.confidence,
    evidence_refs: (claim.evidence_ids || []).map((id) => `snapshot_evidence:${id}`)
  }));
}

function evidenceRefsFor(findings) {
  return Array.from(new Set(findings.flatMap((finding) => finding.evidence_refs || []))).sort();
}

function qualificationFor({ snapshot, researchEvidenceItems, evidenceRefs }) {
  if (snapshot.readiness_status === "NEEDS_MORE_DATA") {
    return {
      outcome: QUALIFICATION_OUTCOMES.NEEDS_MORE_DATA,
      reasons: ["The current Lead Data Foundation does not yet contain enough usable contact or identity data."],
      missing: snapshot.qualification?.reasons || [],
      evidence_refs: evidenceRefs
    };
  }

  if (researchEvidenceItems.length > 0) {
    return {
      outcome: QUALIFICATION_OUTCOMES.NEEDS_REVIEW,
      reasons: ["Approved research evidence is available and should be reviewed before deeper Lead Intelligence decisions."],
      missing: [],
      evidence_refs: evidenceRefs
    };
  }

  return {
    outcome: QUALIFICATION_OUTCOMES.READY_FOR_DEEPER_INTELLIGENCE,
    reasons: ["The current evidence-backed foundation is ready for deeper Lead Intelligence processing."],
    missing: [],
    evidence_refs: evidenceRefs
  };
}

function recommendationFor({ qualification, evidenceRefs }) {
  if (qualification.outcome === QUALIFICATION_OUTCOMES.NEEDS_MORE_DATA) {
    return {
      type: SYNTHESIS_RECOMMENDATION_TYPES.GATHER_MORE_DATA,
      reason: "Add missing lead identity or contact data before deeper intelligence processing.",
      evidence_refs: evidenceRefs
    };
  }
  if (qualification.outcome === QUALIFICATION_OUTCOMES.NEEDS_REVIEW) {
    return {
      type: SYNTHESIS_RECOMMENDATION_TYPES.REVIEW_LEAD_INTELLIGENCE,
      reason: "Review the staged evidence-backed synthesis before using it for downstream recommendations.",
      evidence_refs: evidenceRefs
    };
  }
  return {
    type: SYNTHESIS_RECOMMENDATION_TYPES.READY_FOR_DEEPER_INTELLIGENCE,
    reason: "The lead has enough evidence-backed foundation data to proceed to deeper Lead Intelligence.",
    evidence_refs: evidenceRefs
  };
}

function summaryTextFor({ lead, snapshot, researchEvidenceItems }) {
  const identity = lead.company || lead.name || lead.email || lead.normalized_phone || "this lead";
  const researchText =
    researchEvidenceItems.length > 0
      ? ` It also includes ${researchEvidenceItems.length} staged approved research evidence item(s).`
      : "";
  return `Lead Intelligence synthesis for ${identity} is based on the current persisted intelligence snapshot.${researchText}`;
}
