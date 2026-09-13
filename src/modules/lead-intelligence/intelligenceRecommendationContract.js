export const INTELLIGENCE_RECOMMENDATION_PIPELINE_VERSION = "l1.09-bounded-recommendation-v2";

export const INTELLIGENCE_RECOMMENDATION_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  READY: "READY",
  SUPERSEDED: "SUPERSEDED",
  FAILED: "FAILED"
});

export const INTELLIGENCE_SEGMENTS = Object.freeze({
  NEEDS_DATA: "NEEDS_DATA",
  DUPLICATE_CANDIDATE: "DUPLICATE_CANDIDATE",
  NEEDS_INTELLIGENCE_REVIEW: "NEEDS_INTELLIGENCE_REVIEW",
  READY_FOR_OUTBOUND_REVIEW: "READY_FOR_OUTBOUND_REVIEW"
});

export const INTELLIGENCE_RECOMMENDED_STEPS = Object.freeze({
  GATHER_MORE_DATA: "GATHER_MORE_DATA",
  REVIEW_DUPLICATE_CANDIDATE: "REVIEW_DUPLICATE_CANDIDATE",
  REVIEW_LEAD_INTELLIGENCE: "REVIEW_LEAD_INTELLIGENCE",
  PREPARE_OUTBOUND_REVIEW: "PREPARE_OUTBOUND_REVIEW"
});

export function validateIntelligenceRecommendationOutput(output) {
  const errors = [];
  if (!output || typeof output !== "object") {
    return ["recommendation output must be an object."];
  }
  if (!output.priority || typeof output.priority !== "object") {
    errors.push("priority is required.");
  } else {
    if (!Number.isInteger(output.priority.score) || output.priority.score < 0 || output.priority.score > 100) {
      errors.push("priority.score must be an integer from 0 to 100.");
    }
    requireEvidenceRefs(output.priority.evidence_refs, "priority.evidence_refs", errors);
  }
  if (!output.segment || typeof output.segment !== "object") {
    errors.push("segment is required.");
  } else {
    if (!Object.values(INTELLIGENCE_SEGMENTS).includes(output.segment.type)) {
      errors.push("segment.type is invalid.");
    }
    requireEvidenceRefs(output.segment.evidence_refs, "segment.evidence_refs", errors);
  }
  if (!Array.isArray(output.personalization_context)) {
    errors.push("personalization_context must be an array.");
  } else {
    output.personalization_context.forEach((fact, index) => {
      if (!fact.label || typeof fact.label !== "string") {
        errors.push(`personalization_context ${index + 1}: label is required.`);
      }
      if (!fact.value || typeof fact.value !== "string") {
        errors.push(`personalization_context ${index + 1}: value is required.`);
      }
      requireEvidenceRefs(fact.evidence_refs, `personalization_context ${index + 1}: evidence_refs`, errors);
    });
  }
  if (!output.recommendation || typeof output.recommendation !== "object") {
    errors.push("recommendation is required.");
  } else {
    if (!Object.values(INTELLIGENCE_RECOMMENDED_STEPS).includes(output.recommendation.step)) {
      errors.push("recommendation.step is invalid.");
    }
    if (!output.recommendation.reason || typeof output.recommendation.reason !== "string") {
      errors.push("recommendation.reason is required.");
    }
    requireEvidenceRefs(output.recommendation.evidence_refs, "recommendation.evidence_refs", errors);
  }
  return errors;
}

export function collectRecommendationEvidenceRefs(output) {
  const refs = new Set();
  for (const ref of output.priority?.evidence_refs || []) {
    refs.add(ref);
  }
  for (const ref of output.segment?.evidence_refs || []) {
    refs.add(ref);
  }
  for (const fact of output.personalization_context || []) {
    for (const ref of fact.evidence_refs || []) {
      refs.add(ref);
    }
  }
  for (const ref of output.recommendation?.evidence_refs || []) {
    refs.add(ref);
  }
  return Array.from(refs).sort();
}

function requireEvidenceRefs(refs, fieldName, errors) {
  if (!Array.isArray(refs) || refs.length === 0) {
    errors.push(`${fieldName} must contain at least one evidence reference.`);
  }
}
