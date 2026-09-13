import { useState, type ReactNode } from "react";
import { Loader2, RefreshCw, History } from "lucide-react";
import { ApiError } from "@/lib/api";
import { useContextHistory } from "@/hooks/use-business-context";
import type { RevisionMetadata } from "@/types/business-context";

export const contextFieldClass = "w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30";
export function contextError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return "This context changed in another session. Your draft is preserved. Load the latest saved values before editing again.";
    if (error.status === 403) return "A current workspace owner is required to save this context.";
    if (error.status >= 400 && error.status < 500 && typeof error.body === "object" && error.body !== null && "error" in error.body && typeof error.body.error === "string") return error.body.error;
  }
  return "Context could not be loaded or saved. Please try again.";
}
export function ContextLoadState({ error, retry }: { error?: unknown; retry: () => void }) {
  return <div className="rounded-xl border border-line p-5 text-sm" role={error ? "alert" : "status"}>
    {error ? contextError(error) : "Loading saved context..."}
    {!!error && <button type="button" onClick={retry} className="ml-3 text-brand underline">Try again</button>}
  </div>;
}
export function ContextEditor<T, R extends RevisionMetadata>({ title, description, current, value, owner, refresh, save, fields, summary, leadId, refreshError, readOnlyReason }: {
  title: string; description: string; current: R; value: (revision: R) => T; owner: boolean;
  refresh: () => Promise<R>; save: (draft: T, revision: number, reason: string) => Promise<R>;
  fields: (draft: T, change: (next: T) => void) => ReactNode; summary: (revision: R) => ReactNode;
  leadId?: string; refreshError?: boolean; readOnlyReason?: string;
}) {
  const [draft, setDraft] = useState<T>(() => structuredClone(value(current)));
  const [revision, setRevision] = useState(current.revision);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [saved, setSaved] = useState(false), [conflict, setConflict] = useState(false);
  const [reloadPrompt, setReloadPrompt] = useState(false);
  const changed = revision !== current.revision || conflict;
  function load(next: R) { setDraft(structuredClone(value(next))); setRevision(next.revision); setReason(""); setConflict(false); setReloadPrompt(false); }
  function edit(next: T) { setDraft(next); setSaved(false); setReloadPrompt(false); }
  async function reload() { setBusy(true); setError(null); setSaved(false); try { load(await refresh()); } catch(e) { setError(contextError(e)); } finally { setBusy(false); } }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy || changed || !reason.trim()) return;
    setBusy(true); setError(null); setSaved(false);
    try { load(await save(draft, revision, reason.trim())); setSaved(true); }
    catch(e) { setError(contextError(e)); if (e instanceof ApiError && e.status === 409) setConflict(true); }
    finally { setBusy(false); }
  }
  return <section className="max-w-4xl min-w-0 space-y-5" aria-label={title}>
    <div><h2 className="text-lg font-semibold text-ink">{title}</h2><p className="mt-1 text-sm text-muted">{description}</p></div>
    <p className="rounded-lg border border-line bg-soft p-3 text-sm text-muted">Saving context preserves its history. Refresh intelligence after a change; previously reviewed sends may need a new review. Context does not grant permission to contact anyone.</p>
    {refreshError && <p role="alert" className="text-sm text-warn">The saved context could not refresh. Your draft is preserved; displayed history may be outdated.</p>}
    {owner ? <form onSubmit={submit} className="space-y-5">
      {changed && <p role="alert" className="rounded-lg border border-warn bg-warn-light p-3 text-sm text-warn">A newer revision exists. Your draft is preserved. Load the latest saved values before editing again.</p>}
      <fieldset disabled={busy} className="min-w-0 space-y-4">{fields(draft, edit)}
        <label className="block text-sm space-y-1">Reason for this change<textarea aria-label="Reason for this change" className={contextFieldClass} required maxLength={2000} rows={2} value={reason} onChange={e => { setReason(e.target.value); setSaved(false); }} /></label>
      </fieldset>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {saved && <p role="status" className="text-sm text-ok">{title} saved. Revision {revision} is current.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy || changed || !reason.trim()} className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save {title.toLowerCase()}</button>
        <button type="button" disabled={busy} onClick={() => setReloadPrompt(true)} className="inline-flex items-center gap-1.5 text-sm text-brand disabled:opacity-50"><RefreshCw className="h-4 w-4" />Load latest values</button>
        <span className="text-xs text-muted">Editing revision {revision}{revision === 0 ? " (not yet saved)" : ""}</span>
      </div>
      {reloadPrompt && <div role="alert" className="rounded-lg border border-warn bg-warn-light p-3 text-sm text-warn space-y-2"><p>Loading the saved revision will replace this draft and its reason.</p><div className="flex flex-wrap gap-4"><button type="button" disabled={busy} onClick={() => void reload()} className="underline">Replace draft with saved values</button><button type="button" disabled={busy} onClick={() => setReloadPrompt(false)} className="underline">Keep editing</button></div></div>}
    </form> : <div className="space-y-3"><p className="text-sm text-muted">{readOnlyReason || "A workspace owner can edit this context."}</p>{summary(current)}</div>}
    <ContextHistoryView<R> leadId={leadId} summary={summary} />
  </section>;
}
function ContextHistoryView<R extends RevisionMetadata>({ leadId, summary }: { leadId?: string; summary: (revision: R) => ReactNode }) {
  const [open, setOpen] = useState(false), [before, setBefore] = useState<number | undefined>(undefined);
  const history = useContextHistory<R>(leadId, before, open);
  return <section className="border-t border-line pt-4">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex gap-2 items-center text-sm text-brand"><History className="h-4 w-4" />{open ? "Hide revision history" : "View revision history"}</button>
    {open && <div className="mt-4 space-y-3">{history.isError ? <ContextLoadState error={history.error} retry={() => void history.refetch()} /> : !history.data ? <p role="status" className="text-sm text-muted">Loading revision history...</p> : <>
      {!history.data.items.length && <p className="text-sm text-muted">No saved revisions yet.</p>}
      {history.data.items.map(item => <details key={item.revision} className="rounded-xl border border-line p-4"><summary className="cursor-pointer text-sm font-medium">Revision {item.revision} - {item.created_at ? new Date(item.created_at).toLocaleString() : "Time unknown"}</summary><p className="mt-3 text-sm text-muted break-words">Change reason: {item.reason}</p><div className="mt-3">{summary(item)}</div></details>)}
      <div className="flex gap-4">{before && <button type="button" onClick={() => setBefore(undefined)} className="text-sm text-brand">Latest revisions</button>}{history.data.next_before_revision && <button type="button" onClick={() => setBefore(history.data!.next_before_revision!)} className="text-sm text-brand">Older revisions</button>}</div>
    </>}</div>}
  </section>;
}
