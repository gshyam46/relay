import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";

export interface DispatchTiming {
  next_attempt_at?: string | null;
  scheduled_at?: string | null;
  retry_deadline_at?: string | null;
  execution_hold_reason?: string | null;
  execution_outcome?: string | null;
  execution_attempt?: number | null;
  max_attempts?: number;
}

export interface OutboundAction extends DispatchTiming {
  action_id: string;
  lead_id: string;
  lead_name: string;
  lead_email: string | null;
  lead_company: string | null;
  type: string;
  status: string;
  approval_requirement: string;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  approval: {
    id: string;
    action_id: string;
    status: string;
    reviewer_name: string | null;
    reviewer_note: string | null;
    created_at: string;
    decided_at: string | null;
  } | null;
}

export interface OutboundTotals {
  total: number;
  by_type: Record<string, number>;
  by_status: Record<string, number>;
  pending_approval: number;
}

interface OutboundSummaryResponse {
  actions: OutboundAction[];
  totals: OutboundTotals;
}

export function useOutboundSummary() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  return useQuery({
    queryKey: ["outbound-summary", org?.id],
    queryFn: () =>
      api.get<OutboundSummaryResponse>(
        `/outbound/summary?organization_id=${org!.id}`,
      ),
    enabled: !!org,
    refetchInterval: 30_000,
  });
}

export interface LeadOutboundAction extends DispatchTiming {
  id: string;
  lead_id: string;
  type: string;
  status: string;
  approval_requirement: string;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  approval: {
    id: string;
    status: string;
    reviewer_name: string | null;
    reviewer_note: string | null;
    created_at: string;
    decided_at: string | null;
  } | null;
  executions: { id: string; status: string; attempt: number; provider: string | null; created_at: string; outcome_class?: string }[];
  callbacks: { id: string; status: string; created_at: string }[];
}

export function useLeadOutboundActions(leadId: string | undefined) {
  const org = useWorkspaceStore((s) => s.currentOrg);
  return useQuery({
    queryKey: ["lead-outbound", leadId, org?.id],
    queryFn: async () => {
      const res = await api.get<{ actions: LeadOutboundAction[] }>(
        `/leads/${leadId}/outbound?organization_id=${org!.id}`,
      );
      return res.actions;
    },
    enabled: !!leadId && !!org,
  });
}

export function useApproveAction() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ actionId, expectedRevisionId }: { actionId: string; expectedRevisionId: string }) =>
      api.post(`/actions/${actionId}/approval/approve`, {
        organization_id: org!.id,
        expected_revision_id: expectedRevisionId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["outbound-summary"] });
      qc.invalidateQueries({ queryKey: ["lead-outbound"] });
      qc.invalidateQueries({ queryKey: ["lead-timeline"] });
      qc.invalidateQueries({ queryKey: ["activity-feed"] });
    },
  });
}

export function useRejectAction() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ actionId, expectedRevisionId }: { actionId: string; expectedRevisionId: string }) =>
      api.post(`/actions/${actionId}/approval/reject`, {
        organization_id: org!.id,
        expected_revision_id: expectedRevisionId,
        reviewer_note: "Rejected from UI",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["outbound-summary"] });
      qc.invalidateQueries({ queryKey: ["lead-outbound"] });
      qc.invalidateQueries({ queryKey: ["lead-timeline"] });
      qc.invalidateQueries({ queryKey: ["activity-feed"] });
    },
  });
}

export function useExecuteAction() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (actionId: string) =>
      api.post(`/actions/${actionId}/execute`, {
        organization_id: org!.id,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["outbound-summary"] });
      qc.invalidateQueries({ queryKey: ["lead-outbound"] });
      qc.invalidateQueries({ queryKey: ["lead-timeline"] });
      qc.invalidateQueries({ queryKey: ["activity-feed"] });
    },
  });
}

export interface BulkApproveResult {
  organization_id: string;
  approved: number;
  failed: number;
  results: { action_id: string; ok: boolean; error?: string }[];
}

export function useBulkApproveActions() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (revisions: { action_id: string; expected_revision_id: string }[]) =>
      api.post<BulkApproveResult>("/actions/bulk-approve", {
        organization_id: org!.id,
        revisions,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["outbound-summary"] });
      qc.invalidateQueries({ queryKey: ["lead-outbound"] });
      qc.invalidateQueries({ queryKey: ["lead-timeline"] });
      qc.invalidateQueries({ queryKey: ["activity-feed"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["dashboard-attention"] });
    },
  });
}

export interface BulkRejectResult {
  organization_id: string;
  rejected: number;
  failed: number;
  results: { action_id: string; ok: boolean; error?: string }[];
}

export function useBulkRejectActions() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (revisions: { action_id: string; expected_revision_id: string }[]) =>
      api.post<BulkRejectResult>("/actions/bulk-reject", {
        organization_id: org!.id,
        revisions,
        reviewer_note: "Rejected in bulk from Outbound.",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["outbound-summary"] });
      qc.invalidateQueries({ queryKey: ["lead-outbound"] });
      qc.invalidateQueries({ queryKey: ["lead-timeline"] });
      qc.invalidateQueries({ queryKey: ["activity-feed"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["dashboard-attention"] });
    },
  });
}

export interface BulkExecuteResult {
  organization_id: string;
  executed: number;
  deferred: number;
  held: number;
  failed: number;
  results: { action_id: string; ok: boolean; error?: string }[];
}

export function useBulkExecuteActions() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (actionIds: string[]) =>
      api.post<BulkExecuteResult>("/actions/bulk-execute", {
        organization_id: org!.id,
        action_ids: actionIds,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["outbound-summary"] });
      qc.invalidateQueries({ queryKey: ["lead-outbound"] });
      qc.invalidateQueries({ queryKey: ["lead-timeline"] });
      qc.invalidateQueries({ queryKey: ["activity-feed"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["dashboard-attention"] });
    },
  });
}
