import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";
import type { FeedbackCandidates, FeedbackHistory, FeedbackReview, FeedbackTargetRef } from "@/types/intelligence-feedback";
export function feedbackParams(target: FeedbackTargetRef) { return new URLSearchParams({ ...target }).toString(); }
export function useFeedbackTarget(target: FeedbackTargetRef) {
  const org = useWorkspaceStore(s => s.currentOrg);
  return useQuery({ queryKey: ["feedback-target", org?.id, target.lead_id, target.target_kind, target.target_id], queryFn: () => api.get<FeedbackReview>("/intelligence-feedback/target?" + feedbackParams(target)), enabled: Boolean(org), retry: false, refetchOnWindowFocus: "always" });
}
export function useFeedbackHistory(target: FeedbackTargetRef, before: number | null, enabled: boolean) {
  const org = useWorkspaceStore(s => s.currentOrg);
  return useQuery({ queryKey: ["feedback-history", org?.id, target.lead_id, target.target_kind, target.target_id, before], queryFn: async () => (await api.get<{ history: FeedbackHistory }>("/intelligence-feedback/history?" + feedbackParams(target) + "&limit=20" + (before === null ? "" : "&before_revision=" + before))).history, enabled: Boolean(org && enabled), retry: false });
}
export function useFeedbackCandidates(after: string | null) {
  const org = useWorkspaceStore(s => s.currentOrg);
  return useQuery({ queryKey: ["feedback-candidates", org?.id, after], queryFn: () => api.get<FeedbackCandidates>("/intelligence-feedback/candidates?limit=20" + (after ? "&after_feedback_id=" + encodeURIComponent(after) : "")), enabled: Boolean(org), retry: false, refetchOnWindowFocus: "always" });
}
export function feedbackError(error: unknown) {
  const code = error instanceof ApiError && error.body && typeof error.body === "object" ? (error.body as { code?: string }).code : null;
  if (code === "FEEDBACK_REVISION_STALE" || code === "FEEDBACK_REVIEW_STALE") return "The saved review or artifact changed. Your draft is retained; check the saved version before deciding again.";
  if (code === "FEEDBACK_REQUEST_CONFLICT") return "This request reference belongs to different saved input. Check its recorded result before making another decision.";
  if (code === "FEEDBACK_EVALUATION_INPUT_REQUIRED") return "Usable original reply text is required for evaluation nomination. Keep this review operational only.";
  if (code === "FEEDBACK_INVALID_INPUT") return "The review was rejected. Check the judgments, nomination and required reason.";
  if (code?.includes("OWNER") || error instanceof ApiError && error.status === 403) return "A current workspace owner must review this assessment.";
  if (code?.includes("NOT_FOUND")) return "The exact saved assessment is unavailable in this workspace.";
  return "The request outcome could not be confirmed. Your draft and request reference remain; check saved state before retrying.";
}
export function feedbackUnavailable(code: string | null) {
  return code === "FEEDBACK_REVIEW_STALE" ? "The saved artifact no longer matches this captured review. Earlier feedback remains in history; this stream cannot silently adopt changed content." : code === "FEEDBACK_REVISION_LIMIT" ? "This assessment has reached its review-history limit. Existing reviews remain available." : code === "FEEDBACK_TARGET_TOO_LARGE" ? "This historical assessment is too large for a bounded review. Its original record remains unchanged." : "The exact assessment or required source information is incomplete. It cannot be reviewed as a reliable captured target.";
}
