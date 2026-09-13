import { parseBusinessFit } from "./businessFit.js";
import { buildGroundedContext, GROUNDING_VERSION, renderGroundedSynthesis } from "../ai/grounding.js";

const FIT_REVIEW_REASON = "Review the separately recorded business criteria assessment before preparing outreach.";
const segments = {
  NEEDS_DATA: ["Needs more data", "GATHER_MORE_DATA", "Gather more data", 10, 35],
  DUPLICATE_CANDIDATE: ["Duplicate candidate", "REVIEW_DUPLICATE_CANDIDATE", "Review duplicate candidate", 45, 55],
  NEEDS_INTELLIGENCE_REVIEW: ["Needs intelligence review", "REVIEW_LEAD_INTELLIGENCE", "Review Lead Intelligence", 60, 70],
  READY_FOR_OUTBOUND_REVIEW: ["Ready for outbound review", "PREPARE_OUTBOUND_REVIEW", "Prepare outbound review", 70, 85]
};

export class LocalRecommendationAgent {
  recommend({ lead, snapshot, synthesis }) {
    if (!synthesis || synthesis.organization_id !== lead.organization_id || synthesis.lead_id !== lead.id ||
        synthesis.snapshot_id !== snapshot.id) {
      throw new Error("Grounding input rejected: synthesis context. Review the source data.");
    }
    const context = buildGroundedContext({ lead, snapshot });
    const assessment = renderGroundedSynthesis({
      lead, context, selected: [], mode: "DETERMINISTIC_EXTRACTIVE",
      reason: synthesis.qualification?.outcome === "NEEDS_REVIEW" ? "SYNTHESIS_REVIEW_REQUIRED" : null
    });
    const refs = context.evidenceRefs;
    const signals = snapshot.signals || [];
    if (!Array.isArray(signals) || signals.some((signal) =>
      signal.organization_id !== lead.organization_id || signal.lead_id !== lead.id || signal.snapshot_id !== snapshot.id ||
      !Array.isArray(signal.evidence_ids) || signal.evidence_ids.some((id) => !refs.includes("snapshot_evidence:" + id))
    )) {
      throw new Error("Grounding input rejected: signal context. Review the source data.");
    }
    const outcome = assessment.qualification.outcome;
    const baselineType = outcome === "NEEDS_MORE_DATA" ? "NEEDS_DATA" :
      signals.some((signal) => signal.type === "DUPLICATE_WARNING") ? "DUPLICATE_CANDIDATE" :
      outcome === "NEEDS_REVIEW" ? "NEEDS_INTELLIGENCE_REVIEW" : "READY_FOR_OUTBOUND_REVIEW";
    const businessFit = parseBusinessFit(snapshot.business_fit);
    const fitBlocksPreparation = baselineType === "READY_FOR_OUTBOUND_REVIEW" && ["DOES_NOT_MATCH", "NEEDS_REVIEW"].includes(businessFit?.status);
    const type = fitBlocksPreparation ? "NEEDS_INTELLIGENCE_REVIEW" : baselineType;
    const [label, step, stepLabel] = segments[type];
    // Preserve the legacy processing-attention number; fit has its own assessment and ordering.
    const [, , , floor, cap] = segments[baselineType];
    const base = Number.isInteger(snapshot.readiness_score) ? snapshot.readiness_score : 0;
    const score = Math.min(cap, Math.max(floor, base + Math.min(refs.length, 5)));
    const labels = { LEAD_NAME: "Lead name", COMPANY_NAME: "Company", CONTACT_EMAIL: "Contact", CONTACT_PHONE: "Contact", LEAD_SOURCE: "Source" };
    const personalization = context.stale || context.conflicts.length || context.lowConfidence ? [] :
      context.findings.filter((finding) => labels[finding.field]).map((finding) => ({
        label: labels[finding.field], value: finding.value, evidence_refs: finding.evidence_refs, kind: "RECORDED_VALUE"
      }));
    return {
      priority: {
        score, label: score >= 75 ? "High attention" : score >= 50 ? "Medium attention" : "Low attention",
        reason: "Deterministic attention score uses data readiness and review needs, not buying intent or business fit.",
        evidence_refs: refs, generation: { mode: "DETERMINISTIC_EXTRACTIVE", grounding_version: GROUNDING_VERSION }
      },
      segment: {
        type, label, evidence_refs: refs,
        reason: fitBlocksPreparation ? FIT_REVIEW_REASON : type === "READY_FOR_OUTBOUND_REVIEW" ?
          "Recorded identity, contact and company data permit preparation for human review; contact permission is assessed separately." :
          "Missing data, duplicate warnings or source uncertainty require the indicated review step."
      },
      personalization_context: personalization,
      recommendation: {
        step, label: stepLabel, evidence_refs: refs,
        reason: fitBlocksPreparation ? FIT_REVIEW_REASON : type === "READY_FOR_OUTBOUND_REVIEW" ?
          "Prepare a policy-checked outbound review. This recommendation does not authorize sending." :
          "Complete the indicated data or intelligence review before preparing outbound activity."
      }
    };
  }
}
