import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, X } from "lucide-react";
import { DomainEventRecovery } from "@/components/domain-event-recovery";
import { Header } from "@/components/layout/header";
import { useWorkspaceStore } from "@/stores/workspace";
import { useMe } from "@/hooks/use-auth";
import { api, ApiError } from "@/lib/api";

interface Receipt {
  id: string; provider: string; provider_event_id: string; event_kind: string;
  processing_state: string; mandatory_policy_status: string; attempts: number; max_attempts: number;
  received_at: string; next_attempt_at: string | null; retry_deadline_at: string | null;
  processing_fence: number; quarantined_reason: string | null; last_error_code: string | null;
  can_retry: boolean; can_close: boolean; payload_purged_at: string | null;
}
interface ReceiptDetail extends Receipt {
  preview: { subject: string | null; text: string | null; event: string | null; action_id: string | null } | null;
  reviews: { id: string; decision: string; evidence_note: string; created_at: string }[];
}
interface ReceiptList { items: Receipt[]; total: number; has_more: boolean; offset: number; limit: number }
const STATES: Record<string, string> = {
  RECEIVED: "Received", PROCESSING: "Processing", RETRY_PENDING: "Waiting to retry",
  PROCESSED: "Processed", QUARANTINED: "Needs review", DISMISSED: "Closed",
};
function when(value: string | null) { return value ? new Date(value).toLocaleString() : "Not set"; }
function eventLabel(kind: string) { return kind === "INBOUND_MESSAGE" ? "Inbound reply" : kind === "SENDGRID_EVENT" ? "Email event" : "Delivery callback"; }
function reason(code: string | null) {
  if (!code) return "No processing issue recorded.";
  if (code === "PROCESSING_BUDGET_EXHAUSTED") return "Automatic processing reached its attempt or time limit.";
  if (code === "RECEIPT_IDENTITY_CONFLICT") return "The same event reference arrived with different content. The original event was preserved.";
  if (code === "LEGACY_REVIEW_REQUIRED") return "This historical record has no reliable processing history and needs investigation.";
  if (code.includes("COPY") || code.includes("REVISION")) return "The original reviewed message could not be recovered safely.";
  if (code.includes("IDENTITY") || code.includes("MESSAGE_ID") || code.includes("CORRELATION") || code.includes("NOT_FOUND")) return "The event could not be matched to one reliable original record.";
  if (code.includes("SENDER") || code.includes("ENVELOPE") || code.includes("CONTENT_TOO_LARGE") || code.includes("INVALID")) return "The received content needs investigation before it can be processed.";
  return "Processing could not finish. Review the event and check the affected records.";
}
function errorMessage(error: unknown) {
  return error instanceof ApiError && error.body && typeof error.body === "object"
    ? (error.body as { error?: string }).error || "The event changed. Refresh it and try again."
    : "Could not load or update events. Check your connection and try again.";
}

export function EventRecoveryPage() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  const { data: me } = useMe();
  const [view, setView] = useState<"received" | "lead">("received");
  if (!org || me?.user.role !== "OWNER") return <><Header title="Event recovery" /><p className="p-6 text-sm text-muted">A workspace owner can inspect events and recover unfinished lead processing.</p></>;
  return <>
    <Header title="Event recovery" description="Review received events and unfinished lead processing" />
    <div role="group" aria-label="Recovery view" className="flex flex-wrap gap-2 border-b border-line px-4 py-3 sm:px-6">
      <button type="button" aria-pressed={view === "received"} onClick={() => setView("received")} className={"rounded-lg px-4 py-2 text-sm font-medium " + (view === "received" ? "bg-brand text-white" : "border border-line text-ink")}>Received events</button>
      <button type="button" aria-pressed={view === "lead"} onClick={() => setView("lead")} className={"rounded-lg px-4 py-2 text-sm font-medium " + (view === "lead" ? "bg-brand text-white" : "border border-line text-ink")}>Lead processing</button>
    </div>
    {view === "received" ? <RecoveryQueue key={org.id} organizationId={org.id} /> : <DomainEventRecovery key={org.id} organizationId={org.id} />}
  </>;
}
function RecoveryQueue({ organizationId }: { organizationId: string }) {
  const [state, setState] = useState("ACTIVE");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["webhook-receipts", organizationId, state, offset],
    queryFn: () => api.get<ReceiptList>(`/webhook-receipts?state=${state}&offset=${offset}&limit=25`),
    refetchInterval: 15000,
  });
  return <>
    <main className="overflow-y-auto p-4 sm:p-6 space-y-5">
      <p className="max-w-3xl text-sm text-muted">Track delivery notifications and replies that still need processing. Retrying here repairs local records and never sends a new message.</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium">Show
          <select className="ml-2 rounded-lg border border-line bg-surface px-3 py-2" value={state}
            onChange={(e) => { setState(e.target.value); setOffset(0); }}>
            <option value="ACTIVE">Unfinished events</option><option value="QUARANTINED">Needs review</option>
            <option value="RETRY_PENDING">Waiting to retry</option><option value="PROCESSED">Processed</option>
            <option value="DISMISSED">Closed</option><option value="ALL">All events</option>
          </select>
        </label>
        <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50"><RefreshCw className="h-4 w-4" />Refresh</button>
      </div>
      {query.isPending && <p role="status" className="flex gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading received events...</p>}
      {query.isError && <p role="alert" className="rounded-lg bg-danger-light p-4 text-sm text-danger">{errorMessage(query.error)}</p>}
      {query.data && <>
        <p role="status" className="text-sm text-muted">{query.data.total} events in this view.</p>
        {query.data.items.length === 0 ? <div className="rounded-xl border border-line p-8 text-center text-sm text-muted">No events in this view.</div>
          : <div className="grid gap-3">
            {query.data.items.map((item) => <article key={item.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="text-sm font-semibold">{eventLabel(item.event_kind)} <span className="font-normal text-muted">/ {item.provider}</span></h2>
                  <p className="mt-1 text-xs text-muted">Received {when(item.received_at)}</p></div>
                <span className="rounded-md bg-soft px-2 py-1 text-xs">{STATES[item.processing_state] || "Needs review"}</span>
              </div>
              {(item.last_error_code || item.quarantined_reason) && <p className="mt-3 text-sm text-muted">{reason(item.quarantined_reason || item.last_error_code)}</p>}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                <p className="text-muted">{item.attempts} of {item.max_attempts} processing attempts{item.next_attempt_at ? " / Retry after " + when(item.next_attempt_at) : ""}</p>
                <button type="button" onClick={() => setSelected(item.id)} className="rounded-lg border border-line px-3 py-2 hover:bg-soft">Inspect event</button>
              </div>
            </article>)}
          </div>}
        <div className="flex items-center justify-between gap-3">
          <button type="button" disabled={!offset || query.isFetching} onClick={() => setOffset(Math.max(0, offset - 25))} className="rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-40">Previous</button>
          <span className="text-xs text-muted">Page {Math.floor(offset / 25) + 1}</span>
          <button type="button" disabled={!query.data.has_more || query.isFetching} onClick={() => setOffset(offset + 25)} className="rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-40">Next</button>
        </div>
      </>}
    </main>
    {selected && <ReceiptDialog organizationId={organizationId} receiptId={selected} onClose={() => setSelected(null)} />}
  </>;
}
function ReceiptDialog({ organizationId, receiptId, onClose }: { organizationId: string; receiptId: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const qc = useQueryClient();
  const key = ["webhook-receipt", organizationId, receiptId];
  const query = useQuery({ queryKey: key, queryFn: () => api.get<ReceiptDetail>("/webhook-receipts/" + receiptId), refetchOnWindowFocus: false });
  const [decision, setDecision] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => { ref.current?.close(); previous?.focus(); };
  }, []);
  const data = query.data;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!data || busy || !decision || !note.trim()) return;
    const fence = data.processing_fence;
    setBusy(true); setError(""); setSaved("");
    try {
      await api.post("/webhook-receipts/" + receiptId + "/review", { expected_fence: fence, decision, evidence_note: note.trim() });
      setSaved(decision === "RETRY" ? "The same event is queued for processing. No message was sent." : "Event processing closed with your evidence. Existing contact restrictions remain.");
      setDecision(""); setNote("");
      await query.refetch();
      void qc.invalidateQueries({ queryKey: ["webhook-receipts"] });
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return <dialog ref={ref} aria-labelledby="receipt-title" onCancel={(e) => { if (busy) e.preventDefault(); else onClose(); }}
    className="fixed inset-0 m-auto w-[min(94vw,680px)] max-h-[90dvh] overflow-y-auto rounded-2xl border border-line bg-surface p-6 text-ink shadow-2xl backdrop:bg-black/50">
    <div className="flex items-center justify-between gap-3"><h2 id="receipt-title" className="text-lg font-semibold">Received event</h2>
      <button type="button" aria-label="Close event details" disabled={busy} onClick={onClose} className="rounded-lg p-2 hover:bg-soft"><X className="h-5 w-5" /></button></div>
    {query.isPending && <p role="status" className="mt-4 text-sm">Loading event...</p>}
    {(query.isError || error) && <div role="alert" className="mt-4 rounded-lg bg-danger-light p-3 text-sm text-danger"><p>{error || errorMessage(query.error)}</p>
      <button type="button" disabled={busy || query.isFetching} onClick={() => { setError(""); setDecision(""); setNote(""); void query.refetch(); }} className="mt-2 underline">Refresh and review again</button></div>}
    {saved && <p role="status" className="mt-4 rounded-lg bg-ok-light p-3 text-sm text-ok">{saved}</p>}
    {data && <div className="mt-5 space-y-4">
      <p className="text-sm font-semibold">{eventLabel(data.event_kind)} / {STATES[data.processing_state]}</p>
      <p className="text-sm text-muted">{reason(data.quarantined_reason || data.last_error_code)}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">Received</dt><dd>{when(data.received_at)}</dd>
        <dt className="text-muted">Attempts</dt><dd>{data.attempts} of {data.max_attempts}</dd>
        <dt className="text-muted">Next retry</dt><dd>{when(data.next_attempt_at)}</dd>
        <dt className="text-muted">Retry deadline</dt><dd>{when(data.retry_deadline_at)}</dd>
        <dt className="text-muted">Provider reference</dt><dd className="break-all">{data.provider_event_id}</dd>
      </dl>
      {data.preview && (data.preview.subject || data.preview.text || data.preview.event) && <div className="rounded-lg border border-line bg-soft p-3 text-sm">
        <p className="font-medium">Received content preview</p>
        <p className="mt-2">{data.preview.subject || data.preview.event}</p>
        <p className="mt-2 whitespace-pre-wrap break-words">{data.preview.text}</p>
      </div>}
      {data.payload_purged_at && <p className="text-xs text-muted">The stored event body expired under the retention policy. Its processing history remains.</p>}
      {data.mandatory_policy_status !== "DONE" && <p className="rounded-lg border border-line p-3 text-sm">Contact-policy processing is unfinished, so sending is paused for this workspace. This event cannot be closed until the policy check finishes. If retries are exhausted, the issue needs operator investigation.</p>}
      {(data.can_retry || data.can_close) && <form onSubmit={submit} className="space-y-3 border-t border-line pt-4">
        <p className="text-sm text-muted">Retry only after investigating the cause. Processing uses the original event; it cannot change the recipient or send another message.</p>
        <label className="block text-sm font-medium">Decision<select required disabled={busy} value={decision} onChange={(e) => setDecision(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-page p-2">
          <option value="">Choose a decision</option>{data.can_retry && <option value="RETRY">Retry local processing</option>}{data.can_close && <option value="CLOSE">Close without processing again</option>}
        </select></label>
        <label className="block text-sm font-medium">Evidence and reason<textarea required maxLength={2000} rows={4} value={note} disabled={busy}
          onChange={(e) => setNote(e.target.value)} placeholder="Record what you checked and why this decision is appropriate." className="mt-1 w-full rounded-lg border border-line bg-page p-2" /></label>
        <button disabled={busy || query.isFetching || !!error || !decision || !note.trim()} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Recording..." : "Record decision"}</button>
      </form>}
      {data.reviews.length > 0 && <div className="border-t border-line pt-3"><h3 className="text-sm font-semibold">Review history</h3>
        {data.reviews.map((item) => <div key={item.id} className="mt-3 text-sm"><p>{item.decision === "RETRY" ? "Processing retry requested" : "Processing closed"} / {when(item.created_at)}</p><p className="whitespace-pre-wrap text-muted">{item.evidence_note}</p></div>)}
      </div>}
    </div>}
  </dialog>;
}
