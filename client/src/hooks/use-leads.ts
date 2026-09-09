import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";
import type { Lead } from "@/types";

interface UseLeadsOptions {
  search?: string;
  source?: string;
  status?: string;
}

export function useLeads(options: UseLeadsOptions = {}) {
  const org = useWorkspaceStore((s) => s.currentOrg);
  const params = new URLSearchParams();
  if (org) params.set("organization_id", org.id);
  if (options.search) params.set("search", options.search);
  if (options.source) params.set("source", options.source);
  if (options.status) params.set("status", options.status);

  return useQuery({
    queryKey: ["leads", org?.id, options],
    queryFn: async () => {
      const res = await api.get<{ leads: Lead[] }>(`/leads?${params}`);
      return res.leads;
    },
    enabled: !!org,
  });
}

export function useLead(id: string | undefined) {
  const org = useWorkspaceStore((s) => s.currentOrg);
  return useQuery({
    queryKey: ["lead", id, org?.id],
    queryFn: async () => {
      const res = await api.get<{ lead: Lead }>(`/leads/${id}?organization_id=${org!.id}`);
      return res.lead;
    },
    enabled: !!id && !!org,
  });
}

export interface SynthesisFinding {
  field: string;
  value: string;
  source: string;
  confidence: string;
  evidence_refs: string[];
}

export interface Synthesis {
  id: string;
  status: string;
  summary: { text: string; evidence_refs: string[] };
  findings: SynthesisFinding[];
  qualification: { outcome: string; reasons: string[]; missing: string[]; evidence_refs: string[] };
  recommendation: { type: string; reason: string; evidence_refs: string[] };
  evidence_refs: string[];
}

export interface IntelligenceRecommendation {
  id: string;
  status: string;
  priority: { score: number; label: string; reason: string; evidence_refs: string[] };
  segment: { type: string; label: string; reason: string; evidence_refs: string[] };
  personalization_context: { label: string; value: string; evidence_refs: string[] }[];
  recommendation: { step: string; label: string; reason: string; evidence_refs: string[] };
  evidence_refs: string[];
}

export interface NextBestActionPlan {
  id: string;
  status: string;
  action_type: string;
  title: string;
  rationale: string;
  policy_decision: { decision: string; reasons: string[] };
  approval: { requirement: string; reason?: string };
  decision_evidence_refs: string[];
}

export interface LeadIntelligence {
  lead_id: string;
  organization_id: string;
  lead_status: string;
  intelligence_status: string;
  readiness: {
    status: string;
    score: number;
    factors: { label: string; status: string; available: boolean }[];
    missing: string[];
    reasons: string[];
    blocking_reasons: string[];
  };
  snapshot: {
    status: string;
    evidence?: { id: string; claim_field: string; claim_value: string; source_type: string; title?: string }[];
    claims?: { id: string; field: string; value: string; confidence: string }[];
    signals?: { id: string; type: string; value: string }[];
  } | null;
  synthesis: Synthesis | null;
  synthesis_status: string;
  recommendation: IntelligenceRecommendation | null;
  recommendation_status: string;
  next_best_action: NextBestActionPlan | null;
  next_best_action_status: string;
  intelligence: unknown;
}

export interface TimelineEntry {
  kind: "message" | "follow_up";
  id: string;
  timestamp: string;
  message: string;
  title?: string;
  channel?: string;
  direction?: "INBOUND" | "OUTBOUND";
  status?: string;
  classification_event_type?: string | null;
  classification_confidence?: "HIGH" | "MEDIUM" | "LOW" | null;
  suggested_next_step?: string | null;
  escalated?: boolean;
}

export interface IntelligenceSnapshotSummary {
  id: string;
  version: number;
  status: string;
  readiness_status: string;
  readiness_score: number;
  summary: string;
  created_at: string;
}

export function useLeadIntelligenceHistory(id: string | undefined, enabled: boolean) {
  const org = useWorkspaceStore((s) => s.currentOrg);
  return useQuery({
    queryKey: ["lead-intelligence-history", id, org?.id],
    queryFn: async () => {
      const res = await api.get<{ snapshots: IntelligenceSnapshotSummary[] }>(
        `/leads/${id}/intelligence/history?organization_id=${org!.id}`,
      );
      return res.snapshots;
    },
    enabled: !!id && !!org && enabled,
  });
}

export function useLeadIntelligence(id: string | undefined) {
  const org = useWorkspaceStore((s) => s.currentOrg);
  return useQuery({
    queryKey: ["lead-intelligence", id, org?.id],
    queryFn: () =>
      api.get<LeadIntelligence>(
        `/leads/${id}/intelligence?organization_id=${org!.id}`,
      ),
    enabled: !!id && !!org,
  });
}

export function useLeadTimeline(id: string | undefined) {
  const org = useWorkspaceStore((s) => s.currentOrg);
  return useQuery({
    queryKey: ["lead-timeline", id, org?.id],
    queryFn: async () => {
      const res = await api.get<{ timeline: { message: string; occurred_at?: string; timestamp?: string; [k: string]: unknown }[] }>(
        `/leads/${id}/timeline?organization_id=${org!.id}`,
      );
      return res.timeline.map((e) => ({
        ...e,
        timestamp: e.timestamp || e.occurred_at || "",
        message: e.message || "",
      })) as TimelineEntry[];
    },
    enabled: !!id && !!org,
  });
}

export function useCreateLead() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; email?: string; phone?: string; company?: string }) =>
      api.post<{ lead: Lead }>("/leads", {
        organization_id: org!.id,
        ...data,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
