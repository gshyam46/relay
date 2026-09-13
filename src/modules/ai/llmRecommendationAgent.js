import { LocalRecommendationAgent } from "../lead-intelligence/localRecommendationAgent.js";

/**
 * Keep configured-agent compatibility while free-form recommendations wait for
 * L3 evaluation. The default agent applies the same exact evidence boundary.
 */
export class LlmRecommendationAgent {
  constructor(_llmProvider) {
    this.local = new LocalRecommendationAgent();
  }

  recommend(input) {
    const output = this.local.recommend(input);
    output.priority.reason = "Deterministic safety mode: attention score uses data readiness, not buying intent or business fit.";
    output.priority.generation = {
      ...output.priority.generation, mode: "DETERMINISTIC_SAFETY", reason: "FREE_FORM_RECOMMENDATION_DISABLED"
    };
    return output;
  }
}
