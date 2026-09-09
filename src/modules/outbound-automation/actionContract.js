export const ACTION_TYPES = new Set([
  "SEND_EMAIL",
  "SEND_WHATSAPP",
  "SEND_SMS",
  "SEND_VOICE_CALL",
  "CREATE_HUMAN_TASK",
  "UPDATE_CRM",
  "RUN_RESEARCH",
  "WAIT"
]);

export const MOCK_BEHAVIORS = new Set(["SUCCESS", "TRANSIENT_FAIL_ONCE", "PERMANENT_FAILURE"]);

export const ACTION_STATUS = {
  PLANNED: "PLANNED",
  AWAITING_APPROVAL: "AWAITING_APPROVAL",
  APPROVED: "APPROVED",
  EXECUTING: "EXECUTING",
  COMPLETED: "COMPLETED",
  RETRYING: "RETRYING",
  FAILED: "FAILED",
  BLOCKED: "BLOCKED"
};

export const EXECUTION_STATUS = {
  STARTED: "STARTED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED"
};

export const EXECUTION_MODE = {
  SANDBOX: "SANDBOX"
};

export const EXECUTABLE_ACTION_STATUSES = new Set([ACTION_STATUS.PLANNED, ACTION_STATUS.APPROVED, ACTION_STATUS.RETRYING]);

export const TERMINAL_ACTION_STATUSES = new Set([ACTION_STATUS.COMPLETED, ACTION_STATUS.BLOCKED]);

export function validateActionInput({ type, mock_behavior }) {
  const errors = [];
  if (!ACTION_TYPES.has(type)) {
    errors.push(`type must be one of: ${Array.from(ACTION_TYPES).join(", ")}.`);
  }
  if (!MOCK_BEHAVIORS.has(mock_behavior)) {
    errors.push(`mock_behavior must be one of: ${Array.from(MOCK_BEHAVIORS).join(", ")}.`);
  }
  return errors;
}

export function actionTypeForPlan(plan) {
  const map = {
    GATHER_MORE_DATA: "CREATE_HUMAN_TASK",
    REVIEW_DUPLICATE_CANDIDATE: "CREATE_HUMAN_TASK",
    REVIEW_LEAD_INTELLIGENCE: "CREATE_HUMAN_TASK",
    PREPARE_OUTBOUND_REVIEW: "SEND_EMAIL"
  };
  return map[plan?.action_type] || "CREATE_HUMAN_TASK";
}
