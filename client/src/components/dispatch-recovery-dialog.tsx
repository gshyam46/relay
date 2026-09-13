import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";

interface RecoveryDetail {
  action_id: string; status: string; hold_reason: string | null;
  next_attempt_at: string | null; retry_deadline_at: string | null; first_dispatch_at: string | null;
  max_attempts: number; attempts_used: number; attempts_remaining: number;
  recovery_required: boolean; can_resolve: boolean; allowed_decisions: string[];
  execution: { id: string; attempt: number; outcome_class: string; fence_token: number | null;
    provider: string | null; provider_reference: string | null; lease_expires_at: string | null } | null;
  executions: { id: string; attempt: number; outcome_class: string; started_at: string; provider_reference: string | null }[];
  resolutions: { decision: string; evidence_note: string; created_at: string }[];
}

const OUTCOMES: Record<string, string> = {
  DISPATCHING: "Sending", ACCEPTED: "Accepted; delivery unconfirmed",
  RETRYABLE_FAILURE: "Rejected; waiting before retry", PERMANENT_FAILURE: "Rejected; no automatic retry",
  UNCERTAIN: "Send outcome unknown", LEGACY_UNKNOWN: "Historical outcome not classified",
  DELIVERED: "Delivered", DELIVERY_FAILED: "Delivery failed",
  CLOSED_UNRESOLVED: "Closed without retry",
};

export function DispatchOutcome({ outcome }: { outcome?: string | null }) {
  return outcome ? <p className="mt-1 text-xs text-muted">{OUTCOMES[outcome] || "Outcome needs review"}</p> : null;
}

export function DispatchDetailsButton({ actionId }: { actionId: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={(event) => { event.stopPropagation(); setOpen(true); }}
      className="rounded-md border border-line px-2 py-1.5 text-xs text-muted hover:text-ink hover:bg-soft">
      Send details
    </button>
    {open && <DispatchRecoveryDialog actionId={actionId} onClose={() => setOpen(false)} />}
  </>;
}

function message(error: unknown) {
  if (error instanceof ApiError && error.body && typeof error.body === "object") {
    return (error.body as { error?: string }).error || "The outcome changed. Refresh and review it again.";
  }
  return "Could not load or save the outcome. Check your connection and retry.";
}
function date(value: string | null) { return value ? new Date(value).toLocaleString() : "Not set"; }

function DispatchRecoveryDialog({ actionId, onClose }: { actionId: string; onClose: () => void }) {
  const org = useWorkspaceStore((s) => s.currentOrg);
  const dialog = useRef<HTMLDialogElement>(null);
  const qc = useQueryClient();
  const key = ["dispatch-recovery", org?.id, actionId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.get<RecoveryDetail>(`/actions/${actionId}/recovery?organization_id=${encodeURIComponent(org!.id)}`),
    enabled: !!org,
  });
  const [decision, setDecision] = useState("");
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); previous?.focus(); };
  }, []);
  const detail = query.data;
  const execution = detail?.execution;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!org || !detail?.can_resolve || !execution || busy || !decision) return;
    setBusy(true); setError(""); setSaved(false);
    try {
      const result = await api.post<RecoveryDetail>(`/actions/${actionId}/recovery/resolve`, {
        organization_id: org.id, expected_execution_id: execution.id, expected_fence: execution.fence_token,
        decision, evidence_note: note.trim(), provider_reference: decision === "ACCEPTED" ? reference.trim() : null,
      });
      qc.setQueryData(key, result);
      for (const prefix of ["outbound-summary", "lead-outbound", "lead-timeline", "activity-feed", "dashboard", "dashboard-attention"]) {
        void qc.invalidateQueries({ queryKey: [prefix] });
      }
      setSaved(true); setDecision(""); setNote(""); setReference("");
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} aria-labelledby="dispatch-recovery-title"
    onClick={(event) => event.stopPropagation()}
    onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }}
    className="fixed inset-0 m-auto w-[min(94vw,680px)] max-h-[90dvh] overflow-y-auto rounded-2xl border border-line bg-surface p-6 text-ink shadow-2xl backdrop:bg-black/50">
    <div className="flex items-center justify-between gap-3">
      <h2 id="dispatch-recovery-title" className="text-lg font-semibold">Send details and recovery</h2>
      <button type="button" aria-label="Close send details" disabled={busy} onClick={onClose} className="rounded-lg p-2 hover:bg-soft"><X className="h-5 w-5" /></button>
    </div>
    {query.isPending && <p role="status" className="mt-4 flex gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading outcome...</p>}
    {(query.isError || error) && <div role="alert" className="mt-4 rounded-lg bg-danger-light p-3 text-sm text-danger">
      <p>{error || message(query.error)}</p>
      <button type="button" disabled={busy || query.isFetching} onClick={() => { setError(""); void query.refetch(); }} className="mt-2 underline">Refresh outcome</button>
    </div>}
    {saved && <p role="status" className="mt-4 rounded-lg bg-ok-light p-3 text-sm text-ok">Recovery decision recorded. No new send was queued.</p>}
    {detail && <div className="mt-5 space-y-4">
      <div className="rounded-xl border border-line bg-soft p-4">
        <p className="font-semibold">{execution ? OUTCOMES[execution.outcome_class] || "Outcome needs review" : detail.attempts_used ? "Historical attempts need investigation" : "No send attempt recorded"}</p>
        {detail.recovery_required && <p className="mt-2 text-sm">Automatic sending is held. Check the provider record before recording an outcome.</p>}
        {detail.hold_reason && <p className="mt-2 text-sm text-muted">{detail.hold_reason.replaceAll("_", " ").toLowerCase()}</p>}
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">Attempts</dt><dd>{detail.attempts_used} of {detail.max_attempts} used; {detail.attempts_remaining} remaining</dd>
          <dt className="text-muted">Next retry</dt><dd>{date(detail.next_attempt_at)}</dd>
          <dt className="text-muted">Retry deadline</dt><dd>{date(detail.retry_deadline_at)}</dd>
          {execution?.provider && <><dt className="text-muted">Provider</dt><dd>{execution.provider}</dd></>}
          {execution?.provider_reference && <><dt className="text-muted">Provider reference</dt><dd className="break-all">{execution.provider_reference}</dd></>}
        </dl>
      </div>
      {detail.can_resolve && execution ? <form onSubmit={submit} className="space-y-3">
        <p className="text-sm">Record verified acceptance or close the action without another attempt. Neither choice sends a message or confirms delivery.</p>
        <label className="block text-sm font-medium">Outcome
          <select required disabled={busy} value={decision} onChange={(event) => setDecision(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-page p-2">
            <option value="">Choose an outcome</option>
            {detail.allowed_decisions.includes("ACCEPTED") && <option value="ACCEPTED">Provider confirmed acceptance</option>}
            {detail.allowed_decisions.includes("CLOSE_WITHOUT_RETRY") && <option value="CLOSE_WITHOUT_RETRY">Close without retry</option>}
          </select>
        </label>
        {decision === "ACCEPTED" && <label className="block text-sm font-medium">Verified provider reference
          <input required disabled={busy} maxLength={512} value={reference} onChange={(event) => setReference(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-page p-2" />
        </label>}
        <label className="block text-sm font-medium">Evidence and reason
          <textarea required disabled={busy} maxLength={2000} rows={4} value={note} onChange={(event) => setNote(event.target.value)}
            placeholder="Record what you checked, where, and the result. Do not paste credentials."
            className="mt-1 w-full rounded-lg border border-line bg-page p-2" />
        </label>
        <button disabled={busy || query.isFetching || !!error || !decision || !note.trim() || (decision === "ACCEPTED" && !reference.trim())}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "Recording..." : "Record recovery decision"}
        </button>
      </form> : <p className="text-sm text-muted">{detail.recovery_required
        ? "This history needs an operator investigation. It cannot be safely resolved through this action."
        : "No recovery decision is available for this state. Accepted requests still need delivery evidence."}</p>}
      {detail.executions.length > 0 && <div className="border-t border-line pt-3">
        <h3 className="text-sm font-semibold">Attempt history</h3>
        {detail.executions.map((item) => <div key={item.id} className="mt-2 text-sm">
          <p>Attempt {item.attempt} / {date(item.started_at)}</p>
          <DispatchOutcome outcome={item.outcome_class} />
          {item.provider_reference && <p className="break-all text-muted">Reference: {item.provider_reference}</p>}
        </div>)}
      </div>}
      {detail.resolutions.length > 0 && <div className="border-t border-line pt-3">
        <h3 className="text-sm font-semibold">Recorded decisions</h3>
        {detail.resolutions.map((item, index) => <div key={index} className="mt-2 text-sm">
          <p>{item.decision === "ACCEPTED" ? "Acceptance recorded" : "Closed without retry"} / {date(item.created_at)}</p>
          <p className="whitespace-pre-wrap text-muted">{item.evidence_note}</p>
        </div>)}
      </div>}
    </div>}
  </dialog>;
}
