import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";

export interface AiStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
}

export interface OrgSettings {
  settings: Record<string, Record<string, unknown>>;
  ai_status: AiStatus;
}

export function useSettings() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  return useQuery({
    queryKey: ["settings", org?.id],
    queryFn: () => api.get<OrgSettings>(`/settings?organization_id=${org!.id}`),
    enabled: !!org,
  });
}

export function useUpdateSettings() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { category: string; values: Record<string, unknown> }) =>
      api.put(`/settings`, {
        organization_id: org!.id,
        ...payload,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}
