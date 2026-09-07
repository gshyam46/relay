export const NEXT_BEST_ACTION_PIPELINE_VERSION = "m3-next-best-action-v1";

export const NEXT_BEST_ACTION_PLAN_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  PLANNED: "PLANNED",
  BLOCKED: "BLOCKED",
  SUPERSEDED: "SUPERSEDED",
  FAILED: "FAILED"
});

export const NEXT_BEST_ACTION_TYPES = Object.freeze({
  GATHER_MORE_DATA: "GATHER_MORE_DATA",
  REVIEW_DUPLICATE_CANDIDATE: "REVIEW_DUPLICATE_CANDIDATE",
  REVIEW_LEAD_INTELLIGENCE: "REVIEW_LEAD_INTELLIGENCE",
  PREPARE_OUTBOUND_REVIEW: "PREPARE_OUTBOUND_REVIEW"
});

export const POLICY_DECISIONS = Object.freeze({
  ALLOW: "ALLOW",
  REQUIRE_HUMAN_APPROVAL: "REQUIRE_HUMAN_APPROVAL",
  BLOCK: "BLOCK"
});

export const APPROVAL_REQUIREMENT = Object.freeze({
  NOT_REQUIRED: "NOT_REQUIRED",
  REQUIRED: "REQUIRED",
  BLOCKED: "BLOCKED"
});

export function validateNextBestActionPlanOutput(output) {
  const errors = [];
  if (!output || typeof output !== "object") {
    return ["next-best-action plan output must be an object."];
  }
  if (!Object.values(NEXT_BEST_ACTION_TYPES).includes(output.action_type)) {
    errors.push("action_type is invalid.");
  }
  if (!output.title || typeof output.title !== "string") {
    errors.push("title is required.");
  }
  if (!output.rationale || typeof output.rationale !== "string") {
    errors.push("rationale is required.");
  }
  if (!output.policy_decision || typeof output.policy_decision !== "object") {
    errors.push("policy_decision is required.");
  } else if (!Object.values(POLICY_DECISIONS).includes(output.policy_decision.decision)) {
    errors.push("policy_decision.decision is invalid.");
  }
  if (!output.approval || typeof output.approval !== "object") {
    errors.push("approval is required.");
  } else if (!Object.values(APPROVAL_REQUIREMENT).includes(output.approval.requirement)) {
    errors.push("approval.requirement is invalid.");
  }
  if (!Array.isArray(output.decision_evidence_refs) || output.decision_evidence_refs.length === 0) {
    errors.push("decision_evidence_refs must contain at least one evidence reference.");
  }
  if (!output.execution_contract || typeof output.execution_contract !== "object") {
    errors.push("execution_contract is required.");
  } else if (output.execution_contract.executable !== false) {
    errors.push("execution_contract.executable must be false in M3.");
  }
  return errors;
}
