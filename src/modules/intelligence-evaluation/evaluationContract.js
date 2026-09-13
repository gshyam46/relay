import { createHash } from "node:crypto";

export const EVALUATION_VERSION = "l3.04-reviewed-reply-v1";
export const REPLY_CLASSES = Object.freeze(["POSITIVE_REPLY", "NEGATIVE_REPLY", "QUESTION", "OPT_OUT", "UNKNOWN"]);
export const MAX_CASES = 100;
export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
const messages = {
  EVALUATION_REQUEST_INVALID: [400, "Evaluation request is invalid."],
  EVALUATION_OWNER_REQUIRED: [403, "Workspace owner access is required."],
  EVALUATION_NOT_FOUND: [404, "Evaluation record was not found."],
  EVALUATION_REQUEST_CONFLICT: [409, "This evaluation request key belongs to a different request."],
  EVALUATION_VERSION_STALE: [409, "The named dataset version changed. Review its latest version."],
  EVALUATION_LABELS_CHANGED: [409, "Selected review labels or nominations changed. Review a new dataset version."],
  EVALUATION_CASE_INELIGIBLE: [409, "Select an active, explicitly nominated reply review with an expected category."],
  EVALUATION_SPLIT_CONFLICT: [409, "An enquiry or exact reply was already reserved for a different evaluation split."],
  EVALUATION_HOLDOUT_CONSUMED: [409, "This protected replay group has already been evaluated."],
  EVALUATION_LIMIT: [422, "Evaluation exceeds its bounded case or data limit."],
  EVALUATION_STATE_INVALID: [503, "Evaluation state requires operational review."]
};
export function evaluationError(code) { const [statusCode, message] = messages[code] || messages.EVALUATION_STATE_INVALID; return Object.assign(new Error(message), { code, statusCode }); }
export function exactKeys(value, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw evaluationError("EVALUATION_REQUEST_INVALID");
}
export function text(value, max = 256) { if (typeof value !== "string" || !value.trim() || value.length > max) throw evaluationError("EVALUATION_REQUEST_INVALID"); return value.trim(); }
export function integer(value, min = 0, max = 2147483647) { if (!Number.isInteger(value) || value < min || value > max) throw evaluationError("EVALUATION_REQUEST_INVALID"); return value; }
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function hash(value) { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
export function textHash(value) { return createHash("sha256").update(value).digest("hex"); }
export function parseBounded(value, max) { try { if (typeof value !== "string" || Buffer.byteLength(value) > max) throw new Error(); return JSON.parse(value); } catch { throw evaluationError("EVALUATION_STATE_INVALID"); } }
export function normalizeCreate(input) {
  exactKeys(input, ["organization_id", "actor", "request_key", "expected_version", "name", "split", "feedback_revisions"]);
  const normalized = { name: text(input.name, 120), expected_version: integer(input.expected_version, 0, 2147483646), split: input.split };
  if (!["DEV", "HOLDOUT"].includes(input.split)) throw evaluationError("EVALUATION_REQUEST_INVALID");
  if (!Array.isArray(input.feedback_revisions) || !input.feedback_revisions.length || input.feedback_revisions.length > MAX_CASES) throw evaluationError("EVALUATION_LIMIT");
  normalized.feedback_revisions = input.feedback_revisions.map(item => { exactKeys(item, ["feedback_id", "revision"]); return { feedback_id: text(item.feedback_id), revision: integer(item.revision, 1) }; }).sort((a, b) => a.feedback_id < b.feedback_id ? -1 : a.feedback_id > b.feedback_id ? 1 : a.revision - b.revision);
  if (new Set(normalized.feedback_revisions.map(item => item.feedback_id)).size !== normalized.feedback_revisions.length) throw evaluationError("EVALUATION_REQUEST_INVALID");
  return { ...normalized, request_key: text(input.request_key, 200), request_hash: hash(normalized) };
}
export function labelsCurrent(item) { return item.latest_revision === item.revision && item.latest_status === "RECORDED" && ["SYNTHETIC", "PERMISSION_REVIEWED"].includes(item.latest_eval_use); }
export function eligible(item) { return item.status === "RECORDED" && item.target_kind === "REPLY" && typeof item.lead_id === "string" && ["CORRECT", "INCORRECT"].includes(item.labels?.correctness) && REPLY_CLASSES.includes(item.labels?.expected_category) && ["SYNTHETIC", "PERMISSION_REVIEWED"].includes(item.labels?.eval_use); }
export function caseProjection(item) {
  try {
    if (!eligible(item) || !item.reply || typeof item.reply.text !== "string" || !item.reply.text.trim() || item.reply.text.length > 32768 || !REPLY_CLASSES.includes(item.reply.recorded_category) || !/^[a-f0-9]{64}$/.test(item.source_sha256 || "")) throw new Error();
    exactKeys(item.labels, ["correctness", "usefulness", "expected_category", "eval_use"]);
    if (!["USEFUL", "NOT_USEFUL", "NOT_ASSESSED"].includes(item.labels.usefulness)) throw new Error();
    exactKeys(item.reply, ["text", "recorded_category", "generation"]);
    if (item.reply.generation !== null) {
      const generation = item.reply.generation;
      exactKeys(generation, ["mode", "reason", "reply_policy_version", "prompt_version"], ["provider", "model"]);
      if (!["LOCAL_POLICY", "DETERMINISTIC_CLASSIFICATION", "LLM_CLASSIFICATION", "DETERMINISTIC_FALLBACK"].includes(generation.mode)) throw new Error();
      for (const [key, value] of Object.entries(generation)) if (!(value === null && ["provider", "model", "prompt_version"].includes(key)) && (typeof value !== "string" || !value.trim() || value.length > 200)) throw new Error();
    }
    text(item.feedback_id); text(item.lead_id); integer(item.revision, 1, 100);
    return { feedback_id: item.feedback_id, revision: item.revision, lead_id: item.lead_id, labels: item.labels, source_sha256: item.source_sha256, reply: item.reply };
  } catch { throw evaluationError("EVALUATION_CASE_INELIGIBLE"); }
}
