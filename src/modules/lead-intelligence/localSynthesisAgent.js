import { buildGroundedContext, renderGroundedSynthesis } from "../ai/grounding.js";

export class LocalSynthesisAgent {
  synthesize(input) {
    const context = buildGroundedContext(input);
    const needsReview = context.conflicts.length || context.stale || context.lowConfidence ||
      ["OPTED_OUT", "SUPPRESSED"].includes(input.lead.status);
    return renderGroundedSynthesis({
      lead: input.lead, context, selected: needsReview ? [] : context.findings.slice(0, 8),
      mode: "DETERMINISTIC_EXTRACTIVE", reason: needsReview ? "SOURCE_REVIEW_REQUIRED" : null
    });
  }
}
