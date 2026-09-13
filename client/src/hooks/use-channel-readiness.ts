import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";
import type { EmailConnectionHistory, EmailConnectionState } from "@/types/channel-readiness";

export const emailConnectionPath = "/settings/channels/email/connection";
export function useEmailConnection(enabled: boolean) {
  const org = useWorkspaceStore(s => s.currentOrg);
  return useQuery({ queryKey: ["email-connection", org?.id], queryFn: () => api.get<EmailConnectionState>(emailConnectionPath), enabled: Boolean(org && enabled), retry: false, refetchOnWindowFocus: "always" });
}
export function useEmailConnectionHistory(before: number | null) {
  const org = useWorkspaceStore(s => s.currentOrg);
  return useQuery({ queryKey: ["email-connection-history", org?.id, before], queryFn: async () => (await api.get<{ history: EmailConnectionHistory }>(emailConnectionPath + "/history?limit=20" + (before === null ? "" : "&before_revision=" + before))).history, enabled: Boolean(org), retry: false });
}
export function useInvalidateEmailConnection() {
  const client = useQueryClient();
  return () => {
    for (const key of ["email-connection", "email-connection-history", "settings", "channel-status", "lead-outbound", "outbound-summary", "lead-timeline", "activity-feed", "approval-review"]) void client.invalidateQueries({ queryKey: [key] });
  };
}
export function connectionErrorCode(error: unknown) {
  return error instanceof ApiError && error.body && typeof error.body === "object" ? String((error.body as { code?: string }).code || "") : "";
}
export function connectionIssue(code: string) {
  if (code === "CHANNEL_ROUTE_AMBIGUOUS") return "Callback routing has ambiguous workspace ownership. The application operator must resolve it before webhook URLs can be provisioned or rotated.";
  if (code === "EMAIL_CONNECTION_STATE_INVALID" || code === "EMAIL_CONNECTION_SETTINGS_LIMIT") return "Saved connection metadata needs application-operator inspection. Setup changes remain held until the stored configuration can be safely reviewed.";
  if (code === "CHANNEL_SETUP_REQUIRED") return "Complete the missing local setup fields before preparing supported provider drafts. Live sending remains held.";
  if (code === "CHANNEL_LIVE_DISABLED") return "This isolated environment permits Sandbox changes only. Live provider configuration and sending are disabled.";
  if (/STALE|DRIFT/.test(code)) return "Saved setup changed. Your draft remains; review the latest saved settings and revision before deciding again.";
  if (/OWNER|FORBIDDEN/.test(code)) return "Only a current workspace owner can manage this connection.";
  if (/REQUEST_CONFLICT/.test(code)) return "This request reference belongs to different saved input. Check its recorded result before starting a new change.";
  if (/ROUTE_LIMIT|ALIAS_LIMIT/.test(code)) return "All 10 routing aliases have been used. Existing signed callback routes remain valid.";
  if (/REVISION_LIMIT/.test(code)) return "This connection has reached its 100-change history limit. Existing setup and history remain available.";
  if (/ORIGIN/.test(code)) return "The application operator must configure a valid public application origin before public webhook URLs can be shown.";
  if (/VERIFICATION/.test(code)) return "Live sending is held until the supported provider verification workflow is completed. Saved configuration does not unlock sending.";
  if (/UNSUPPORTED|PROVIDER/.test(code)) return "This live provider is unavailable. Existing configuration is retained; choose Sandbox explicitly for simulation.";
  if (/INVALID|INCOMPLETE/.test(code)) return "Review the sender and reply mailboxes, supported provider, public keys and required reason. A saved incomplete setup does not enable live sending.";
  if (/HARNESS|LIVE/.test(code)) return "This isolated environment permits Sandbox changes only. Live provider configuration and sending are disabled.";
  if (/ROUTE.*EXISTS/.test(code)) return "A managed route already exists. Review the current URLs before requesting a rotation.";
  if (/ROUTE.*REQUIRED|NOT_PROVISIONED/.test(code)) return "Provision managed webhook URLs before requesting a rotation.";
  if (/LIMIT|CORRUPT/.test(code)) return "Saved setup exceeds the supported review bounds or needs operator repair. Changes are held; existing records remain available.";
  return "The request outcome could not be confirmed. Keep this request reference and check its saved result before retrying.";
}
