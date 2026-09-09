import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";

export interface ActivityEvent {
  event_type: string;
  message: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  lead_id: string | null;
  lead_name: string | null;
}

interface ActivityFeedResponse {
  events: ActivityEvent[];
}

export function useActivityFeed(limit = 50) {
  const org = useWorkspaceStore((s) => s.currentOrg);
  return useQuery({
    queryKey: ["activity-feed", org?.id, limit],
    queryFn: () =>
      api.get<ActivityFeedResponse>(
        `/activity/feed?organization_id=${org!.id}&limit=${limit}`,
      ),
    enabled: !!org,
    refetchInterval: 15_000,
  });
}
