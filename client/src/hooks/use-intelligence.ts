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
}

interface IntelligenceSummaryResponse {
  leads: IntelligenceRow[];
  totals: IntelligenceTotals;
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

export function useRunIntelligence() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (leadId: string) =>
      api.post(`/leads/${leadId}/intelligence/run`, {
        organization_id: org!.id,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["intelligence-summary"] });
      qc.invalidateQueries({ queryKey: ["lead-intelligence"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
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
  const org = useWorkspaceStore((s) => s.currentOrg);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leadId: string) => {
      const orgId = org!.id;
      await api.post(`/leads/${leadId}/intelligence/run`, { organization_id: orgId });
      await api.post(`/leads/${leadId}/synthesis/run`, { organization_id: orgId });
      await api.post(`/leads/${leadId}/intelligence-recommendation/run`, { organization_id: orgId });
      const planRes = await api.post<{ next_best_action_plan: { id: string; status: string } }>(
        `/leads/${leadId}/next-best-action/plan`,
        { organization_id: orgId },
      );
      const plan = planRes.next_best_action_plan;
      if (plan?.status === "PLANNED") {
        try {
          await api.post(`/next-best-action-plans/${plan.id}/action`, { organization_id: orgId });
        } catch {
          // action may already exist for this plan (idempotent) or plan state moved on
        }
      }
      return planRes;
    },
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
