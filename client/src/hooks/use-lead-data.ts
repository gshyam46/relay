import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";
import type { ArchiveCommand, LeadDataCommand, LeadDataInput, LeadDataPreview, LeadDataResponse, LeadDataResult } from "@/types/lead-data";
export function useLeadData(id: string, before?: number) {
  const org = useWorkspaceStore(s => s.currentOrg);
  return useQuery({ queryKey: ["lead-data", org?.id, id, before], queryFn: () => api.get<LeadDataResponse>("/leads/" + encodeURIComponent(id) + "/data" + (before ? "?before_revision=" + before : "")), enabled: !!org && !!id, retry: false });
}
export function useLeadDataOperations(id: string) {
  const org = useWorkspaceStore(s => s.currentOrg), qc = useQueryClient(), base = "/leads/" + encodeURIComponent(id);
  function refresh() {
    for (const key of ["lead-data", "lead-directory", "lead", "leads", "lead-import-sources", "import", "imports", "business-context", "context-history", "intelligence-summary", "lead-intelligence", "lead-intelligence-history", "lead-outbound", "outbound-summary", "dashboard", "dashboard-attention", "lead-timeline", "activity-feed", "follow-up-summary", "workflows"])
      void qc.invalidateQueries({ queryKey: [key] });
  }
  function update(result: LeadDataResult) { qc.setQueryData(["lead-data", org?.id, id, undefined], result); refresh(); return result; }
  return {
    preview: (input: LeadDataInput) => api.post<LeadDataPreview>(base + "/data/preview", input),
    save: async (input: LeadDataCommand) => update(await api.put<LeadDataResult>(base + "/data", input)),
    archive: async (input: ArchiveCommand) => update(await api.post<LeadDataResult>(base + "/archive", input)),
    latest: async () => { const result = await api.get<LeadDataResponse>(base + "/data"); qc.setQueryData(["lead-data", org?.id, id, undefined], result); refresh(); return result; },
    refresh,
  };
}

export function leadDataError(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) return "This lead or its review changed. Your draft is preserved. Load the latest saved data and review again.";
  if (error instanceof ApiError && error.status >= 400 && error.status < 500 && typeof error.body === "object" && error.body !== null && "error" in error.body && typeof error.body.error === "string") return error.body.error;
  return error instanceof Error && !(error instanceof ApiError) ? error.message : "The request could not be confirmed. Check saved data before retrying.";
}
