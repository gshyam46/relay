import {useNavigate} from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";

interface ReviewResponse {
  action: { id: string; status: string; lead_id: string };
  approval: { status: string } | null;
  prepared_revision: {
    id: string;
    revision: number;
    envelope: {
      channel: string;
      recipient: string | null;
      sender: { provider: string; from: string; reply_to?: string | null } | null;
      subject: string | null;
      body: string;
      scheduled_at: string | null;
    };
  } | null;
}

function reviewMessage(error: unknown) {
  if (error instanceof ApiError && error.body && typeof error.body === "object") {
    const body = error.body as { error?: string; message?: string };
    return body.error || body.message || "Review could not be saved. Refresh the preview and try again.";
  }
  return "Review could not be loaded or saved. Check your connection and try again.";
}

// Every decision is made against the exact server preview currently displayed.
// A batch is reviewed one item at a time; fetching an unseen preview never approves it.
export function ApprovalReviewDialog({ actionIds, onClose }: {
  actionIds: string[];
  onClose: () => void;
}) {
  const navigate=useNavigate();
  const org = useWorkspaceStore((s) => s.currentOrg);
  const qc = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const actionId = actionIds[index];

  const invalidate = useCallback(() => {
    for (const key of ["outbound-summary", "lead-outbound", "lead-timeline", "activity-feed", "dashboard", "dashboard-attention"]) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  }, [qc]);

  useEffect(() => {
    const node = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    node?.showModal();
    return () => { node?.close(); previousFocus?.focus(); };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setReview(null);
    setError("");
    setNote("");
    if (!org || !actionId) return;
    api.get<ReviewResponse>(`/actions/${actionId}/approval?organization_id=${encodeURIComponent(org.id)}`)
      .then((result) => {
        if (!active) return;
        setReview(result);
        setSubject(result.prepared_revision?.envelope.subject || "");
        setBody(result.prepared_revision?.envelope.body || "");
        invalidate(); // Preparing a legacy action can move it into the review queue.
      })
      .catch((err) => { if (active) setError(reviewMessage(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [org?.id, actionId, refresh, invalidate]);

  const revision = review?.prepared_revision;
  const envelope = revision?.envelope;
  const dirty = !!envelope && (subject !== (envelope.subject || "") || body !== envelope.body);
  const pending = review?.action.status === "AWAITING_APPROVAL" && review.approval?.status === "PENDING";
  const approved = ["APPROVED", "RETRYING"].includes(review?.action.status || "") && review?.approval?.status === "APPROVED";
  const next = () => {
    invalidate();
    if (index + 1 < actionIds.length) setIndex(index + 1);
    else onClose();
  };

  const save = async (operation: "preview" | "approve" | "reject" | "revoke") => {
    if (!org || !revision || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.post<ReviewResponse>(`/actions/${actionId}/approval/${operation}`, {
        organization_id: org.id,
        expected_revision_id: revision.id,
        ...(operation === "preview" ? { edited_payload: { ...(envelope?.subject !== null ? { subject } : {}), body } } : {}),
        ...(note.trim() ? { reviewer_note: note.trim() } : {}),
      });
      invalidate();
      if (operation === "approve" || operation === "reject") next();
      else {
        setReview(result);
        setSubject(result.prepared_revision?.envelope.subject || "");
        setBody(result.prepared_revision?.envelope.body || "");
      }
    } catch (err) {
      setError(reviewMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const button = "rounded-lg border border-line px-3 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed";
  return (
    <dialog ref={dialog} aria-labelledby="approval-review-title"
      onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }}
      className="fixed inset-0 m-auto w-[min(94vw,760px)] max-h-[90dvh] overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/50">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-6 py-4">
        <div>
          <h2 id="approval-review-title" className="flex items-center gap-2 text-lg font-semibold">
            <ShieldCheck className="h-5 w-5 text-brand" /> Review outbound action
          </h2>
          <p className="mt-1 text-xs text-muted">
            {actionIds.length > 1 ? `Item ${index + 1} of ${actionIds.length}. ` : ""}
            Approval applies to the recipient, sender and content shown here.
          </p>
        </div>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Close review" className="rounded-lg p-2 hover:bg-soft disabled:opacity-50"><X className="h-5 w-5" /></button>
      </div>
      <div className="space-y-4 px-6 py-5">
        {loading && <p role="status" className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Preparing exact preview...</p>}
        {error && <div role="alert" className="rounded-lg border border-danger/30 bg-danger-light p-3 text-sm text-danger">
          <p>{error}</p>
          <button type="button" disabled={busy} onClick={() => setRefresh((value) => value + 1)} className="mt-2 font-semibold underline">Refresh preview</button>
        </div>}
        {!loading && !error && !revision && <div className="text-sm text-muted"><p>This action has no reviewable revision. Check its recipient and sender configuration before preparing a new preview.</p><button type="button" onClick={() => setRefresh((value) => value + 1)} className="mt-2 font-semibold text-brand underline">Refresh preview</button></div>}
        {revision && envelope && <>
          <div className="rounded-xl border border-line bg-soft p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{envelope.channel} / Revision {revision.revision}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">To</dt><dd className="break-all">{envelope.recipient || "Internal task"}</dd>
              <dt className="text-muted">From</dt><dd className="break-all">{envelope.sender?.from || "Workspace"}</dd>
              <dt className="text-muted">Delivery mode</dt><dd>{envelope.sender?.provider === "sandbox" ? "Sandbox simulation" : envelope.sender ? "Connected channel" : "Internal task"}</dd>
              {envelope.channel === "EMAIL" && <><dt className="text-muted">Reply-To</dt><dd className="break-all">{envelope.sender?.reply_to || "Not configured"}</dd></>}
              {envelope.scheduled_at && <><dt className="text-muted">Scheduled</dt><dd>{new Date(envelope.scheduled_at).toLocaleString()}</dd></>}
            </dl>
            {envelope.sender?.provider === "sandbox" && <p className="mt-3 text-sm text-warn">Simulation only. This sender does not deliver a real message.</p>}
          </div>
          {envelope.channel === "EMAIL" && pending && <button type="button" className={button} onClick={()=>{onClose();navigate("/leads/"+review!.action.lead_id+"?tab=outbound&compose_action="+actionId);}}>Edit message and schedule</button>}
          {envelope.subject !== null && <label className="block text-sm font-medium">
            Subject
            <input value={subject} onChange={(event) => setSubject(event.target.value)} disabled={!pending || busy} maxLength={200}
              className="mt-1.5 w-full rounded-lg border border-line bg-page px-3 py-2 disabled:opacity-80" />
          </label>}
          <label className="block text-sm font-medium">
            {envelope.channel === "VOICE" ? "Spoken message" : envelope.channel === "HUMAN_TASK" ? "Task details" : "Message"}
            <textarea value={body} onChange={(event) => setBody(event.target.value)} disabled={!pending || busy} maxLength={10000} rows={9}
              className="mt-1.5 w-full rounded-lg border border-line bg-page px-3 py-2 font-normal leading-relaxed disabled:opacity-80" />
          </label>
          {dirty && <p role="status" className="text-sm text-warn">Your edits are not the saved preview yet. Update the preview, read it, then approve the new revision.</p>}
          {(pending || approved) && <label className="block text-sm font-medium">Review note (optional)
            <textarea value={note} onChange={(event) => setNote(event.target.value)} disabled={busy} rows={2} maxLength={2000}
              className="mt-1.5 w-full rounded-lg border border-line bg-page px-3 py-2 font-normal" />
          </label>}
          {approved && <p className="text-sm text-muted">This revision is approved. Revoke approval to hold the action and prepare changes. A send that has already started cannot be recalled here.</p>}
          {!pending && !approved && <p className="text-sm text-muted">Action status: {review?.action.status}. Decisions are closed for this action.</p>}
        </>}
      </div>
      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-6 py-4">
        {actionIds.length > 1 && <button type="button" onClick={next} disabled={busy} className={button}>Skip item</button>}
        <button type="button" onClick={onClose} disabled={busy} className={button}>Close</button>
        {pending && revision && <>
          <button type="button" onClick={() => save("reject")} disabled={busy || dirty} className={button + " text-danger"}>Reject this revision</button>
          {dirty
            ? <button type="button" onClick={() => save("preview")} disabled={busy || !body.trim() || (envelope?.subject !== null && !subject.trim())} className={button + " bg-brand text-white"}>Update preview</button>
            : <button type="button" onClick={() => save("approve")} disabled={busy || !!error} className={button + " bg-brand text-white"}>Approve this revision</button>}
        </>}
        {approved && revision && <button type="button" onClick={() => save("revoke")} disabled={busy} className={button + " text-danger"}>Revoke approval</button>}
        {busy && <span role="status" aria-label="Saving review"><Loader2 className="h-4 w-4 animate-spin text-brand" /></span>}
      </div>
    </dialog>
  );
}
