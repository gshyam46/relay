import { AvailabilityNotice } from "./availability-notice";
import { isServiceUnavailable } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, Check, Circle, RefreshCw, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";

type StepId = "BUSINESS" | "ENQUIRY" | "INTELLIGENCE" | "CHANNEL" | "RECOVERY" | "REVIEW" | "WORKFLOW";
type StepState = "RECORDED" | "NEEDS_ATTENTION" | "NOT_STARTED" | "UNAVAILABLE";
interface Details {
  revision?: number; configured?: boolean; criteria_configured?: boolean; source?: string;
  snapshot?: { id: string; status: string; created_at: string } | null; currentness?: "NOT_CHECKED";
  provider?: string; configuration_complete?: boolean; verification_status?: "NOT_CHECKED"; live_send_available?: false;
  generation?: number; usable_count?: number; expires_at?: string | null;
  action?: { id: string; status: string; revision_id: string | null; revision: number | null; decision: "APPROVED" | "REJECTED" | null; decided_at: string | null } | null;
  inbound_count?: number; conversation?: { effective_status: string; read_state: string; attention: string };
  pending_reminder?: { id: string; status: string; due_at: string | null } | null;
  outcomes?: { id: string; kind: string; revision: number; occurred_at: string }[]; outcomes_truncated?: boolean;
}
interface SetupStep { id: StepId; state: StepState; reason_code: string; details: Details }
interface SetupResponse { version: 1; assessed_at: string; scope: "LATEST_ACTIVE_ENQUIRY"; lead: { id: string; name: string | null } | null; steps: SetupStep[] }
const labels: Record<StepState, string> = { RECORDED: "Recorded", NEEDS_ATTENTION: "Needs attention", NOT_STARTED: "Not started", UNAVAILABLE: "Unavailable" };
const titles: Record<StepId, string> = { BUSINESS: "Describe your business", ENQUIRY: "Bring in an enquiry", INTELLIGENCE: "Understand the evidence", CHANNEL: "Check your email channel", RECOVERY: "Prepare account recovery", REVIEW: "Review the exact message", WORKFLOW: "Manage what happens next" };
const names = (value: string) => value.toLowerCase().replaceAll("_", " ");
function explanation(row: SetupStep) {
  if (row.state === "UNAVAILABLE") return "This observation could not be verified. Refresh or inspect the work screen; it has not been marked complete.";
  const data = row.details;
  if (row.reason_code === "SELECT_ENQUIRY_FIRST") return "Add or import an enquiry to begin this part of the journey.";
  switch (row.id) {
    case "BUSINESS": return !data.configured ? "Save a business name and offering, then choose the criteria you want assessed." : data.criteria_configured ? `Business profile and typed criteria are saved at revision ${data.revision}. Review them when your offering changes.` : `Profile revision ${data.revision} is saved. Typed fit criteria still need your choices.`;
    case "ENQUIRY": return row.state === "NOT_STARTED" ? "Add one enquiry or review a CSV import. Keep its source and unknown facts visible." : "This guide uses your latest active enquiry. Correct its contact and source facts before acting.";
    case "INTELLIGENCE": return data.snapshot ? `An assessment was saved on ${new Date(data.snapshot.created_at).toLocaleDateString()}. Its currentness is not checked here; open it to inspect freshness, unknowns and fit.` : "Run analysis explicitly, then inspect what is known, missing and recommended. Analysis does not grant contact permission.";
    case "CHANNEL": return data.provider === "sandbox" ? "Sandbox is selected. It supports a simulated workflow; no live email readiness is established here." : `Email configuration ${data.configuration_complete ? "has the required fields" : "needs attention"}. Verification is not checked here. Inspect the channel's actual capability and holds.`;
    case "RECOVERY": return (data.usable_count || 0) > 0 ? `${data.usable_count} recovery codes are currently usable${data.expires_at ? ", until " + new Date(data.expires_at).toLocaleDateString() : ""}. Confirm that you saved them somewhere private and offline.` : "Create and save offline recovery codes while you can sign in. This guide never reveals the codes.";
    case "REVIEW": return !data.action ? "Prepare a message for this enquiry, review the exact recipient and text, then make an explicit decision." : data.action.decision ? `A ${data.action.decision === "APPROVED" ? "recorded approval" : "recorded rejection"} exists for revision ${data.action.revision}. Current sending authority is not checked here; inspect the message and its holds.` : "A message exists without a recorded decision for its current revision. Open the exact review before taking action.";
    case "WORKFLOW": return data.conversation ? `${data.inbound_count || 0} canonical inbound ${data.inbound_count === 1 ? "message" : "messages"}; conversation ${names(data.conversation.effective_status)}, ${names(data.conversation.read_state)}. ${data.conversation.attention === "NEEDS_REPLY" ? "A human reply needs attention. " : ["CONTACT_RESTRICTED", "CONTACT_POLICY_PENDING", "CONTACT_UNRESOLVED"].includes(data.conversation.attention) ? "Contact policy needs attention; no permission is implied. " : ""}${data.pending_reminder ? "A pending manual reminder is recorded. " : "No pending manual reminder is recorded. "}${data.outcomes?.length ? "Current recorded milestones: " + data.outcomes.map(item => names(item.kind)).join(", ") + (data.outcomes_truncated ? " (first three shown)." : ".") : "Record a milestone only when it actually happens."}` : "Review replies, create or reschedule a reminder, and record a real outcome with its source.";
  }
}
function destination(id: StepId, leadId?: string) {
  if (id === "BUSINESS") return { href: "/settings?tab=business", label: "Open business setup" };
  if (id === "ENQUIRY") return { href: "/imports", label: "Review an import" };
  if (id === "CHANNEL") return { href: "/settings?tab=email", label: "Inspect channel setup" };
  if (id === "RECOVERY") return { href: "/settings?tab=security", label: "Open account security" };
  if (!leadId) return { href: "/leads", label: "Add an enquiry" };
  if (id === "INTELLIGENCE") return { href: "/leads/" + encodeURIComponent(leadId) + "?tab=intelligence", label: "Inspect this assessment" };
  if (id === "REVIEW") return { href: "/leads/" + encodeURIComponent(leadId) + "?tab=outbound", label: "Open enquiry and message" };
  return { href: "/leads/" + encodeURIComponent(leadId) + "?tab=customer-workflow", label: "Open conversation and outcomes" };
}

export function SetupJourney() {
  const org = useWorkspaceStore(state => state.currentOrg);
  const query = useQuery({ queryKey: ["setup-journey", org?.id], queryFn: () => api.get<SetupResponse>("/setup-journey"), enabled: Boolean(org), retry: false, refetchOnWindowFocus: "always" });
  return <section aria-label="Your first enquiry journey" className="rounded-xl border border-line bg-surface p-5 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-ink">Your first enquiry journey</h2><p className="mt-1 text-sm text-muted">AI Lead Intelligence &amp; Outbound Automation, from saved context to a reviewed next step.</p></div><button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={14} aria-hidden="true" />{query.isFetching ? "Checking saved work..." : "Refresh saved work"}</button></div>
    <p className="text-xs text-muted">These are observations of saved work, not a completion score or permission to launch or send.</p>
    {query.isError && <p role="alert" className="rounded-lg border border-danger/20 bg-danger/5 p-3 text-sm text-danger">Saved setup could not be refreshed. {query.data ? "The observations below are from the last successful read." : "No setup state has been confirmed."} Use Refresh saved work to try this read again.</p>}
    {query.isError && isServiceUnavailable(query.error) && <AvailabilityNotice compact source="ONBOARDING" onRetry={() => query.refetch()}/>}
    {!query.data && query.isPending && <p role="status" className="text-sm text-muted">Reading saved setup...</p>}
    {query.data && <><div className="rounded-lg bg-soft p-3 text-sm"><p>{query.data.lead ? <>Enquiry in this guide: <Link className="font-medium underline" to={"/leads/" + encodeURIComponent(query.data.lead.id)}>{query.data.lead.name || "Unnamed enquiry"}</Link>. This is the latest active enquiry, excluding channel-verification probes.</> : "No active enquiry is selected. Add one or review an import to start."}</p><p className="mt-1 text-xs text-muted">Read at {new Date(query.data.assessed_at).toLocaleString()}. Other enquiries may be at different stages.</p></div>
      <ol className="grid gap-3 lg:grid-cols-2">{query.data.steps.map((row, index) => { const link = row.id === "BUSINESS" && row.details.configured && !row.details.criteria_configured ? { href: "/settings?tab=fit", label: "Choose fit criteria" } : destination(row.id, query.data?.lead?.id), Icon = row.state === "RECORDED" ? Check : row.state === "NOT_STARTED" ? Circle : TriangleAlert; return <li key={row.id} aria-label={titles[row.id]} className="flex min-w-0 gap-3 rounded-lg border border-line p-4"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-soft text-xs font-medium" aria-hidden="true">{index + 1}</span><div className="min-w-0 space-y-2"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{titles[row.id]}</h3><span className="inline-flex items-center gap-1 rounded-full bg-soft px-2 py-1 text-[11px]"><Icon size={12} aria-hidden="true" />{labels[row.state]}</span></div><p className="text-sm leading-relaxed text-muted">{explanation(row)}</p><Link className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-brand underline underline-offset-4" to={link.href}>{link.label}<ArrowUpRight size={14} aria-hidden="true" /></Link>{row.id === "ENQUIRY" && <Link to="/leads" className="ml-3 inline-flex min-h-10 items-center text-sm text-brand underline">Add or correct an enquiry</Link>}</div></li>; })}</ol>
    </>}
  </section>;
}
