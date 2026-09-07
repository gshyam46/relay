import { NEXT_BEST_ACTION_TYPES } from "./nextBestActionContract.js";

export class ActionPlanner {
  plan({ intelligenceRecommendation, policyDecision }) {
    const actionType = actionTypeFor(intelligenceRecommendation.recommendation?.step);
    return {
      action_type: actionType,
      title: titleFor(actionType),
      rationale: intelligenceRecommendation.recommendation?.reason || "Next step is derived from Lead Intelligence.",
      policy_decision: {
        decision: policyDecision.decision,
        reasons: policyDecision.reasons
      },
      approval: policyDecision.approval,
      decision_evidence_refs: intelligenceRecommendation.evidence_refs || [],
      execution_contract: {
        executable: false,
        reason: "M3 creates a policy-checked plan only. M4/M5 own execution and approval workflows.",
        future_action_type: actionType
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
