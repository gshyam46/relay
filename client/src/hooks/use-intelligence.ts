import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";

export interface IntelligenceRow {
  lead_id: string;
  name: string;
  email: string | null;
  company: string | null;
  source: string;
  lead_status: string;
  intelligence_status: string;
  intelligence_at: string | null;
  recommendation_status: string;
  nba_status: string | null;
  nba_action_type: string | null;
  nba_title: string | null;
}

export interface IntelligenceTotals {
  total: number;
  not_run: number;
  pending: number;
  completed: number;
  failed: number;
  with_recommendation: number;
  with_nba: number;
  /**
   * How many leads a bulk analysis would actually process, computed server-side
   * by the same helper the bulk-run endpoint uses.
   *
   * Do NOT use `not_run` for this. That counts leads with no intelligence
   * SNAPSHOT, and every lead gets one the moment it is created, so it is
   * effectively always 0 — which is what left the bulk action permanently
   * disabled.
   */
  eligible_for_analysis: number;
}

interface IntelligenceSummaryResponse {
  leads: IntelligenceRow[];
  totals: IntelligenceTotals;
  /** The exact ids behind `eligible_for_analysis`, so a bulk run does not have
   *  to make the server scan for eligibility a second time. */
  eligible_lead_ids: string[];
}

export function useIntelligenceSummary() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  return useQuery({
    queryKey: ["intelligence-summary", org?.id],
    queryFn: () =>
      api.get<IntelligenceSummaryResponse>(
        `/intelligence/summary?organization_id=${org!.id}`,
      ),
    enabled: !!org,
    refetchInterval: 30_000,
  });
}

/**
 * Runs the COMPLETE intelligence pipeline for one lead:
 * intelligence -> synthesis -> recommendation -> next best action, and creates
 * the outbound action when the plan calls for one.
 *
 * This goes through the bulk endpoint with a single id rather than
 * `/intelligence/run`, deliberately. `/intelligence/run` only refreshes the
 * data-readiness snapshot, so a lead analysed that way never reached
 * "recommendation ready" and the workspace could not take a lead through the
 * pipeline at all. Reusing the bulk endpoint also means there is exactly one
 * implementation of the pipeline order.
 */
export function useAnalyzeLead() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (leadId: string) =>
      api.post<BulkRunResult>("/intelligence/bulk-run", {
        organization_id: org!.id,
        lead_ids: [leadId],
      }),
    onSuccess: () => {
      for (const key of [
        "intelligence-summary",
        "lead-intelligence",
        "lead-outbound",
        "outbound-summary",
        "lead-timeline",
        "activity-feed",
        "dashboard",
        "dashboard-attention",
      ]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

export interface BulkRunResult {
  organization_id: string;
  eligible: number;
  processed: number;
  remaining: number;
  succeeded: number;
  failed: number;
  results: { lead_id: string; status: string; error?: string; action_id?: string | null }[];
}

export function useBulkRunIntelligence() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (leadIds?: string[]) =>
      api.post<BulkRunResult>("/intelligence/bulk-run", {
        organization_id: org!.id,
        ...(leadIds ? { lead_ids: leadIds } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["intelligence-summary"] });
      qc.invalidateQueries({ queryKey: ["lead-intelligence"] });
      qc.invalidateQueries({ queryKey: ["outbound-summary"] });
      qc.invalidateQueries({ queryKey: ["lead-outbound"] });
      qc.invalidateQueries({ queryKey: ["lead-timeline"] });
      qc.invalidateQueries({ queryKey: ["activity-feed"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["dashboard-attention"] });
    },
  });
}

export function useRunFullPipeline() {
  // Kept as a named export because the lead detail page reads better calling
  // "run the full pipeline", but it is the same single server-side pipeline as
  // useAnalyzeLead. It used to issue five sequential requests from the browser,
  // which duplicated the pipeline ORDER on the client and could leave a lead
  // half-analysed if one of them failed.
  return useAnalyzeLead();
}
