import { ACTION_TYPES } from "../outbound-automation/actionContract.js";

export const CAMPAIGN_STATUS = {
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  ARCHIVED: "ARCHIVED"
};

export const SEQUENCE_STATUS = {
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  ARCHIVED: "ARCHIVED"
};

export const STEP_TYPES = new Set([...ACTION_TYPES, "WAIT"]);

export const WORKFLOW_RUN_STATUS = {
  ACTIVE: "ACTIVE",
  WAITING: "WAITING",
  WAITING_APPROVAL: "WAITING_APPROVAL",
  COMPLETED: "COMPLETED",
  STOPPED: "STOPPED",
  BLOCKED: "BLOCKED"
};

export function validateCampaignInput({ name }) {
  const errors = [];
  if (!name || typeof name !== "string" || !name.trim()) {
    errors.push("name is required.");
  }
  return errors;
}

export function validateSequenceInput({ name, steps }) {
  const errors = [];
  if (!name || typeof name !== "string" || !name.trim()) {
    errors.push("name is required.");
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    errors.push("steps must include at least one step.");
  } else {
    steps.forEach((step, index) => {
      if (!STEP_TYPES.has(step.type)) {
        errors.push(`steps[${index}].type is invalid.`);
      }
      if (step.delay_hours !== undefined && (!Number.isFinite(step.delay_hours) || step.delay_hours < 0)) {
        errors.push(`steps[${index}].delay_hours must be a non-negative number.`);
      }
      if (step.requires_approval !== undefined && typeof step.requires_approval !== "boolean") {
        errors.push(`steps[${index}].requires_approval must be boolean.`);
      }
    });
  }
  return errors;
}

