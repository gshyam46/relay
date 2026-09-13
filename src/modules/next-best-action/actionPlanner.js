import { buildGroundedContext, GROUNDING_VERSION } from "../ai/grounding.js";
import { NEXT_BEST_ACTION_TYPES } from "./nextBestActionContract.js";

export class ActionPlanner {
  plan({ lead, snapshot, intelligenceRecommendation, policyDecision }) {
    const context = buildGroundedContext({ lead, snapshot });
    if (intelligenceRecommendation.organization_id !== lead.organization_id ||
        intelligenceRecommendation.lead_id !== lead.id || intelligenceRecommendation.snapshot_id !== snapshot.id ||
        !Array.isArray(intelligenceRecommendation.evidence_refs) || !intelligenceRecommendation.evidence_refs.length ||
        intelligenceRecommendation.evidence_refs.some((ref) => !context.evidenceRefs.includes(ref))) {
      throw new Error("Grounding input rejected: recommendation references. Review the source data.");
    }
    const actionType = actionTypeFor(intelligenceRecommendation.recommendation?.step);
    return {
      action_type: actionType,
      title: titleFor(actionType),
      rationale: "Plan follows the recorded recommendation and application policy. No new lead facts or operating promises are inferred.",
      policy_decision: {
        decision: policyDecision.decision,
        reasons: policyDecision.reasons
      },
      approval: policyDecision.approval,
      decision_evidence_refs: intelligenceRecommendation.evidence_refs || [],
      execution_contract: {
        executable: false,
        reason: "M3 creates a policy-checked plan only. M4/M5 own execution and approval workflows.",
        future_action_type: actionType,
        generation: { mode: "DETERMINISTIC_EXTRACTIVE", grounding_version: GROUNDING_VERSION }
      }
    };
  }
}

function actionTypeFor(step) {
  const supported = Object.values(NEXT_BEST_ACTION_TYPES);
  return supported.includes(step) ? step : NEXT_BEST_ACTION_TYPES.REVIEW_LEAD_INTELLIGENCE;
}

function titleFor(actionType) {
  const titles = {
    GATHER_MORE_DATA: "Gather more lead data",
    REVIEW_DUPLICATE_CANDIDATE: "Review duplicate candidate",
    REVIEW_LEAD_INTELLIGENCE: "Review Lead Intelligence",
    PREPARE_OUTBOUND_REVIEW: "Prepare outbound review"
  };
  return titles[actionType] || "Review Lead Intelligence";
}
