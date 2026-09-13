import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Header } from "@/components/layout/header";
import { ApprovalReviewDialog } from "@/components/approval-review-dialog";
import { useMe } from "@/hooks/use-auth";
import { useWorkspaceStore } from "@/stores/workspace";
import { api, ApiError } from "@/lib/api";
import type { Lead } from "@/types";

interface Campaign { id: string; name: string; status: string }
interface Step { type: string; title: string; body: string; delay_hours: number }
interface Sequence { id: string; campaign_id: string; name: string; status: string; steps: Step[] }
interface Run {
  id: string; lead_id: string; lead_name: string; sequence_name: string; campaign_name: string;
  status: string; revision: number; current_step_order: number; next_run_at: string | null;
  paused_at: string | null; pause_reason: string | null; scheduler_hold_reason: string | null;
  stop_reason: string | null; last_action_id: string | null; action_status: string | null; action_type: string | null;
  processing_version: number;
}
const TYPES: Record<string, string> = { SEND_EMAIL: "Email", SEND_WHATSAPP: "WhatsApp", SEND_SMS: "SMS",
  SEND_VOICE_CALL: "Voice call", CREATE_HUMAN_TASK: "Human task", WAIT: "Wait" };
const STATUS: Record<string, string> = { ACTIVE: "Scheduled", WAITING: "Waiting until due", WAITING_APPROVAL: "Needs message review",
  WAITING_EXECUTION: "Waiting for execution or completion", COMPLETED: "Completed", STOPPED: "Stopped", BLOCKED: "Needs investigation" };
const inputClass = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink";
const buttonClass = "rounded-lg border border-line px-3 py-2 text-sm font-medium hover:bg-soft disabled:opacity-50";
const primaryClass = "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50";
const newStep = (): Step => ({ type: "SEND_EMAIL", title: "", body: "", delay_hours: 0 });
const when = (value: string | null) => value ? new Date(value).toLocaleString() : "Waiting for the current step";
function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.body && typeof error.body === "object") {
    return (error.body as { error?: string }).error || "The run changed. Refresh and try again.";
  }
  return error instanceof Error && error.name === "ScheduleInputError" ? error.message : "Could not load or save workflows. Check your connection and try again.";
}
function scheduleFromLocal(value: string) {
  if (!value) return null;
  const parsed = new Date(value);
  const parts = value.split(/[-T:]/).map(Number);
  if (!Number.isFinite(parsed.getTime()) || parsed.getFullYear() !== parts[0] || parsed.getMonth() + 1 !== parts[1]
    || parsed.getDate() !== parts[2] || parsed.getHours() !== parts[3] || parsed.getMinutes() !== parts[4]) {
    throw Object.assign(new Error("Choose a valid time in your displayed timezone."), { name: "ScheduleInputError" });
  }
  return parsed.toISOString();
}

export function WorkflowsPage() {
  const org = useWorkspaceStore(s => s.currentOrg);
  const { data: me } = useMe();
  return <><Header title="Workflows" description="Schedule reviewed outreach and track each step to completion" />
    {!org || me?.user.role !== "OWNER" ? <p className="p-6 text-sm text-muted">A workspace owner can schedule and control workflow runs.</p>
      : <WorkspaceWorkflows key={org.id} organizationId={org.id} />}</>;
}
function WorkspaceWorkflows({ organizationId }: { organizationId: string }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"runs" | "setup">("runs");
  const [campaignName, setCampaignName] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [sequenceName, setSequenceName] = useState("");
  const [steps, setSteps] = useState<Step[]>([newStep()]);
  const [sequenceId, setSequenceId] = useState("");
  const [leadIds, setLeadIds] = useState<string[]>([]);
  const [leadSearch, setLeadSearch] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [control, setControl] = useState<{ run: Run; command: "PAUSE" | "RESUME" | "STOP" } | null>(null);
  const [reason, setReason] = useState("");
  const [reviewId, setReviewId] = useState<string | null>(null);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let schedulePreview = "";
  if (scheduledAt) { try { schedulePreview = scheduleFromLocal(scheduledAt) || ""; } catch { schedulePreview = "Choose a valid local time."; } }
  const query = useQuery({ queryKey: ["workflows", organizationId], refetchInterval: 15000,
    queryFn: async () => {
      const scope = "?organization_id=" + encodeURIComponent(organizationId);
      const [campaigns, sequences, runs, leads] = await Promise.all([
        api.get<{ campaigns: Campaign[] }>("/campaigns" + scope), api.get<{ sequences: Sequence[] }>("/sequences" + scope),
        api.get<{ workflow_runs: Run[] }>("/workflow-runs" + scope), api.get<{ leads: Lead[] }>("/leads" + scope)
      ]);
      return { campaigns: campaigns.campaigns, sequences: sequences.sequences, runs: runs.workflow_runs, leads: leads.leads };
    }
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["workflows", organizationId] });
  const save = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await work(); await refresh(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  const editStep = (index: number, patch: Partial<Step>) => setSteps(current => current.map((step, i) => i === index ? { ...step, ...patch } : step));
  const selectControl = (run: Run, command: "PAUSE" | "RESUME" | "STOP") => { setControl({ run, command }); setReason(""); setError(""); };
  const eligibleLeads = (query.data?.leads || []).filter(lead => !["OPTED_OUT", "SUPPRESSED"].includes(lead.status));
  const visibleLeads = eligibleLeads.filter(lead => [lead.name, lead.company, lead.email].some(value => value?.toLowerCase().includes(leadSearch.toLowerCase())));
  return <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <p className="max-w-3xl text-sm text-muted">A sequence schedules actions from your lead intelligence. Each outgoing message needs an exact recipient, sender and content review. A later step waits for confirmed delivery or task completion.</p>
      <button type="button" disabled={query.isFetching} onClick={() => { setControl(null); void query.refetch(); }} className={buttonClass + " flex items-center gap-2"}><RefreshCw className="h-4 w-4" />Refresh</button>
    </div>
    <div role="group" aria-label="Workflow view" className="flex gap-2">
      <button type="button" onClick={() => setTab("runs")} aria-pressed={tab === "runs"} className={tab === "runs" ? primaryClass : buttonClass}>Runs and schedules</button>
      <button type="button" onClick={() => setTab("setup")} aria-pressed={tab === "setup"} className={tab === "setup" ? primaryClass : buttonClass}>Create a sequence</button>
    </div>
    {query.isPending && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading workflows...</p>}
    {(query.isError || error) && <p role="alert" className="rounded-lg bg-danger-light p-4 text-sm text-danger">{error || errorMessage(query.error)}</p>}
    {notice && <p role="status" className="rounded-lg bg-soft p-4 text-sm">{notice}</p>}
    {query.data && tab === "setup" && <div className="grid items-start gap-5 lg:grid-cols-[1fr_2fr]">
      <form className="rounded-xl border border-line bg-surface p-5 space-y-4" onSubmit={event => { event.preventDefault(); void save(async () => {
        const result = await api.post<{ campaign: Campaign }>("/campaigns", { name: campaignName }); setCampaignId(result.campaign.id); setCampaignName(""); setNotice("Campaign created. Add its sequence next.");
      }); }}>
        <h2 className="text-base font-semibold">1. Create a campaign</h2>
        <p className="text-sm text-muted">Group sequences around a customer problem or outreach objective.</p>
        <label className="block text-sm font-medium">Campaign name<input required maxLength={200} value={campaignName} onChange={event => setCampaignName(event.target.value)} className={inputClass} placeholder="For example, onboarding follow-up" /></label>
        <button disabled={busy || !campaignName.trim()} className={primaryClass}>Create campaign</button>
      </form>
      <form className="rounded-xl border border-line bg-surface p-5 space-y-4" onSubmit={event => { event.preventDefault(); void save(async () => {
        const result = await api.post<{ sequence: Sequence }>("/sequences", { campaign_id: campaignId, name: sequenceName,
          stop_on_reply: true, steps: steps.map(step => ({ ...step, requires_approval: step.type.startsWith("SEND_") })) });
        setSequenceId(result.sequence.id); setSequenceName(""); setSteps([newStep()]); setTab("runs"); setNotice("Sequence created. Choose leads and a start time to enroll them.");
      }); }}>
        <h2 className="text-base font-semibold">2. Define the steps</h2>
        <p className="text-sm text-muted">Sequence definitions stay fixed after creation. Create another sequence when the plan changes. Every reply stops existing runs for human review; opt-outs always prevent contact.</p>
        <label className="block text-sm font-medium">Campaign<select required value={campaignId} onChange={event => setCampaignId(event.target.value)} className={inputClass}><option value="">Choose a campaign</option>{query.data.campaigns.filter(item => item.status === "ACTIVE").map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="block text-sm font-medium">Sequence name<input required maxLength={200} value={sequenceName} onChange={event => setSequenceName(event.target.value)} className={inputClass} /></label>
        {steps.map((step, index) => <fieldset key={index} className="rounded-lg border border-line p-4 space-y-3">
          <legend className="px-1 text-sm font-medium">Step {index + 1}</legend>
          <div className="flex items-end gap-3"><label className="flex-1 text-sm font-medium">Action<select value={step.type} onChange={event => editStep(index, { type: event.target.value })} className={inputClass}>{Object.entries(TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            {steps.length > 1 && <button type="button" aria-label={"Remove step " + (index + 1)} onClick={() => setSteps(current => current.filter((_, i) => i !== index))} className={buttonClass}><Trash2 className="h-4 w-4" /></button>}</div>
          {step.type !== "WAIT" && <><label className="block text-sm font-medium">{step.type === "SEND_EMAIL" ? "Email subject" : "Step title"}<input required maxLength={300} value={step.title} onChange={event => editStep(index, { title: event.target.value })} className={inputClass} /></label>
            {step.type.startsWith("SEND_") && <label className="block text-sm font-medium">Draft message<textarea required rows={4} maxLength={10000} value={step.body} onChange={event => editStep(index, { body: event.target.value })} className={inputClass} /></label>}</>}
          <label className="block text-sm font-medium">{step.type === "WAIT" ? "Wait length (hours)" : "Wait after confirmed completion (hours)"}<input type="number" min={0} max={8760} step="any" required value={step.delay_hours} onChange={event => editStep(index, { delay_hours: Number(event.target.value) })} className={inputClass} /></label>
          {step.type.startsWith("SEND_") && <p className="text-xs text-muted">Exact message review is required for each lead. Channel settings must be ready before sending.</p>}
          {step.type === "CREATE_HUMAN_TASK" && <p className="text-xs text-muted">This step waits for recorded task completion. Creating or accepting the task does not complete it. The full task completion journey is still pending.</p>}
        </fieldset>)}
        <div className="flex flex-wrap gap-3"><button type="button" disabled={steps.length >= 50 || busy} onClick={() => setSteps(current => [...current, newStep()])} className={buttonClass + " flex items-center gap-2"}><Plus className="h-4 w-4" />Add step</button>
          <button disabled={busy || !campaignId || !sequenceName.trim()} className={primaryClass}>Create sequence</button></div>
      </form>
    </div>}
    {query.data && tab === "runs" && <>
      <form className="rounded-xl border border-line bg-surface p-5 space-y-4" onSubmit={event => { event.preventDefault(); void save(async () => {
        const result = await api.post<{ workflow_runs: Run[] }>("/sequences/" + sequenceId + "/enroll", { lead_ids: leadIds, scheduled_at: scheduleFromLocal(scheduledAt) });
        setLeadIds([]); setNotice(result.workflow_runs.length + " lead runs saved. Existing enrollments keep their original schedule.");
      }); }}>
        <h2 className="flex items-center gap-2 text-base font-semibold"><CalendarClock className="h-5 w-5" />Schedule a sequence</h2>
        {!query.data.sequences.length ? <p className="text-sm text-muted">Create a campaign and sequence first using Create a sequence above.</p> : <>
          <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Sequence<select required value={sequenceId} onChange={event => setSequenceId(event.target.value)} className={inputClass}><option value="">Choose a sequence</option>{query.data.sequences.filter(item => item.status === "ACTIVE").map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="block text-sm font-medium">Start time (optional)<input type="datetime-local" value={scheduledAt} onChange={event => setScheduledAt(event.target.value)} className={inputClass} /><span className="mt-1 block text-xs font-normal text-muted">{zone}. Leave blank to start when the server next checks due work.</span></label></div>
          {schedulePreview && <p className="text-xs text-muted">Exact saved start (UTC): {schedulePreview}</p>}
          <label className="block text-sm font-medium">Find leads<input type="search" value={leadSearch} onChange={event => setLeadSearch(event.target.value)} className={inputClass} placeholder="Search name, company or email" /></label>
          <fieldset className="max-h-56 overflow-y-auto rounded-lg border border-line p-3"><legend className="px-1 text-sm">Leads ({leadIds.length} selected, maximum 200)</legend>
            {!visibleLeads.length && <p className="p-2 text-sm text-muted">No eligible leads match. <Link to="/leads" className="text-brand underline">Manage leads</Link></p>}
            {visibleLeads.map(lead => <label key={lead.id} className="flex items-start gap-3 rounded-lg p-2 hover:bg-soft"><input type="checkbox" checked={leadIds.includes(lead.id)} disabled={!leadIds.includes(lead.id) && leadIds.length >= 200}
              onChange={event => setLeadIds(current => event.target.checked ? [...current, lead.id] : current.filter(id => id !== lead.id))} className="mt-1" /><span className="text-sm">{lead.name || lead.company || "Unnamed lead"}<span className="block text-xs text-muted">{lead.email || lead.phone || "Contact details need review"}</span></span></label>)}
          </fieldset>
          <p className="text-xs text-muted">Opted-out and suppressed leads are excluded. Contact rules are checked again before sending. Re-enrolling the same lead keeps its existing run.</p>
          <button disabled={busy || !sequenceId || !leadIds.length} className={primaryClass}>Save schedule</button>
        </>}
      </form>
      <section className="space-y-3" aria-label="Workflow runs"><h2 className="text-base font-semibold">Workflow runs ({query.data.runs.length})</h2>
        {!query.data.runs.length && <p className="rounded-xl border border-line p-6 text-sm text-muted">No runs yet. Choose a sequence and leads above to save the first schedule.</p>}
        {query.data.runs.map(run => {
          const open = ["ACTIVE", "WAITING", "WAITING_APPROVAL", "WAITING_EXECUTION"].includes(run.status);
          const held = !!run.scheduler_hold_reason || run.processing_version !== 1;
          return <article key={run.id} className="rounded-xl border border-line bg-surface p-4 space-y-3">
            <div className="flex flex-wrap justify-between gap-3"><div><Link className="font-semibold text-sm text-brand hover:underline" to={"/leads/" + run.lead_id}>{run.lead_name || "Lead"}</Link><p className="mt-1 text-xs text-muted">{run.campaign_name} / {run.sequence_name} / Step {run.current_step_order}</p></div>
              <span className="h-fit rounded-md bg-soft px-2 py-1 text-xs">{open && run.paused_at ? "Paused / " : ""}{STATUS[run.status] || run.status}</span></div>
            <p className="text-sm text-muted">{run.next_run_at ? "Eligible after " + when(run.next_run_at) + " (" + zone + ")" : run.action_status === "EXECUTING" ? "Provider acceptance is recorded; confirmed completion is still pending." : STATUS[run.status]}</p>
            {held && <p className="text-sm text-danger">This run needs operational review. Historical or invalid scheduling evidence cannot be resumed automatically.</p>}
            {(run.stop_reason || run.pause_reason) && <p className="text-xs text-muted">Reason: {run.stop_reason || run.pause_reason}</p>}
            <div className="flex flex-wrap gap-2">
              {run.last_action_id && ["AWAITING_APPROVAL", "APPROVED", "RETRYING"].includes(run.action_status || "") && <button type="button" onClick={() => setReviewId(run.last_action_id)} className={buttonClass}>Review message</button>}
              {run.last_action_id && <Link to="/outbound" className={buttonClass}>View outbound activity</Link>}
              {open && !held && <button type="button" disabled={busy} onClick={() => selectControl(run, run.paused_at ? "RESUME" : "PAUSE")} className={buttonClass}>{run.paused_at ? "Resume" : "Pause"}</button>}
              {open && <button type="button" disabled={busy} onClick={() => selectControl(run, "STOP")} className={buttonClass}>Stop run</button>}
            </div>
            {control?.run.id === run.id && <form className="rounded-lg bg-soft p-3 space-y-3" onSubmit={event => { event.preventDefault(); void save(async () => {
              await api.post("/workflow-runs/" + control.run.id + "/control", { expected_revision: control.run.revision, command: control.command, reason });
              setNotice(control.command === "STOP" ? "Run stopped. Already authorized provider requests may finish; later actions will not send." : control.command === "PAUSE" ? "Run paused. Approval and wait timing are preserved." : "Run resumed with its original timing and review requirements."); setControl(null);
            }); }}>
              <p className="text-sm font-medium">{control.command === "STOP" ? "Stop this run permanently" : control.command === "PAUSE" ? "Pause this run" : "Resume this run"}</p>
              <p className="text-xs text-muted">{control.command === "STOP" ? "Queued actions will be cancelled. In-flight results and history are preserved." : "A provider request authorized before this change may finish."}</p>
              <label className="block text-sm">Reason<textarea required autoFocus maxLength={2000} rows={2} value={reason} onChange={event => setReason(event.target.value)} className={inputClass} /></label>
              <div className="flex gap-2"><button disabled={busy || !reason.trim()} className={primaryClass}>Confirm {control.command.toLowerCase()}</button><button type="button" disabled={busy} onClick={() => setControl(null)} className={buttonClass}>Cancel</button></div>
            </form>}
          </article>;
        })}
      </section>
    </>}
    {reviewId && <ApprovalReviewDialog actionIds={[reviewId]} onClose={() => { setReviewId(null); void refresh(); }} />}
  </main>;
}
