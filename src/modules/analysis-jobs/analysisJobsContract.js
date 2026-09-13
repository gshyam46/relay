import { createHash } from "node:crypto";
import { canonical } from "../events/domainEventProcessor.js";
export const ANALYSIS_JOB_VERSION = "l3.03-analysis-jobs-v1";
export const ANALYSIS_STAGES = ["SNAPSHOT", "SYNTHESIS", "RECOMMENDATION", "PLAN"];
export const TERMINAL_EVENTS = new Set(["PROCESSED", "DISMISSED"]);
export const MAX_JOB_ITEMS = 50;
export const MAX_UNFINISHED_ITEMS = 100;
export function analysisError(code, message, statusCode = 400) { return Object.assign(new Error(message), { code, statusCode }); }
export function jobText(value, name, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw analysisError("ANALYSIS_INVALID_INPUT", "Provide a valid " + name + ".");
  return value.trim();
}
export function jobInteger(value, fallback, minimum, maximum) {
  if (value === undefined) return fallback;
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw analysisError("ANALYSIS_INVALID_INPUT", "Provide a valid analysis limit or revision.");
  return value;
}
export function jobHash(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
export function enqueueCommand(input) {
  const organization_id = jobText(input.organization_id, "organization_id"), request_key = jobText(input.request_key, "request_key");
  if (!Array.isArray(input.lead_ids) || input.lead_ids.length < 1 || input.lead_ids.length > MAX_JOB_ITEMS) throw analysisError("ANALYSIS_INVALID_SELECTION", "Select between one and fifty enquiries.");
  const lead_ids = input.lead_ids.map(id => jobText(id, "lead_id"));
  if (new Set(lead_ids).size !== lead_ids.length) throw analysisError("ANALYSIS_INVALID_SELECTION", "Select distinct enquiries.");
  const mode = input.mode, target_stage = input.target_stage, execution_scope = input.execution_scope ?? "PIPELINE";
  if (!["ANALYSIS_ONLY", "PREPARE_DRAFTS"].includes(mode) || !ANALYSIS_STAGES.includes(target_stage) || !["PIPELINE", "SINGLE_STAGE"].includes(execution_scope) || (mode === "PREPARE_DRAFTS" && target_stage !== "PLAN")) throw analysisError("ANALYSIS_INVALID_INPUT", "Choose a supported analysis mode and stage.");
  const simulation = input.simulate_failure_stage == null ? null : jobText(input.simulate_failure_stage, "simulation stage", 100);
  return { organization_id, request_key, lead_ids, mode, target_stage, execution_scope, simulation, actor: input.actor };
}
export function eventState(status) { return ({ PENDING: "QUEUED", PROCESSING: "RUNNING", RETRY_PENDING: "RETRY_PENDING", PROCESSED: "COMPLETED", DISMISSED: "CANCELLED" })[status] || "FAILED"; }
export function eventRetryable(row, now) {
  const deadline = Date.parse(row.retry_deadline_at), first = Date.parse(row.first_processing_at);
  return ["QUARANTINED", "FAILED"].includes(row.status) && row.processing_version === 1 && Number.isSafeInteger(row.attempts) && row.attempts >= 1 && row.attempts < row.max_attempts
    && Number.isFinite(deadline) && new Date(deadline).toISOString() === row.retry_deadline_at && deadline > now && Number.isFinite(first) && first <= now
    && !["ANALYSIS_VERSION_CHANGED", "INVALID_EVENT_PAYLOAD", "INVALID_EVENT_POLICY", "INVALID_EVENT_TIME", "ANALYSIS_JOB_INVALID"].includes(row.processing_hold_reason);
}
export function publicJob(row, items, now) {
  const counts = { total: items.length, queued: 0, running: 0, retry_pending: 0, completed: 0, failed: 0, cancelled: 0 };
  for (const item of items) counts[item.state.toLowerCase()]++;
  const status = row.cancelled_at ? "CANCELLED" : counts.running ? "RUNNING" : counts.queued ? "QUEUED" : counts.retry_pending ? "RETRY_PENDING"
    : counts.completed === counts.total ? "COMPLETED" : counts.completed ? "PARTIAL" : "FAILED";
  const canCancel = !row.cancelled_at && items.some(item => !["COMPLETED", "CANCELLED"].includes(item.state));
  const canRetry = !row.cancelled_at && items.some(item => item.can_retry);
  return { id: row.id, organization_id: row.organization_id, request_key: row.request_key, revision: row.revision, mode: row.mode, target_stage: row.target_stage,
    requested_by: row.requested_by, status, created_at: row.created_at, updated_at: items.reduce((latest, item) => item.updated_at > latest ? item.updated_at : latest, row.updated_at),
    cancelled_at: row.cancelled_at, counts, can_cancel: canCancel, can_retry: canRetry,
    command_block_reason: row.cancelled_at ? "ANALYSIS_JOB_CANCELLED" : (!canCancel && !canRetry) ? "ANALYSIS_JOB_TERMINAL" : null,
    items: items.map(({ can_retry, updated_at, ...item }) => item) };
}
export function publicItem(row, stages, now) {
  const ordered = stages.map(s => ({ key: s.stage_key, status: s.status, artifact_type: s.artifact_type, artifact_id: s.artifact_id }));
  const artifacts = { snapshot_id: null, synthesis_id: null, recommendation_id: null, plan_id: null, action_id: null };
  for (const stage of ordered) { const key = stage.artifact_type?.toLowerCase() + "_id"; if (Object.hasOwn(artifacts, key)) artifacts[key] = stage.artifact_id; }
  return { id: row.id, lead_id: row.lead_id, lead_name: row.lead_name, event_id: row.event_id, state: eventState(row.status),
    stage: ordered.find(s => s.status === "PREPARED")?.key || ordered.at(-1)?.key || null, attempts: row.attempts, max_attempts: row.max_attempts,
    next_attempt_at: row.next_attempt_at, retry_deadline_at: row.retry_deadline_at, error_code: row.last_error_code,
    error_message: row.last_error_code ? "Analysis did not finish. Review the recorded reason before retrying." : null,
    reused: ordered.some(s => s.key === "reused" && s.status === "DONE"), stages: ordered, artifacts, can_retry: eventRetryable(row, now), updated_at: row.event_updated_at };
}
