import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";

export interface FollowUp {
  id: string;
  lead_id: string;
  action_id: string | null;
  reason: string;
  status: string;
  due_at: string;
  created_at: string;
  completed_at: string | null;
  escalated: boolean | number;
  lead_name: string;
  lead_email: string | null;
  lead_company: string | null;
}

export interface FollowUpTotals {
  total: number;
  by_status: Record<string, number>;
}

interface FollowUpSummaryResponse {
  follow_ups: FollowUp[];
  totals: FollowUpTotals;
}

export function useFollowUpSummary() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  return useQuery({
    queryKey: ["follow-up-summary", org?.id],
    queryFn: () =>
      api.get<FollowUpSummaryResponse>(
        `/follow-ups/summary?organization_id=${org!.id}`,
      ),
    enabled: !!org,
    refetchInterval: 30_000,
  });
}

export function useCompleteFollowUp() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (followUpId: string) =>
      api.post(`/follow-ups/${followUpId}/complete`, {
        organization_id: org!.id,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["follow-up-summary"] });
      qc.invalidateQueries({ queryKey: ["lead-timeline"] });
      qc.invalidateQueries({ queryKey: ["activity-feed"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["dashboard-attention"] });
    },
  });
}

export function useCancelFollowUp() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (followUpId: string) =>
      api.post(`/follow-ups/${followUpId}/cancel`, {
        organization_id: org!.id,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["follow-up-summary"] });
      qc.invalidateQueries({ queryKey: ["lead-timeline"] });
      qc.invalidateQueries({ queryKey: ["activity-feed"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["dashboard-attention"] });
    },
  });
}
