import { ActionPlanner } from "../next-best-action/actionPlanner.js";
import { GROUNDING_VERSION } from "./grounding.js";

/**
 * Free-form model titles/rationale are held until claim-level plan validation is
 * available. Policy remains app-owned; this produces the existing plan contract.
 */
export class LlmActionPlanner {
  constructor(_llmProvider) {
    this.local = new ActionPlanner();
  }

  plan({ lead, snapshot, intelligenceRecommendation, policyDecision }) {
    const output = this.local.plan({
      lead, snapshot,
      intelligenceRecommendation: {
        ...intelligenceRecommendation,
        recommendation: {
          step: intelligenceRecommendation.recommendation?.step,
          reason: "Deterministic safety mode: this plan follows the recorded recommendation and application policy. No new lead facts or promises are inferred."
        }
      },
      policyDecision
    });
    output.execution_contract.generation = {
      mode: "DETERMINISTIC_SAFETY", reason: "FREE_FORM_PLAN_DISABLED", grounding_version: GROUNDING_VERSION
    };
    return output;
  }
}
