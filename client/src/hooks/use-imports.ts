import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";
import type { IdentityCommand, IdentityResolution, IdentityReview, ImportSources, CsvInspection, ImportBatch, ImportDetail, ImportMapping, ImportOptions, ImportTarget } from "@/types/imports";
export function useImports() {
  const org = useWorkspaceStore(s => s.currentOrg);
  return useQuery({ queryKey: ["imports", org?.id], queryFn: () => api.get<{ imports: ImportBatch[]; has_more: boolean; limit: number }>("/imports"), enabled: !!org, retry: false });
}
export function useImport(id: string) {
  const org = useWorkspaceStore(s => s.currentOrg);
  return useQuery({ queryKey: ["import", org?.id, id], queryFn: () => api.get<ImportDetail>("/imports/" + encodeURIComponent(id)), enabled: !!org && !!id, retry: false });
}
export function useImportOperations() {
  const org = useWorkspaceStore(s => s.currentOrg);
  const qc = useQueryClient();
  function update(result: ImportDetail) {
    qc.setQueryData(["import", org?.id, result.import_id], result);
    void qc.invalidateQueries({ queryKey: ["imports", org?.id] });
    return result;
  }
  function refreshData() {
    for (const key of ["lead-directory", "lead", "leads", "intelligence-summary", "lead-intelligence", "dashboard", "dashboard-attention", "activity-feed", "lead-timeline", "lead-import-sources"])
      void qc.invalidateQueries({ queryKey: [key] });
  }
  return {
    inspect: (input: { filename: string; csv_text: string }) => api.post<CsvInspection>("/imports/csv/inspect", input),
    preview: async (input: { filename: string; csv_text: string; default_phone_region: string; mapping: ImportMapping; options: ImportOptions }) => update(await api.post<ImportDetail>("/imports/csv/preview", input)),
    correct: async (id: string, rowId: string, input: { expected_revision: number; values: Partial<Record<ImportTarget, string | null>>; reason: string }) => update(await api.put<ImportDetail>("/imports/" + encodeURIComponent(id) + "/rows/" + encodeURIComponent(rowId), input)),
    commit: async (id: string, input: { expected_revision: number; selected_row_ids: string[] }) => { const result = update(await api.post<ImportDetail>("/imports/" + encodeURIComponent(id) + "/commit", input)); refreshData(); return result; },
    reviewIdentity: (id: string, rowId: string) => api.get<IdentityReview>("/imports/" + encodeURIComponent(id) + "/rows/" + encodeURIComponent(rowId) + "/identity-review"),
    resolveIdentity: async (id: string, rowId: string, input: IdentityCommand) => { const result = await api.post<{ resolution: IdentityResolution; import: ImportDetail }>("/imports/" + encodeURIComponent(id) + "/rows/" + encodeURIComponent(rowId) + "/identity-resolution", input); update(result.import); refreshData(); return result; },
    refreshData,
  };
}

export function useLeadImportSources(id: string) {
  const org = useWorkspaceStore(s => s.currentOrg);
  return useQuery({ queryKey: ["lead-import-sources", org?.id, id], queryFn: () => api.get<ImportSources>("/leads/" + encodeURIComponent(id) + "/import-sources"), enabled: !!org && !!id, retry: false });
}
