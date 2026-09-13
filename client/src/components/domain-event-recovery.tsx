import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";

interface DomainEvent {
  id: string; lead_id: string | null; lead_name: string | null; type: string; status: string;
  processing_version: number; attempts: number; max_attempts: number; processing_fence: number;
  next_attempt_at: string | null; retry_deadline_at: string | null; first_processing_at: string | null;
  last_error_code: string | null; processing_hold_reason: string | null; created_at: string; updated_at: string | null;
  processed_at?: string | null; can_retry: boolean; can_close: boolean;
}
interface EventList { items: DomainEvent[]; total: number; offset: number; limit: number; has_more: boolean }
interface EventDetail extends DomainEvent {
  stages: { id: string; stage_key: string; status: string; artifact_type?: string | null; prepared_at: string; completed_at: string | null }[];
  reviews: { id: string; decision: string; evidence_note: string; created_at: string }[];
}
const LABELS: Record<string, string> = { PENDING: "Queued", PROCESSING: "Processing", RETRY_PENDING: "Waiting to retry", PROCESSED: "Processed", QUARANTINED: "Needs review", FAILED: "Historical failure", DISMISSED: "Closed" };
const STAGES: Record<string, string> = { snapshot: "Lead snapshot", synthesis: "Lead summary", recommendation: "Recommendation", plan: "Next best action", next_best_action: "Next best action", initial_action: "Initial action review", normalize: "Lead normalization", notification: "Lead activity recorded", done: "Processing recorded" };
function operation(type: string) { return type === "LeadCreated" ? "Initial lead processing" : type === "LeadReplyReceived" ? "Reply intelligence refresh" : "Lead activity processing"; }
function when(value: string | null | undefined) { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Not set"; }
function explanation(code: string | null) {
  if (!code) return "No processing issue recorded.";
  if (code.includes("LEGACY")) return "This historical event has no reliable processing record. Review it before closing; it cannot be automatically replayed.";
  if (code.includes("EXHAUST") || code.includes("BUDGET")) return "Automatic processing reached its attempt or time limit. Review the lead and record the next decision.";
  if (code.includes("INPUT") || code.includes("STALE") || code.includes("EVIDENCE")) return "The lead information changed or could not be verified. Processing must use the current, valid evidence.";
  if (code.includes("POLICY")) return "Contact-policy processing must finish before this work can continue.";
  if (code.includes("HANDLER") || code.includes("UNSUPPORTED")) return "This event needs a supported processing path before it can continue.";
  if (code.includes("LEASE") || code.includes("CLAIM")) return "Processing ownership expired or changed. Recovery uses the persisted progress.";
  return "Lead processing could not finish. Review the affected lead and investigate the cause before retrying.";
}
function errorMessage(error: unknown) {
  return error instanceof ApiError && error.body && typeof error.body === "object"
    ? (error.body as { error?: string }).error || "The event changed. Refresh it and review again."
    : "Could not load or update lead processing. Check your connection and try again.";
}

export function DomainEventRecovery({ organizationId }: { organizationId: string }) {
  const [state, setState] = useState("ACTIVE");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["domain-events", organizationId, state, offset],
    queryFn: () => api.get<EventList>("/domain-events?state=" + state + "&offset=" + offset + "&limit=25"), refetchInterval: 15000 });
  return <main aria-label="Lead processing recovery" className="overflow-y-auto p-4 sm:p-6 space-y-5">
    <p className="max-w-3xl text-sm text-muted">Track lead setup and intelligence refreshes that still need processing. A reply can be received successfully while its intelligence update is unfinished. Recovery here does not send a message.</p>
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-sm font-medium">Show<select className="ml-2 rounded-lg border border-line bg-surface px-3 py-2" value={state} onChange={(event) => { setState(event.target.value); setOffset(0); }}>
        <option value="ACTIVE">Unfinished processing</option><option value="QUARANTINED">Needs review</option><option value="RETRY_PENDING">Waiting to retry</option>
        <option value="FAILED">Historical failures</option><option value="PROCESSED">Processed</option><option value="DISMISSED">Closed</option><option value="ALL">All processing</option>
      </select></label>
      <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50"><RefreshCw className="h-4 w-4" />Refresh</button>
    </div>
    {query.isPending && <p role="status" className="flex gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading lead processing...</p>}
    {query.isError && <p role="alert" className="rounded-lg bg-danger-light p-4 text-sm text-danger">{errorMessage(query.error)}</p>}
    {query.data && <>
      <p role="status" className="text-sm text-muted">{query.data.total} events in this view.</p>
      {query.data.items.length === 0 ? <div className="rounded-xl border border-line p-8 text-center text-sm text-muted">No lead processing in this view.</div>
        : <div className="grid gap-3">{query.data.items.map((item) => <article key={item.id} className="rounded-xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div>
            <p className="font-semibold">{operation(item.type)}</p>
            {item.lead_id ? <Link className="text-sm text-brand underline" to={"/leads/" + item.lead_id}>{item.lead_name || "Open affected lead"}</Link> : <p className="text-sm text-muted">No linked lead</p>}
          </div><span className="rounded-full bg-soft px-3 py-1 text-xs font-medium">{LABELS[item.status] || "Needs review"}</span></div>
          <p className="mt-3 text-sm text-muted">{explanation(item.processing_hold_reason || item.last_error_code)}</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted"><p>{item.attempts} of {item.max_attempts} attempts / {item.next_attempt_at ? "Next retry: " + when(item.next_attempt_at) : "Created: " + when(item.created_at)}</p>
            <button type="button" className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink" onClick={() => setSelected(item.id)}>Review processing</button></div>
        </article>)}</div>}
      <div className="flex items-center justify-between gap-3 text-sm">
        <button type="button" disabled={offset === 0 || query.isFetching} onClick={() => setOffset(Math.max(0, offset - 25))} className="rounded-lg border border-line px-3 py-2 disabled:opacity-40">Previous</button>
        <span className="text-muted">Page {Math.floor(offset / 25) + 1}</span>
        <button type="button" disabled={!query.data.has_more || query.isFetching} onClick={() => setOffset(offset + 25)} className="rounded-lg border border-line px-3 py-2 disabled:opacity-40">Next</button>
      </div>
    </>}
    {selected && <DomainEventDialog organizationId={organizationId} eventId={selected} onClose={() => setSelected(null)} />}
  </main>;
}

function DomainEventDialog({ organizationId, eventId, onClose }: { organizationId: string; eventId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cache = useQueryClient();
  const query = useQuery({ queryKey: ["domain-event", organizationId, eventId], queryFn: () => api.get<EventDetail>("/domain-events/" + eventId), refetchOnWindowFocus: false });
  const [decision, setDecision] = useState(""); const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [saved, setSaved] = useState("");
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => { dialog.current?.close(); previous?.focus(); }; }, []);
  const data = query.data;
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!data || busy || !decision || !note.trim()) return;
    const expectedFence = data.processing_fence;
    setBusy(true); setError(""); setSaved("");
    try {
      await api.post("/domain-events/" + eventId + "/review", { expected_fence: expectedFence, decision, evidence_note: note.trim() });
      setSaved(decision === "RETRY" ? "Lead processing is queued within its remaining retry limits. No message was sent." : "Lead processing was closed with your evidence. Contact restrictions and received-event checks remain.");
      setDecision(""); setNote(""); await query.refetch(); void cache.invalidateQueries({ queryKey: ["domain-events", organizationId] });
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  return <dialog ref={dialog} aria-labelledby="domain-event-title" onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }} className="fixed inset-0 m-auto w-[min(94vw,680px)] max-h-[90dvh] overflow-y-auto rounded-2xl border border-line bg-surface p-6 text-ink shadow-2xl backdrop:bg-black/50">
    <div className="flex items-center justify-between gap-3"><h2 id="domain-event-title" className="text-lg font-semibold">Lead processing</h2><button type="button" disabled={busy} aria-label="Close processing details" onClick={onClose} className="rounded-lg p-2 hover:bg-soft"><X className="h-5 w-5" /></button></div>
    {query.isPending && <p role="status" className="mt-4 text-sm">Loading processing details...</p>}
    {(query.isError || error) && <div role="alert" className="mt-4 rounded-lg bg-danger-light p-3 text-sm text-danger"><p>{error || errorMessage(query.error)}</p><button type="button" disabled={busy || query.isFetching} onClick={() => { setError(""); setDecision(""); setNote(""); void query.refetch(); }} className="mt-2 underline">Refresh and review again</button></div>}
    {saved && <p role="status" className="mt-4 rounded-lg bg-ok-light p-3 text-sm text-ok">{saved}</p>}
    {data && <div className="mt-5 space-y-4">
      <p className="font-semibold">{operation(data.type)} / {LABELS[data.status] || "Needs review"}</p>
      {data.lead_id && <Link to={"/leads/" + data.lead_id} className="text-sm text-brand underline">{data.lead_name || "Open affected lead"}</Link>}
      <p className="text-sm text-muted">{explanation(data.processing_hold_reason || data.last_error_code)}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm"><dt className="text-muted">Created</dt><dd>{when(data.created_at)}</dd><dt className="text-muted">Attempts</dt><dd>{data.attempts} of {data.max_attempts}</dd><dt className="text-muted">Next retry</dt><dd>{when(data.next_attempt_at)}</dd><dt className="text-muted">Retry deadline</dt><dd>{when(data.retry_deadline_at)}</dd><dt className="text-muted">Last update</dt><dd>{when(data.updated_at)}</dd></dl>
      {data.processing_version === 0 && <p className="rounded-lg border border-line p-3 text-sm">Historical processing can be inspected and closed. It cannot be promoted into an automatic retry because its completed work is unknown.</p>}
      <section className="border-t border-line pt-3"><h3 className="text-sm font-semibold">Processing progress</h3>{data.stages.length === 0 ? <p className="mt-2 text-sm text-muted">No managed stage progress recorded.</p> : <ol className="mt-3 space-y-2">{data.stages.map((stage) => <li key={stage.id} className="rounded-lg bg-soft p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><span>{STAGES[stage.stage_key] || "Processing step"}</span><span className="font-medium">{stage.status === "DONE" ? "Completed" : stage.status === "SKIPPED" ? "Skipped by policy" : "Prepared"}</span></div><p className="mt-1 text-xs text-muted">{when(stage.completed_at || stage.prepared_at)}</p></li>)}</ol>}</section>
      {(data.can_retry || data.can_close) && <form onSubmit={submit} className="space-y-3 border-t border-line pt-4"><p className="text-sm text-muted">Investigate the cause before retrying. Retry uses the original event and remaining limits. Closing this work does not clear a separate received event's contact-policy check.</p>
        <label className="block text-sm font-medium">Decision<select required disabled={busy} value={decision} onChange={(event) => setDecision(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-page p-2"><option value="">Choose a decision</option>{data.can_retry && <option value="RETRY">Retry lead processing</option>}{data.can_close && <option value="CLOSE">Close without processing again</option>}</select></label>
        <label className="block text-sm font-medium">Evidence and reason<textarea required rows={4} maxLength={2000} disabled={busy} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record what you checked and why this decision is appropriate." className="mt-1 w-full rounded-lg border border-line bg-page p-2" /></label>
        <button disabled={busy || query.isFetching || query.isError || !!error || !decision || !note.trim()} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Recording..." : "Record decision"}</button>
      </form>}
      {data.reviews.length > 0 && <section className="border-t border-line pt-3"><h3 className="text-sm font-semibold">Review history</h3>{data.reviews.map((review) => <div key={review.id} className="mt-3 text-sm"><p>{review.decision === "RETRY" ? "Processing retry requested" : "Processing closed"} / {when(review.created_at)}</p><p className="whitespace-pre-wrap text-muted">{review.evidence_note}</p></div>)}</section>}
    </div>}
  </dialog>;
}
