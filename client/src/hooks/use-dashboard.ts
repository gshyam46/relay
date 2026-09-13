import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";

interface LeadStats {
  total: number;
  new_count: number;
  active_count: number;
  converted_count: number;
  opted_out_count: number;
  new_last_7d: number;
  new_last_30d: number;
}

interface SourceEntry {
  source: string;
  count: number;
}

interface StatusEntry {
  status: string;
  count: number;
}

interface RecentLead {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string;
  status: string;
  created_at: string;
}

interface DailyEntry {
  day: string;
  count: number;
}

interface IntelligenceStats {
  total_snapshots: number;
  completed: number;
  pending: number;
}

export interface DashboardMetrics {
  leads: LeadStats;
  business_outcomes: {scope:"ACTIVE_ENQUIRIES";recorded_outcomes:number;withdrawn_outcomes:number;enquiries_with_recorded_outcome:number;by_kind:Record<"QUALIFIED_CONVERSATION"|"MEETING_BOOKED"|"QUOTE_REQUESTED"|"WON"|"LOST",{outcomes:number;enquiries:number}>};
  sources: SourceEntry[];
  statuses: StatusEntry[];
  pending_approvals: number;
  follow_ups_due: number;
  recent_leads: RecentLead[];
  daily_leads: DailyEntry[];
  intelligence: IntelligenceStats;
}

export function useDashboardData() {
  const org = useWorkspaceStore((s) => s.currentOrg);

  return useQuery({
    queryKey: ["dashboard", org?.id],
    queryFn: () =>
      api.get<DashboardMetrics>(
        `/dashboard/metrics?organization_id=${org!.id}`,
      ),
    enabled: !!org,
    refetchInterval: 30_000,
  });
}

export interface AttentionItem {
  lead_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string;
  status: string;
  reason: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
}

export function useAttentionQueue() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  return useQuery({
    queryKey: ["dashboard-attention", org?.id],
    queryFn: () =>
      api.get<{ items: AttentionItem[]; total: number }>(
        `/dashboard/attention?organization_id=${org!.id}`,
      ),
    enabled: !!org,
    refetchInterval: 30_000,
  });
}
