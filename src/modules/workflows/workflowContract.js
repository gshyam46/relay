import { channelForActionType } from "../channels/channelContract.js";

export const CAMPAIGN_STATUS = { DRAFT: "DRAFT", ACTIVE: "ACTIVE", PAUSED: "PAUSED", ARCHIVED: "ARCHIVED" };
export const SEQUENCE_STATUS = { ...CAMPAIGN_STATUS };
export const STEP_TYPES = new Set(["SEND_EMAIL", "SEND_WHATSAPP", "SEND_SMS", "SEND_VOICE_CALL", "CREATE_HUMAN_TASK", "WAIT"]);
export const WORKFLOW_RUN_STATUS = {
  ACTIVE: "ACTIVE", WAITING: "WAITING", WAITING_APPROVAL: "WAITING_APPROVAL", WAITING_EXECUTION: "WAITING_EXECUTION",
  COMPLETED: "COMPLETED", STOPPED: "STOPPED", BLOCKED: "BLOCKED"
};
export const OPEN_RUN_STATUSES = new Set(["ACTIVE", "WAITING", "WAITING_APPROVAL", "WAITING_EXECUTION"]);
export function workflowError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}
export function validateCampaignInput({ name, objective = null }) {
  const errors = [];
  if (typeof name !== "string" || !name.trim() || name.trim().length > 200) errors.push("name must contain 1 to 200 characters.");
  if (objective !== null && (typeof objective !== "string" || objective.length > 2000)) errors.push("objective must contain at most 2000 characters.");
  return errors;
}
export function validateSequenceInput({ name, steps, stop_on_reply = true }) {
  const errors = validateCampaignInput({ name });
  if (stop_on_reply !== true) errors.push("Every canonical reply stops the sequence for human review; stop_on_reply must be true.");
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 50) return [...errors, "steps must contain 1 to 50 steps."];
  steps.forEach((step, index) => {
    const prefix = "steps[" + index + "]";
    if (!step || typeof step !== "object" || Array.isArray(step)) { errors.push(prefix + " must be an object."); return; }
    if (!STEP_TYPES.has(step.type)) errors.push(prefix + ".type is unsupported.");
    if (step.delay_hours !== undefined && (!Number.isFinite(step.delay_hours) || step.delay_hours < 0 || step.delay_hours > 8760)) errors.push(prefix + ".delay_hours must be between 0 and 8760.");
    for (const key of ["requires_approval", "stop_on_reply"]) {
      if (step[key] !== undefined && typeof step[key] !== "boolean") errors.push(prefix + "." + key + " must be boolean.");
    }
    if (step.stop_on_reply === false) errors.push(prefix + ".stop_on_reply must be true; replies require human review.");
    for (const [key, limit] of [["title", 300], ["body", 10000]]) {
      if (step[key] !== undefined && step[key] !== null && (typeof step[key] !== "string" || step[key].length > limit)) errors.push(prefix + "." + key + " is invalid or too long.");
    }
    if (step.channel && step.channel !== channelForActionType(step.type)) errors.push(prefix + ".channel does not match its action type.");
    if (step.payload !== undefined && (!step.payload || typeof step.payload !== "object" || Array.isArray(step.payload))) errors.push(prefix + ".payload must be an object.");
  });
  return errors;
}
// Offset-required input: validate calendar components before Date.parse can roll them over.
export function scheduleInstant(value) {
  const match = typeof value === "string" && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw workflowError("INVALID_SCHEDULE_TIME", "Use an ISO schedule with seconds and an explicit UTC offset.", 400);
  const [, year, month, day, hour, minute, second, offset] = match;
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (+month < 1 || +month > 12 || +day < 1 || +day > days || +hour > 23 || +minute > 59 || +second > 59
    || (offset !== "Z" && (+offset.slice(1,3) > 23 || +offset.slice(4) > 59)) || !Number.isFinite(Date.parse(value))) {
    throw workflowError("INVALID_SCHEDULE_TIME", "Schedule must be a valid calendar instant.", 400);
  }
  return new Date(value).toISOString();
}
