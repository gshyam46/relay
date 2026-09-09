import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";

export interface ChannelStatus {
  channel: string;
  provider: string;
  configured: boolean;
  status: "ready" | "sandbox";
}

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

export function useChannelStatus(channel: string) {
  const org = useWorkspaceStore((s) => s.currentOrg);
  return useQuery({
    queryKey: ["channel-status", org?.id, channel],
    queryFn: () =>
      api.get<ChannelStatus>(
        `/settings/channels/test?organization_id=${org!.id}&channel=${channel}`,
      ),
    enabled: !!org,
  });
}

export interface EmailWebhooks {
  inbound_path: string;
  events_path: string;
}

export function useEmailWebhooks(enabled: boolean) {
  const org = useWorkspaceStore((s) => s.currentOrg);
  return useQuery({
    queryKey: ["email-webhooks", org?.id],
    queryFn: () => api.get<EmailWebhooks>(`/settings/channels/email/webhooks?organization_id=${org!.id}`),
    enabled: !!org && enabled,
  });
}
