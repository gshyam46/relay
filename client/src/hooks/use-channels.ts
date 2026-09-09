import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";

export interface ChannelMessage {
  id: string;
  lead_id: string;
  lead_name: string | null;
  lead_company: string | null;
  direction: "INBOUND" | "OUTBOUND";
  channel: string;
  status: string;
  subject: string | null;
  body: string | null;
  summary: string | null;
  provider: string;
  occurred_at: string;
  classification_event_type: string | null;
  classification_confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  suggested_next_step: string | null;
}

export function useChannelMessages(options: { channel?: string; direction?: string } = {}) {
  const org = useWorkspaceStore((s) => s.currentOrg);
  const params = new URLSearchParams();
  if (org) params.set("organization_id", org.id);
  if (options.channel) params.set("channel", options.channel);
  if (options.direction) params.set("direction", options.direction);

  return useQuery({
    queryKey: ["channel-messages", org?.id, options],
    queryFn: async () => {
      const res = await api.get<{ messages: ChannelMessage[] }>(`/channels/messages?${params}`);
      return res.messages;
    },
    enabled: !!org,
    refetchInterval: 15_000,
  });
}

export interface SimulateInboundInput {
  lead_id: string;
  channel: "EMAIL" | "WHATSAPP" | "SMS" | "VOICE";
  /** Omit to have the server's reply classifier derive this from `text`. */
  event_type?: "POSITIVE_REPLY" | "NEGATIVE_REPLY" | "QUESTION" | "OPT_OUT" | "UNKNOWN";
  text?: string;
}

export interface SimulateInboundResult {
  duplicate: boolean;
  classification: {
    event_type: string;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    reason: string;
    suggested_next_step?: string;
  } | null;
}

export function useSimulateInbound() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SimulateInboundInput) =>
      api.post<SimulateInboundResult>("/inbound-events/mock", {
        organization_id: org!.id,
        lead_id: input.lead_id,
        channel: input.channel,
        event_type: input.event_type,
        provider_event_id: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        payload: input.text ? { text: input.text } : {},
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channel-messages"] });
      qc.invalidateQueries({ queryKey: ["lead-timeline"] });
      qc.invalidateQueries({ queryKey: ["follow-up-summary"] });
      qc.invalidateQueries({ queryKey: ["activity-feed"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["dashboard-attention"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}
