export const SYNTHESIS_PIPELINE_VERSION = "l3.03-extractive-synthesis-v4";
export const SYNTHESIS_PROMPT_VERSION = "l3.03-synthesis-prompt-v1";

export const SYNTHESIS_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  READY: "READY",
  SUPERSEDED: "SUPERSEDED",
  FAILED: "FAILED"
});

export const QUALIFICATION_OUTCOMES = Object.freeze({
  READY_FOR_DEEPER_INTELLIGENCE: "READY_FOR_DEEPER_INTELLIGENCE",
  NEEDS_MORE_DATA: "NEEDS_MORE_DATA",
  NEEDS_REVIEW: "NEEDS_REVIEW"
});

export const SYNTHESIS_RECOMMENDATION_TYPES = Object.freeze({
  GATHER_MORE_DATA: "GATHER_MORE_DATA",
  REVIEW_LEAD_INTELLIGENCE: "REVIEW_LEAD_INTELLIGENCE",
  READY_FOR_DEEPER_INTELLIGENCE: "READY_FOR_DEEPER_INTELLIGENCE"
});

export function validateSynthesisOutput(output) {
  const errors = [];
  if (!output || typeof output !== "object") {
    return ["synthesis output must be an object."];
  }
  if (!output.summary || typeof output.summary.text !== "string" || !output.summary.text.trim()) {
    errors.push("summary.text is required.");
  }
  if (!Array.isArray(output.findings)) {
    errors.push("findings must be an array.");
  } else {
    output.findings.forEach((finding, index) => {
      const prefix = `finding ${index + 1}`;
      if (!finding.field || typeof finding.field !== "string") {
        errors.push(`${prefix}: field is required.`);
      }
      if (!finding.value || typeof finding.value !== "string") {
        errors.push(`${prefix}: value is required.`);
      }
      if (!Array.isArray(finding.evidence_refs) || finding.evidence_refs.length === 0) {
        errors.push(`${prefix}: evidence_refs must contain at least one reference.`);
      }
    });
  }
  if (!output.qualification || typeof output.qualification !== "object") {
    errors.push("qualification is required.");
  } else {
    if (!Object.values(QUALIFICATION_OUTCOMES).includes(output.qualification.outcome)) {
      errors.push("qualification.outcome is invalid.");
    }
    if (!Array.isArray(output.qualification.reasons) || output.qualification.reasons.length === 0) {
      errors.push("qualification.reasons must contain at least one reason.");
    }
    if (!Array.isArray(output.qualification.evidence_refs) || output.qualification.evidence_refs.length === 0) {
      errors.push("qualification.evidence_refs must contain at least one reference.");
    }
  }
  if (!output.recommendation || typeof output.recommendation !== "object") {
    errors.push("recommendation is required.");
  } else {
    if (!Object.values(SYNTHESIS_RECOMMENDATION_TYPES).includes(output.recommendation.type)) {
      errors.push("recommendation.type is invalid.");
    }
    if (!output.recommendation.reason || typeof output.recommendation.reason !== "string") {
      errors.push("recommendation.reason is required.");
    }
    if (!Array.isArray(output.recommendation.evidence_refs) || output.recommendation.evidence_refs.length === 0) {
      errors.push("recommendation.evidence_refs must contain at least one reference.");
    }
  }
  return errors;
}

export function collectEvidenceRefs(output) {
  const refs = new Set();
  for (const finding of output.findings || []) {
    for (const ref of finding.evidence_refs || []) {
      refs.add(ref);
    }
  }
  for (const ref of output.qualification?.evidence_refs || []) {
    refs.add(ref);
  }
  for (const ref of output.recommendation?.evidence_refs || []) {
    refs.add(ref);
  }
  return Array.from(refs).sort();
}
