import { NEXT_BEST_ACTION_TYPES } from "../next-best-action/nextBestActionContract.js";

export class LlmActionPlanner {
  constructor(llmProvider) {
    this.llm = llmProvider;
  }

  async plan({ intelligenceRecommendation, policyDecision }) {
    const recStep = intelligenceRecommendation.recommendation?.step;
    const actionType = validActionType(recStep);

    const messages = [
      {
        role: "system",
        content: `You are an action planner for a sales automation platform. Given an intelligence recommendation and policy decision, produce a clear action plan.

Return JSON:
{
  "title": "short action title (5-10 words, specific to the lead's situation)",
  "rationale": "2-3 sentence rationale explaining WHY this action is the right next step, referencing the intelligence findings"
}

Action type being planned: ${actionType}
Policy decision: ${policyDecision.decision}

Make the title specific and actionable. The rationale should reference evidence from the intelligence.`
      },
      {
        role: "user",
        content: JSON.stringify({
          recommendation_step: recStep,
          recommendation_reason: intelligenceRecommendation.recommendation?.reason,
          priority: intelligenceRecommendation.priority,
          segment: intelligenceRecommendation.segment,
          personalization: intelligenceRecommendation.personalization_context,
          policy_decision: policyDecision.decision,
          policy_reasons: policyDecision.reasons,
        })
      }
    ];

    try {
      const result = await this.llm.jsonCompletion({ messages, maxTokens: 512 });
      return {
        action_type: actionType,
        title: result.title || fallbackTitle(actionType),
        rationale: result.rationale || intelligenceRecommendation.recommendation?.reason || "AI-generated action plan.",
        policy_decision: { decision: policyDecision.decision, reasons: policyDecision.reasons },
        approval: policyDecision.approval,
        decision_evidence_refs: intelligenceRecommendation.evidence_refs || [],
        execution_contract: {
          executable: false,
          reason: "Plan created. Execution and approval handled by outbound automation.",
          future_action_type: actionType,
        }
      };
    } catch (err) {
      console.error("LLM action planner failed, falling back to deterministic:", err.message);
      return {
        action_type: actionType,
        title: fallbackTitle(actionType),
        rationale: intelligenceRecommendation.recommendation?.reason || "Next step derived from Lead Intelligence.",
        policy_decision: { decision: policyDecision.decision, reasons: policyDecision.reasons },
        approval: policyDecision.approval,
        decision_evidence_refs: intelligenceRecommendation.evidence_refs || [],
        execution_contract: {
          executable: false,
          reason: "Plan created. Execution and approval handled by outbound automation.",
          future_action_type: actionType,
        }
      };
    }
  }
}

function validActionType(step) {
  const supported = Object.values(NEXT_BEST_ACTION_TYPES);
  return supported.includes(step) ? step : NEXT_BEST_ACTION_TYPES.REVIEW_LEAD_INTELLIGENCE;
}

function fallbackTitle(actionType) {
  return {
    GATHER_MORE_DATA: "Gather more lead data",
    REVIEW_DUPLICATE_CANDIDATE: "Review duplicate candidate",
    REVIEW_LEAD_INTELLIGENCE: "Review Lead Intelligence",
    PREPARE_OUTBOUND_REVIEW: "Prepare outbound review",
  }[actionType] || "Review Lead Intelligence";
}
