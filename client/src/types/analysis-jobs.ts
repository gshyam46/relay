export type AnalysisItemState = "QUEUED" | "RUNNING" | "RETRY_PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type AnalysisJobState = AnalysisItemState | "PARTIAL";
export interface AnalysisJobItem {
  id: string; lead_id: string; lead_name: string | null; event_id: string; state: AnalysisItemState;
  stage: string | null; attempts: number; max_attempts: number; next_attempt_at: string | null;
  retry_deadline_at: string | null; error_code: string | null; error_message: string | null; reused: boolean;
  stages: { key: string; status: string; artifact_type: string | null; artifact_id: string | null }[];
  artifacts: { snapshot_id: string | null; synthesis_id: string | null; recommendation_id: string | null; plan_id: string | null; action_id: string | null };
}
export interface AnalysisJob {
  id: string; organization_id: string; request_key: string; revision: number;
  mode: "ANALYSIS_ONLY" | "PREPARE_DRAFTS"; target_stage: "SNAPSHOT" | "SYNTHESIS" | "RECOMMENDATION" | "PLAN";
  requested_by: string; status: AnalysisJobState; created_at: string; updated_at: string; cancelled_at: string | null;
  counts: { total: number; queued: number; running: number; retry_pending: number; completed: number; failed: number; cancelled: number };
  can_cancel: boolean; can_retry: boolean; command_block_reason: string | null; items: AnalysisJobItem[];
}
export interface AnalysisJobList { jobs: AnalysisJob[]; total: number; has_more: boolean; limit: number; offset: number }
export interface AnalysisRequest { request_key: string; lead_ids: string[]; mode: "PREPARE_DRAFTS"; target_stage: "PLAN" }
export function jobFinished(job: AnalysisJob) { return ["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"].includes(job.status); }
export const jobLabels: Record<AnalysisJobState, string> = { QUEUED: "Queued", RUNNING: "Running", RETRY_PENDING: "Waiting to retry", COMPLETED: "Completed", PARTIAL: "Finished with issues", FAILED: "Needs review", CANCELLED: "Cancelled" };
export interface AiPricing { provider: string; model: string; input_usd_per_million: string; output_usd_per_million: string }
export interface AiControls { revision: number; paused: boolean; max_daily_attempts: number; max_in_flight: number; pricing: AiPricing[]; updated_by: string | null; updated_at: string | null }
export interface AiUsageSummary {
  budget_day: string; next_reset_at: string; admitted_attempts: number; in_flight: number;
  limits: { paused: boolean; max_daily_attempts: number; max_in_flight: number }; can_invoke: boolean; hold_code: string | null;
  provider_reported_attempts: number; unknown_usage_attempts: number; input_tokens_known_total: number | null; output_tokens_known_total: number | null; total_tokens_known_total: number | null;
  cost: { currency: "USD"; estimated_microusd: string | null; estimated_usd: string | null; estimated_attempts: number; unknown_attempts: number; basis: "OWNER_RATES_PROVIDER_REPORTED_TOKENS"; is_invoice: false; is_monetary_cap: false };
}
export interface AiControlsResponse { controls: AiControls; history: { items: { revision: number; controls: Pick<AiControls, "paused" | "max_daily_attempts" | "max_in_flight" | "pricing">; reason: string; created_by: string; created_at: string }[]; has_more: boolean; next_before_revision: number | null; limit: number }; usage: AiUsageSummary }
export interface AiAttempt { pipeline_version: string; prompt_version: string; schema_version: string; id: string; lead_id: string | null; purpose: string; provider: string; requested_model: string; response_model: string | null; authorized_at: string; deadline_at: string; request_state: "ADMITTED" | "OBSERVED" | "UNCONFIRMED"; outcome: string | null; usage_status: "UNKNOWN" | "PROVIDER_REPORTED"; input_tokens: number | null; output_tokens: number | null; total_tokens: number | null; usage_reason: string | null; elapsed_ms: number | null; cost_status: "UNKNOWN" | "ESTIMATED"; cost_estimate_microusd: string | null; cost_estimate_usd: string | null; pricing_revision: number | null; observed_at: string | null; closed_at: string | null }
export interface AiUsageResponse { summary: AiUsageSummary; items: AiAttempt[]; limit: number; has_more: boolean; next_before_attempt_id: string | null }
