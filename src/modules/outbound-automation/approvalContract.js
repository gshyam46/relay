export const APPROVAL_STATUS = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED"
};

export function validateApprovalDecisionInput({ reviewer_name = null, reviewer_note = null, edited_payload = null } = {}) {
  const errors = [];
  if (reviewer_name !== null && typeof reviewer_name !== "string") {
    errors.push("reviewer_name must be text when provided.");
  } else if (reviewer_name !== null && reviewer_name.trim().length > 120) {
    errors.push("reviewer_name must be 120 characters or fewer.");
  }
  if (reviewer_note !== null && typeof reviewer_note !== "string") {
    errors.push("reviewer_note must be text when provided.");
  } else if (reviewer_note !== null && reviewer_note.trim().length > 1000) {
    errors.push("reviewer_note must be 1000 characters or fewer.");
  }
  if (edited_payload !== null && (typeof edited_payload !== "object" || Array.isArray(edited_payload))) {
    errors.push("edited_payload must be an object when provided.");
  }
  return errors;
}
