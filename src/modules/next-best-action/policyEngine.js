import { APPROVAL_REQUIREMENT, POLICY_DECISIONS } from "./nextBestActionContract.js";

export class PolicyEngine {
  evaluate({ lead, actionType }) {
    if (["OPTED_OUT", "SUPPRESSED"].includes(lead.status)) {
      return blocked("Lead cannot be planned for outbound work because it is suppressed or opted out.");
    }

    if (actionType === "PREPARE_OUTBOUND_REVIEW" && !hasUsableContact(lead)) {
      return blocked("Outbound review cannot be prepared until a usable email or phone is available.");
    }

    if (["PREPARE_OUTBOUND_REVIEW", "REVIEW_DUPLICATE_CANDIDATE", "REVIEW_LEAD_INTELLIGENCE"].includes(actionType)) {
      return {
        decision: POLICY_DECISIONS.REQUIRE_HUMAN_APPROVAL,
        reasons: ["Human review is required before this next step can become an executable action."],
        approval: {
          requirement: APPROVAL_REQUIREMENT.REQUIRED,
          reason: "M3 plans next steps only. M5 will implement approval workflow."
        }
      };
    }

    return {
      decision: POLICY_DECISIONS.ALLOW,
      reasons: ["The plan is limited to improving lead data and does not create outbound side effects."],
      approval: {
        requirement: APPROVAL_REQUIREMENT.NOT_REQUIRED,
        reason: "No outbound execution or approval workflow is created in M3."
      }
    };
  }
}

function blocked(reason) {
  return {
    decision: POLICY_DECISIONS.BLOCK,
    reasons: [reason],
    approval: {
      requirement: APPROVAL_REQUIREMENT.BLOCKED,
      reason
    }
  };
}

function hasUsableContact(lead) {
  return Boolean(lead.normalized_email || lead.email || lead.normalized_phone || lead.phone);
}
