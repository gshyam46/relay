import type { FitCriteria } from "@/types/business-fit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";
import type { BusinessProfile, Enquiry, ProfileRevision, EnquiryRevision, ContextHistory } from "@/types/business-context";

export function contextPath(leadId?: string) { return leadId ? "/leads/" + encodeURIComponent(leadId) + "/enquiry-context" : "/business-profile"; }
export function useBusinessProfile() {
  const org = useWorkspaceStore(s => s.currentOrg);
  return useQuery({ queryKey: ["business-context", org?.id, "profile"], queryFn: () => api.get<ProfileRevision>(contextPath()), enabled: !!org, retry: false });
}
export function useEnquiryContext(leadId: string) {
  const org = useWorkspaceStore(s => s.currentOrg);
  return useQuery({ queryKey: ["business-context", org?.id, leadId], queryFn: () => api.get<EnquiryRevision>(contextPath(leadId)), enabled: !!org && !!leadId, retry: false });
}
export function useContextHistory<T>(leadId: string | undefined, before: number | undefined, enabled: boolean) {
  const org = useWorkspaceStore(s => s.currentOrg);
  return useQuery({ queryKey: ["context-history", org?.id, leadId || "profile", before],
    queryFn: () => api.get<ContextHistory<T>>(contextPath(leadId) + "/history?limit=10" + (before ? "&before_revision=" + before : "")), enabled: !!org && enabled, retry: false });
}
export function useSaveContext() {
  const org = useWorkspaceStore(s => s.currentOrg);
  const qc = useQueryClient();
  return async <T extends ProfileRevision | EnquiryRevision>(input: { expected_revision: number; reason: string; profile: BusinessProfile; fit_criteria?: FitCriteria | null } | { expected_revision: number; reason: string; enquiry: Enquiry }, leadId?: string) => {
    const saved = await api.put<T>(contextPath(leadId), input);
    qc.setQueryData(["business-context", org?.id, leadId || "profile"], saved);
    for (const key of ["context-history", "lead", "leads", "intelligence-summary", "lead-intelligence", "lead-intelligence-history", "lead-outbound", "outbound-summary", "dashboard", "dashboard-attention", "lead-timeline", "activity-feed"])
      void qc.invalidateQueries({ queryKey: [key] });
    return saved;
  };
}
