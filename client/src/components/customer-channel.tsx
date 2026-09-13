import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";
import { LoadingState } from "./loading-screen";

type Channel = "email" | "whatsapp" | "sms" | "telegram" | "call";
type Status = { status: string; capability: { can_dispatch: boolean; verification: string } };
const names: Record<Channel, string> = { email: "Email", whatsapp: "WhatsApp", sms: "SMS", telegram: "Telegram", call: "Calling" };
export function CustomerChannel({ channel }: { channel: Channel }) {
  const org = useWorkspaceStore(s => s.currentOrg);
  const query = useQuery({ queryKey: ["customer-channel-status", org?.id, channel], queryFn: () => api.get<Status>("/settings/channels/test?channel=" + channel), enabled: Boolean(org) && channel === "email", retry: false, refetchOnWindowFocus: "always" });
  const status = query.data;
  return <section className="max-w-2xl space-y-5" aria-label={names[channel] + " availability"}>
    <h2 className="text-lg font-semibold">{names[channel]}</h2>
    {channel !== "email" ? <><p className="inline-block rounded-full bg-soft px-3 py-1 text-sm font-medium">{channel === "call" ? "Live calling unavailable" : "Live messaging unavailable"}</p><p className="text-sm text-muted">{names[channel]} is not available for real customer outreach in this version. There is no live connection to set up here.</p><p className="text-sm text-muted">{channel === "telegram" ? "Telegram sending and replies are not implemented." : "Any Sandbox activity is a simulation. It does not contact your customers."}</p><Link className="inline-block text-sm text-brand underline" to="/settings?tab=email">Review email availability</Link></> : query.isError ? <><p role="alert" className="text-sm text-warn">Email availability could not be checked. Do not assume email is ready to send.</p></> : !status ? <LoadingState label="Checking email availability"/> : <>
      <p className="inline-block rounded-full bg-soft px-3 py-1 text-sm font-medium">{status.status === "sandbox" ? "Sandbox - simulated email only" : status.capability.verification === "VERIFIED" && status.capability.can_dispatch ? "Email connection verified" : "Email setup needs attention"}</p>
      <p className="text-sm text-muted">{status.status === "sandbox" ? "You can try the email workflow without sending real messages. Live email has not been connected for this workspace." : status.capability.verification === "VERIFIED" && status.capability.can_dispatch ? "The current email connection has passed its required checks. Sending still depends on workspace controls, contact permission and your approval of each message." : "Live email is unavailable until setup and delivery checks are complete. The team operating this application needs to finish the connection."}</p>
      <Link className="inline-block text-sm text-brand underline" to="/settings?tab=sending">Review sending controls</Link>
    </>}
    {channel === "email" && <button type="button" className="rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh email status</button>}
  </section>;
}
