import { createHash } from "node:crypto";
import { canonical } from "../events/domainEventProcessor.js";
export const FEEDBACK_KINDS = ["SNAPSHOT", "SYNTHESIS", "RECOMMENDATION", "PLAN", "REPLY"];
export const REPLY_CATEGORIES = ["POSITIVE_REPLY", "NEGATIVE_REPLY", "QUESTION", "OPT_OUT", "UNKNOWN"];
export const MAX_TARGET_BYTES = 1048576;
export const MAX_FEEDBACK_REVISIONS = 100;
export function feedbackError(code, message, statusCode = 400) { return Object.assign(new Error(message), { code, statusCode }); }
export function feedbackHash(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
export function feedbackObject(value, allowed, required = allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw feedbackError("FEEDBACK_INVALID_INPUT", "Provide the supported feedback fields.");
}
export function feedbackText(value, name, max = 256) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw feedbackError("FEEDBACK_INVALID_INPUT", "Provide a valid " + name + ".");
  return value.trim();
}
export function feedbackInteger(value, fallback, min = 0, max = 2147483647) {
  if (value === undefined) return fallback;
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw feedbackError("FEEDBACK_INVALID_INPUT", "Provide a valid feedback revision or limit.");
  return value;
}
export function feedbackScope(input) {
  const organization_id = feedbackText(input.organization_id, "workspace"), lead_id = feedbackText(input.lead_id, "lead"), target_id = feedbackText(input.target_id, "target");
  if (!FEEDBACK_KINDS.includes(input.target_kind)) throw feedbackError("FEEDBACK_INVALID_INPUT", "Choose a supported feedback target.");
  return { organization_id, lead_id, target_kind: input.target_kind, target_id, actor: input.actor };
}
export function normalizeFeedbackLabels(value, kind) {
  feedbackObject(value, ["correctness", "usefulness", "expected_category", "eval_use"]);
  if (!["CORRECT", "INCORRECT", "UNCLEAR"].includes(value.correctness) || !["USEFUL", "NOT_USEFUL", "NOT_ASSESSED"].includes(value.usefulness)
    || (value.expected_category !== null && !REPLY_CATEGORIES.includes(value.expected_category)) || !["OPERATIONAL_ONLY", "SYNTHETIC", "PERMISSION_REVIEWED"].includes(value.eval_use)
    || (kind !== "REPLY" && (value.expected_category !== null || value.eval_use !== "OPERATIONAL_ONLY"))) throw feedbackError("FEEDBACK_INVALID_INPUT", "Choose supported review labels for this target.");
  if (value.eval_use !== "OPERATIONAL_ONLY" && (value.correctness === "UNCLEAR" || value.expected_category === null)) throw feedbackError("FEEDBACK_INVALID_INPUT", "Evaluation nomination needs an explicit reviewed reply category.");
  return { correctness: value.correctness, usefulness: value.usefulness, expected_category: value.expected_category, eval_use: value.eval_use };
}
export async function requireFeedbackOwner(tx, org, actor) {
  if (!actor || actor.role !== "OWNER" || !await tx.get("SELECT id FROM users WHERE organization_id=? AND id=? AND role='OWNER'", [org, actor.id])) throw feedbackError("FEEDBACK_OWNER_REQUIRED", "A current workspace owner is required to review intelligence.", 403);
}
export function parseFeedbackJson(value, max = MAX_TARGET_BYTES) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > max) throw feedbackError("FEEDBACK_TARGET_INVALID", "Saved review data requires operational inspection.", 409);
  try { return JSON.parse(value); } catch { throw feedbackError("FEEDBACK_TARGET_INVALID", "Saved review data requires operational inspection.", 409); }
}
export function feedbackSummary(row) {
  if (!row) return null;
  const labels = row.labels_json === null ? null : normalizeFeedbackLabels(parseFeedbackJson(row.labels_json, 4096), row.target_kind || "REPLY");
  return { id: row.feedback_id, revision: row.revision, status: row.status, labels, reason: row.reason, created_at: row.created_at, created_by: row.created_by };
}
export function byteLengthSql(db, expression) { return db.kind === "postgres" ? "octet_length(CAST(" + expression + " AS TEXT))" : "length(CAST(" + expression + " AS BLOB))"; }
