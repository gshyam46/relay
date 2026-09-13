import type { BusinessFitSummary, AttentionPriority, FitRanking } from "@/types/business-fit";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";
import { intelligenceRecheckDelay, type IntelligenceCurrentness } from "@/types/intelligence-currentness";
export interface IntelligenceRow { lead_id: string; name: string; email: string | null; company: string | null; source: string; lead_status: string; intelligence_status: string; intelligence_at: string | null; recommendation_status: string; nba_status: string | null; nba_action_type: string | null; nba_title: string | null; currentness: IntelligenceCurrentness; business_fit: BusinessFitSummary | null; attention_priority: AttentionPriority | null }
export interface IntelligenceTotals { total: number; not_run: number; pending: number; completed: number; failed: number; with_recommendation: number; with_nba: number; eligible_for_analysis: number }
export interface IntelligenceSummaryResponse { leads: IntelligenceRow[]; totals: IntelligenceTotals; eligible_lead_ids: string[]; ranking: FitRanking }
export function useIntelligenceSummary(afterLeadId?: string) {
  const org = useWorkspaceStore(s => s.currentOrg);
  return useQuery({ queryKey: ["intelligence-summary", org?.id, afterLeadId], queryFn: () => api.get<IntelligenceSummaryResponse>("/intelligence/summary?organization_id=" + org!.id + (afterLeadId ? "&after_lead_id=" + encodeURIComponent(afterLeadId) : "")), enabled: !!org, refetchInterval: query => intelligenceRecheckDelay(query.state.data?.leads.map(row => row.currentness) || []), refetchIntervalInBackground: false, refetchOnWindowFocus: "always", retry: false });
}
export interface AnalysisRunItem { lead_id: string; status: "COMPLETED" | "FAILED"; reused: boolean; currentness?: IntelligenceCurrentness; code?: string; error?: string; action_id?: string | null }
export interface BulkRunResult { organization_id: string; eligible: number; processed: number; remaining: number; succeeded: number; failed: number; results: AnalysisRunItem[] }
const refreshKeys = ["intelligence-summary", "lead-intelligence", "lead-intelligence-history", "lead", "leads", "lead-directory", "lead-outbound", "outbound-summary", "lead-timeline", "activity-feed", "dashboard", "dashboard-attention"];
export function useAnalyzeLead() {
  const org = useWorkspaceStore(s => s.currentOrg), qc = useQueryClient();
  return useMutation({ mutationFn: (leadId: string) => api.post<BulkRunResult>("/intelligence/bulk-run", { organization_id: org!.id, lead_ids: [leadId] }), retry: false, onSettled: () => { for (const key of refreshKeys) void qc.invalidateQueries({ queryKey: [key] }); } });
}
export function useBulkRunIntelligence() {
  const org = useWorkspaceStore(s => s.currentOrg), qc = useQueryClient();
  return useMutation({ mutationFn: (leadIds?: string[]) => api.post<BulkRunResult>("/intelligence/bulk-run", { organization_id: org!.id, ...(leadIds ? { lead_ids: leadIds } : {}) }), retry: false, onSettled: () => { for (const key of refreshKeys) void qc.invalidateQueries({ queryKey: [key] }); } });
}
export function useRunFullPipeline() { return useAnalyzeLead(); }
export function analysisFailure(code?: string) {
  const messages: Record<string, string> = { not_found: "This lead is unavailable in the current workspace.", INTELLIGENCE_CONTEXT_CHANGED: "Saved inputs changed during analysis. Check current state before trying again.", LEAD_DATA_STALE: "Contact details changed during analysis. Check current state before trying again.", FRESHNESS_CLOCK_INVALID: "The assessment clock needs operational review before analysis can continue.", LEAD_ARCHIVED: "This record is archived. Restore it before refreshing analysis.", FRESHNESS_STATE_INVALID: "Saved freshness information needs operational review. No current result was confirmed.", FRESHNESS_INPUT_LIMIT: "The saved evidence exceeds the supported review limit. Operational review is required.", INTELLIGENCE_INPUT_CHANGED: "The saved inputs changed during analysis. Check current state before trying again.", LEAD_DATA_REVISION_STALE: "The contact details changed during analysis. Check current state before trying again.", FRESHNESS_INPUT_CHANGED: "The source state changed during analysis. Check current state before trying again.", ANALYSIS_FAILED: "Analysis could not complete. Check saved state before retrying." };
  return code && messages[code] || "Analysis could not complete. Check saved state before retrying.";
}
export function analysisRequestError(error: unknown): string {
  if (error instanceof ApiError) { if (error.status === 403) return "A current workspace owner is required to refresh analysis."; if (error.status === 409) return "Saved inputs or eligibility changed. Check current state before retrying."; if (error.status === 503) return "Current analysis state is unavailable. Check saved state before retrying."; }
  return "The analysis response could not be confirmed. Saved state will be checked; do not assume the request was undone.";
}
export function analysisResultText(result: BulkRunResult): string { const reused = result.results.filter(item => item.status === "COMPLETED" && item.reused).length; return Math.max(0, result.succeeded - reused) + " completed; " + reused + " reused from unchanged saved inputs; " + result.failed + " failed; " + result.remaining + " not processed in this request."; }
