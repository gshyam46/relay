export type FeedbackKind = "SNAPSHOT" | "SYNTHESIS" | "RECOMMENDATION" | "PLAN" | "REPLY";
export interface FeedbackTargetRef { lead_id: string; target_kind: FeedbackKind; target_id: string }
export const feedbackKindLabels: Record<FeedbackKind, string> = { SNAPSHOT: "Readiness and business fit", SYNTHESIS: "Source assessment", RECOMMENDATION: "Recommendation", PLAN: "Next best action plan", REPLY: "Reply interpretation" };
export const replyCategoryLabels = { POSITIVE_REPLY: "Positive reply", NEGATIVE_REPLY: "Negative reply", QUESTION: "Question", OPT_OUT: "Stop contact", UNKNOWN: "Cannot determine intent" };
export type ReplyCategory = keyof typeof replyCategoryLabels;
export interface FeedbackLabels { correctness: "CORRECT" | "INCORRECT" | "UNCLEAR"; usefulness: "USEFUL" | "NOT_USEFUL" | "NOT_ASSESSED"; expected_category: ReplyCategory | null; eval_use: "OPERATIONAL_ONLY" | "SYNTHETIC" | "PERMISSION_REVIEWED" }
export interface FeedbackRevision { id: string; revision: number; status: "RECORDED" | "WITHDRAWN"; labels: FeedbackLabels | null; reason: string; created_at: string; created_by: string }
export interface FeedbackHistory { changes: FeedbackRevision[]; has_more: boolean; next_before_revision: number | null }
export interface FeedbackReview { target: { kind: FeedbackKind; id: string; lead_id: string; status: string; created_at: string | null; version: number | null; pipeline_version: string | null; source_sha256: string | null; evaluation_input_available: boolean; presentation: { title: string; summary: string; fields: { label: string; value: string }[]; truncated: boolean } }; review_token: string | null; feedback: FeedbackRevision | null; history: FeedbackHistory; can_record: boolean; unavailable_reason: string | null }
export interface FeedbackCommand extends FeedbackTargetRef { expected_feedback_revision: number; review_token: string; request_key: string; operation: "RECORD" | "WITHDRAW"; labels: FeedbackLabels | null; reason: string }
export interface FeedbackCandidate extends FeedbackRevision, FeedbackTargetRef { lead_name: string }
export interface FeedbackCandidates { items: FeedbackCandidate[]; limit: number; has_more: boolean; next_after_feedback_id: string | null }
