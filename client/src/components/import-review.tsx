import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { IdentityResolutionDialog, ResolutionRecord } from "./identity-resolution";
import { Loader2, RefreshCw, ArrowLeft } from "lucide-react";
import { useImport, useImportOperations } from "@/hooks/use-imports";
import { ApiError } from "@/lib/api";
import { contextFieldClass } from "./context-editor";
import { EnquirySummary } from "./enquiry-context";
import { importLabels, type ImportDetail, type ImportRow, type ImportTarget } from "@/types/imports";

export function importError(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) return "This import review changed. Your draft is preserved. Load the latest saved review before continuing.";
  if (error instanceof ApiError && error.status === 403) return "A current workspace owner is required to change this import.";
  if (error instanceof ApiError && error.status >= 400 && error.status < 500 && typeof error.body === "object" && error.body !== null && "error" in error.body && typeof error.body.error === "string") return error.body.error;
  return "The import could not be loaded or updated. Please try again.";
}
function rawValues(row: ImportRow) { return row.raw_cells?.length ? row.raw_cells : Object.values(row.raw_row || {}); }

type CorrectionDraft = { rowId: string; revision: number; values: Partial<Record<ImportTarget, string | null>>; reason: string };
export function ImportReview({ importId, owner }: { importId: string; owner: boolean }) {
  const query = useImport(importId);
  if (!query.data) return <div role={query.isError ? "alert" : "status"} className="rounded-xl border border-line p-4 text-sm">{query.isError ? importError(query.error) : "Loading saved import..."}{query.isError && <button type="button" className="ml-3 text-brand underline" onClick={() => void query.refetch()}>Try again</button>}</div>;
  return <Review key={importId} current={query.data} owner={owner} refreshError={query.isError} refresh={async () => { const result = await query.refetch(); if (!result.data || result.error) throw result.error; return result.data; }} />;
}
function Review({ current, owner, refreshError, refresh }: { current: ImportDetail; owner: boolean; refreshError: boolean; refresh: () => Promise<ImportDetail> }) {
  const operations = useImportOperations();
  const [searchParams] = useSearchParams();
  const focusedRow = current.rows.find(row => row.id === searchParams.get("row"));
  const [identityRow, setIdentityRow] = useState<ImportRow | null>(null);
  const [selection, setSelection] = useState<string[]>([]), [selectionRevision, setSelectionRevision] = useState(current.review_revision);
  const [page, setPage] = useState(() => focusedRow ? Math.floor(current.rows.indexOf(focusedRow) / 25) : 0), [filter, setFilter] = useState("ALL");
  const [working, setWorking] = useState(false), [refreshing, setRefreshing] = useState(false), [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false), [draft, setDraft] = useState<CorrectionDraft | null>(null);
  const stop = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stop.current = true; }; }, []);
  const frozen = current.frozen_selection !== null;
  const reviewed = current.contract_version === 2;
  const stale = selection.length > 0 && selectionRevision !== current.review_revision;
  const editable = owner && reviewed && !frozen && current.state === "READY_TO_COMMIT" && !working;
  const eligible = current.rows.filter(row => row.can_commit && !row.committed && row.commit_state !== "HELD");
  const filtered = current.rows.filter(row => filter === "ALL" || filter === "ELIGIBLE" && row.can_commit || filter === "ERRORS" && row.validation_state === "INVALID" || filter === "UNRESOLVED" && !row.identity_resolution && (row.duplicate_candidates.length > 0 || row.commit_state === "HELD") || filter === "HELD" && (row.duplicate_candidates.length > 0 || row.commit_state === "HELD"));
  const pages = Math.max(1, Math.ceil(filtered.length / 25));
  const visible = filtered.slice(Math.min(page, pages - 1) * 25, (Math.min(page, pages - 1) + 1) * 25);
  function select(ids: string[]) { setSelection(ids); setSelectionRevision(current.review_revision); }
  async function reload() { setRefreshing(true); setError(null); try { await refresh(); operations.refreshData(); } catch { setError("Saved import progress could not be loaded. Try refreshing again before importing more rows."); } finally { setRefreshing(false); } }
  async function run() {
    if (!owner || working || !reviewed || stale) return;
    const ids = current.frozen_selection || selection;
    if (!ids.length) return;
    const revision = frozen ? current.review_revision : selectionRevision;
    stop.current = false; setStopping(false); setWorking(true); setError(null);
    try {
      let next: ImportDetail;
      do {
        next = await operations.commit(current.import_id, { expected_revision: revision, selected_row_ids: ids });
      } while (mounted.current && !stop.current && next.state === "COMMITTING" && next.progress.remaining_rows > 0);
    } catch (failure) {
      if (mounted.current) {
        setError(failure instanceof ApiError && failure.status < 500 ? importError(failure) : "The last import step could not be confirmed. Check the saved progress, then explicitly resume the same selection if rows remain.");
        try { await refresh(); operations.refreshData(); } catch { setError("The last step and latest progress could not be confirmed. Refresh saved progress before resuming; do not create a new upload to retry."); }
      }
    } finally { if (mounted.current) { setWorking(false); setStopping(false); } }
  }
  return <section className="min-w-0 max-w-7xl space-y-5" aria-label="Import review">
    <Link className="inline-flex gap-1 items-center text-sm text-brand" to="/imports"><ArrowLeft className="h-4 w-4" />All imports / new file</Link>
    <div><h2 className="text-lg font-semibold break-words">{current.import.filename}</h2><p className="mt-1 text-sm text-muted">Review source values, corrections and selected rows. Imported data is unverified and does not grant permission to contact anyone.</p></div>
    {!reviewed && <p role="alert" className="rounded-lg border border-warn bg-warn-light p-3 text-sm text-warn">This historical or compatibility import is available for inspection. Start a new reviewed preview for new work; its recorded outcomes remain unchanged.</p>}
    <div className="rounded-xl border border-line bg-surface p-4 space-y-2" role="status" aria-label="Import progress">
      <p className="font-medium">{current.state === "COMMITTED" ? "Selected rows processed" : frozen ? "Import selection is fixed" : "Preview ready - choose rows or review identities"}</p>
      <p className="text-xs text-muted">Original selected import progress</p>
      <p className="text-sm">{current.progress.committed_rows} imported / {current.progress.selected_rows} selected; {current.progress.held_rows} held for review; {current.progress.remaining_rows} remaining.</p>
      <p className="text-xs text-muted">{current.summary.total_rows} source rows; {current.summary.invalid_rows} need correction; {current.summary.duplicate_candidate_rows} have duplicate or shared-contact warnings. Processing a selection does not import every source row.</p>
      {frozen && <p className="text-xs text-muted">The saved selection and interpretation cannot change. Resume finishes only its remaining rows. A new duplicate discovered after review is held without creating a lead.</p>}
      <p className="text-xs text-muted">Review revision {current.review_revision}. Phone region: {current.import.source_metadata.default_phone_region || "Historical / unspecified"}; date format: {current.import.source_metadata.options?.date_format || "Historical / unspecified"}; default currency: {current.import.source_metadata.options?.default_currency || "No default"}.</p>
    </div>
    {current.resolution_summary && <section aria-label="Identity resolution progress" className="rounded-xl border border-line bg-surface p-4 space-y-2"><h3 className="font-medium">Identity review outcomes</h3><p className="text-sm">{current.resolution_summary.linked_rows} linked sources; {current.resolution_summary.created_rows} separate enquiries created; {current.resolution_summary.unresolved_duplicate_rows} duplicate rows unresolved.</p><p className="text-xs text-muted">{current.resolution_summary.resolved_held_rows} original held rows have a recorded identity decision. Original selected-row outcomes and counts remain part of import history.</p></section>}
    {focusedRow && <p className="text-sm text-brand">Source link opened row {focusedRow.row_number}; inspect its source or recorded identity decision below.</p>}
    {(error || refreshError || stale) && <div role="alert" className="rounded-lg border border-warn bg-warn-light p-3 text-sm text-warn space-y-2">{error && <p>{error}</p>}{refreshError && <p>The displayed import may be outdated. Load saved progress before continuing.</p>}{stale && <p>The preview changed. Your previous selection is preserved for reference; review the latest rows and select them again.</p>}{stale && <button type="button" className="underline" onClick={() => select([])}>Clear selection and review latest rows</button>}</div>}
    <div className="flex flex-wrap gap-3 items-center">
      <button type="button" disabled={working || refreshing} onClick={() => void reload()} className="inline-flex gap-1 items-center text-sm text-brand disabled:opacity-50"><RefreshCw className="h-4 w-4" />Refresh saved progress</button>
      {editable && <><button type="button" disabled={stale || !eligible.length} onClick={() => select(eligible.map(row => row.id))} className="text-sm text-brand disabled:opacity-50">Select all {eligible.length} eligible rows</button><button type="button" disabled={!selection.length} onClick={() => select([])} className="text-sm text-brand disabled:opacity-50">Clear selection</button><span className="text-sm text-muted">{selection.length} rows chosen</span></>}
      {owner && reviewed && current.state !== "COMMITTED" && <button type="button" disabled={working || refreshing || stale || refreshError || (!frozen && (!editable || !selection.length)) || (frozen && current.progress.remaining_rows === 0)} onClick={() => void run()} className="inline-flex gap-2 items-center rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{working && <Loader2 className="h-4 w-4 animate-spin" />}{working ? "Importing selected rows..." : frozen ? "Resume import" : "Import selected rows"}</button>}
      {working && <button type="button" disabled={stopping} className="text-sm text-brand underline disabled:opacity-50" onClick={() => { stop.current = true; setStopping(true); }}>{stopping ? "Stopping after this step..." : "Stop after current step"}</button>}
    </div>
    {working && <p className="text-xs text-muted">Each step handles at most 25 selected rows. Leaving this page stops requesting further steps; an already requested step can still finish. Reopen this import to inspect progress and resume.</p>}
    {!owner && <p className="text-sm text-muted">Only a workspace owner can correct or commit rows.</p>}
    <label className="block max-w-sm text-sm space-y-1">Show rows<select aria-label="Show rows" className={contextFieldClass} value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }}><option value="ALL">All rows</option><option value="ELIGIBLE">Eligible rows</option><option value="ERRORS">Need correction</option><option value="UNRESOLVED">Unresolved duplicate rows</option><option value="HELD">Duplicate / held history</option></select></label>
    <div className="overflow-x-auto rounded-xl border border-line bg-surface"><table className="w-full text-sm"><thead className="bg-soft"><tr><th className="p-3 text-left">Select</th><th className="p-3 text-left">Row and lead</th><th className="p-3 text-left">Eligibility</th><th className="p-3 text-left">Source and details</th></tr></thead><tbody>
      {visible.map(row => <tr key={row.id} id={"import-row-" + row.id} className={"border-t border-line align-top " + (focusedRow?.id === row.id ? "bg-soft" : "")}><td className="p-3"><input type="checkbox" aria-label={"Select row " + row.row_number} checked={frozen ? current.frozen_selection!.includes(row.id) : selection.includes(row.id)} disabled={!editable || stale || !row.can_commit} onChange={e => select(e.target.checked ? [...selection, row.id] : selection.filter(id => id !== row.id))} /></td>
        <td className="p-3 min-w-48"><p className="text-xs text-muted">Row {row.row_number}</p><p className="font-medium break-words">{row.normalized_values.name || row.normalized_values.company || "Identity needs correction"}</p><p className="break-words text-muted">{row.normalized_values.email || row.normalized_values.normalized_phone || "Contact needs correction"}</p>{row.created_lead_id && <Link className="mt-2 inline-block text-brand underline" to={"/leads/" + encodeURIComponent(row.created_lead_id) + "?tab=enquiry"}>Open imported lead</Link>}</td>
        <td className="p-3 min-w-44"><p className={row.committed ? "text-ok" : row.can_commit ? "text-brand" : "text-warn"}>{row.identity_resolution ? row.identity_resolution.decision === "LINK_EXISTING" ? "Source linked" : "Separate enquiry created" : row.committed ? "Imported" : row.commit_state === "HELD" ? "Held for review" : row.validation_state === "INVALID" ? "Needs correction" : row.duplicate_candidates.length ? "Duplicate review required" : row.can_commit ? "Eligible" : "Unavailable for import"}</p>{row.hold_reason && !row.identity_resolution && <p className="text-xs text-muted mt-1">{row.hold_reason.includes("DUPLICATE") ? "A matching or shared contact requires separate review." : "This row is held for separate review."}</p>}
          {current.issues.filter(issue => issue.import_row_id === row.id).map(issue => <p key={issue.id} className="text-xs text-muted mt-2 break-words">{issue.message}</p>)}{row.duplicate_candidates.filter(candidate => !current.issues.some(issue => issue.import_row_id === row.id && issue.message === candidate.message)).map((candidate, i) => <p key={i} className="text-xs text-muted mt-2">{candidate.message}</p>)}
          {row.identity_resolution && <div className="mt-3"><ResolutionRecord resolution={row.identity_resolution} /></div>}
          {owner && row.can_resolve_identity && !working && !refreshing && <button type="button" className="mt-3 block text-brand underline" aria-label={"Review identity for row " + row.row_number} onClick={() => setIdentityRow(row)}>Review duplicate</button>}
          {editable && !row.identity_resolution && <button type="button" className="mt-3 text-brand underline" aria-label={"Edit row " + row.row_number} onClick={() => setDraft({ rowId: row.id, revision: current.review_revision, values: structuredClone(row.mapped_values), reason: "" })}>Correct row</button>}
        </td>
        <td className="p-3 min-w-60 max-w-2xl"><details><summary className="text-brand cursor-pointer">Inspect row {row.row_number}</summary><div className="mt-3 space-y-4"><div><h3 className="font-medium mb-2">Recorded enquiry</h3>{row.normalized_values.enquiry ? <EnquirySummary enquiry={row.normalized_values.enquiry} /> : <p className="text-xs text-muted">No typed enquiry available in this row.</p>}</div><div><h3 className="font-medium mb-2">Raw source (unchanged)</h3><dl className="space-y-2">{rawValues(row).map((value, index) => <div key={index}><dt className="text-xs font-medium">Column {index + 1}: {(current.import.source_metadata.headers ? current.import.source_metadata.headers[index] : Object.keys(row.raw_row || {})[index]) || "(blank header)"}</dt><dd className="text-xs whitespace-pre-wrap break-words text-muted">{value || "(empty)"}</dd></div>)}</dl></div></div></details></td>
      </tr>)}
    </tbody></table>{!visible.length && <p className="p-4 text-sm text-muted">No rows match this view.</p>}</div>
    <div className="flex flex-wrap items-center gap-4 text-sm"><button type="button" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))} className="text-brand disabled:opacity-40">Previous rows</button><span>Page {Math.min(page, pages - 1) + 1} of {pages} ({filtered.length} rows)</span><button type="button" disabled={page >= pages - 1} onClick={() => setPage(Math.min(pages - 1, page + 1))} className="text-brand disabled:opacity-40">Next rows</button></div>
    {current.issues.some(issue => !issue.import_row_id) && <div className="rounded-xl border border-warn p-4 space-y-2"><h3 className="font-medium">File issues</h3>{current.issues.filter(issue => !issue.import_row_id).map(issue => <p key={issue.id} className="text-sm text-muted">{issue.metadata?.row_number ? "Row " + issue.metadata.row_number + ": " : ""}{issue.message}</p>)}</div>}
    <details className="rounded-xl border border-line p-4"><summary className="cursor-pointer text-sm font-medium">Correction history ({current.corrections?.length || 0})</summary><div className="mt-3 space-y-4">{current.corrections?.length ? current.corrections.map(correction => <article key={correction.id} className="border-t border-line pt-3 space-y-2"><p className="text-sm font-medium">Revision {correction.revision} - row {current.rows.find(row => row.id === correction.import_row_id)?.row_number ?? "unknown"}</p><p className="text-sm text-muted break-words">{correction.reason}</p><dl className="text-xs space-y-1">{Object.keys(correction.after.mapped_values).filter(key => correction.before.mapped_values[key as ImportTarget] !== correction.after.mapped_values[key as ImportTarget]).map(key => <div key={key}><dt className="font-medium">{importLabels[key as ImportTarget]}</dt><dd className="text-muted break-words">{correction.before.mapped_values[key as ImportTarget] || "(empty)"} to {correction.after.mapped_values[key as ImportTarget] || "(empty)"}</dd></div>)}</dl></article>) : <p className="text-sm text-muted">No row corrections recorded.</p>}</div></details>
    {!!current.resolutions?.length && <details className="rounded-xl border border-line p-4"><summary className="cursor-pointer text-sm font-medium">Identity decision history ({current.resolutions.length})</summary><div className="mt-3 space-y-4">{current.resolutions.map(resolution => <article key={resolution.id} className="border-t border-line pt-3 space-y-2"><p className="text-xs text-muted">Row {current.rows.find(row => row.id === resolution.import_row_id)?.row_number ?? "unknown"}</p><ResolutionRecord resolution={resolution} /></article>)}</div></details>}
    {identityRow && <IdentityResolutionDialog importId={current.import_id} rowId={identityRow.id} rowNumber={identityRow.row_number} headers={current.import.source_metadata.headers} onClose={() => setIdentityRow(null)} onResolved={() => { setSelection([]); void refresh().catch(() => setError("Decision saved, but import progress could not refresh. Load saved progress before continuing.")); }} />}
    {draft && <CorrectionEditor draft={draft} row={current.rows.find(row => row.id === draft.rowId)!} onClose={() => setDraft(null)} onSave={async next => { const result = await operations.correct(current.import_id, next.rowId, { expected_revision: next.revision, values: next.values, reason: next.reason }); setSelection([]); setSelectionRevision(result.review_revision); setDraft(null); }} onReload={async () => { const next = await refresh(); const row = next.rows.find(item => item.id === draft.rowId); if (!row) throw new Error("Row no longer available"); setDraft({ rowId: row.id, revision: next.review_revision, values: structuredClone(row.mapped_values), reason: "" }); }} />}
  </section>;
}
function CorrectionEditor({ draft, row, onClose, onSave, onReload }: { draft: CorrectionDraft; row: ImportRow; onClose: () => void; onSave: (draft: CorrectionDraft) => Promise<void>; onReload: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(draft), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [conflict, setConflict] = useState(false);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  useEffect(() => { setValue(draft); setConflict(false); setError(null); }, [draft]);
  async function submit(event: React.FormEvent) { event.preventDefault(); if (busy || conflict || !value.reason.trim()) return; setBusy(true); setError(null); try { await onSave({ ...value, reason: value.reason.trim() }); } catch (failure) { setError(importError(failure)); if (failure instanceof ApiError && failure.status === 409) setConflict(true); } finally { setBusy(false); } }
  return <dialog ref={dialog} aria-labelledby="correction-title" onCancel={e => { if (busy) e.preventDefault(); else onClose(); }} className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl border border-line bg-surface p-5 text-ink shadow-xl backdrop:bg-black/40">
    <form onSubmit={submit} className="space-y-4"><h2 id="correction-title" className="text-lg font-semibold">Correct row {row.row_number}</h2><p className="text-sm text-muted">Change interpreted values before importing. Original cells remain unchanged; this correction and its reason are recorded. Selection must be reviewed again after saving.</p>
      <fieldset disabled={busy} className="space-y-4"><div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{Object.entries(value.values).map(([key, text]) => <label key={key} className="block text-sm space-y-1">{importLabels[key as ImportTarget]}<textarea aria-label={"Correct " + importLabels[key as ImportTarget]} rows={2} maxLength={4096} className={contextFieldClass} value={text || ""} onChange={e => setValue({ ...value, values: { ...value.values, [key]: e.target.value || null } })} /></label>)}</div>
        <label className="block text-sm space-y-1">Correction reason<textarea aria-label="Correction reason" className={contextFieldClass} required maxLength={2000} rows={2} value={value.reason} onChange={e => setValue({ ...value, reason: e.target.value })} /></label>
      </fieldset>{error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-3"><button type="submit" disabled={busy || conflict || !value.reason.trim()} className="rounded-lg bg-brand px-4 py-2 text-sm text-white disabled:opacity-50">Save row correction</button><button type="button" disabled={busy} onClick={onClose} className="text-sm text-brand">Cancel correction</button>{conflict && <button type="button" disabled={busy} className="text-sm text-brand underline" onClick={async () => { setBusy(true); try { await onReload(); } catch { setError("Latest row could not be loaded. Your draft is preserved."); } finally { setBusy(false); } }}>Discard draft and load latest row</button>}</div>
    </form>
  </dialog>;
}
