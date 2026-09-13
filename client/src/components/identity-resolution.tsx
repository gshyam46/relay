import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useImportOperations } from "@/hooks/use-imports";
import { ApiError } from "@/lib/api";
import { contextFieldClass } from "./context-editor";
import { EnquirySummary } from "./enquiry-context";
import { identityClassificationLabels, type IdentityClassification, type IdentityCommand, type IdentityDecision, type IdentityResolution, type IdentityReview, type ImportRow } from "@/types/imports";

function identityError(error: unknown) {
  if (error instanceof ApiError && error.status === 409) return "This comparison changed. Your draft is preserved. Refresh the comparison and review it again before saving.";
  if (error instanceof ApiError && error.status >= 400 && error.status < 500 && typeof error.body === "object" && error.body !== null && "error" in error.body && typeof error.body.error === "string") return error.body.error;
  return "The saved decision could not be confirmed. Check its history before retrying.";
}
function unavailableText(reason: string | null) {
  const messages: Record<string, string> = {
    IDENTITY_CANDIDATE_LIMIT: "Too many matching records for a safe bounded review. This requires operational review.",
    IDENTITY_POLICY_LIMIT: "Too many contact-policy records for a safe bounded review. Keep this row unresolved until operational review is complete.",
    IDENTITY_ALREADY_RESOLVED: "This row already has a recorded identity decision.",
    IDENTITY_REVIEWED_IMPORT_REQUIRED: "Start a reviewed import to make an identity decision. This historical source remains available for inspection.",
    IDENTITY_ROW_INVALID: "Correct this row's validation errors before reviewing its identity.",
    IDENTITY_RESUME_IMPORT_FIRST: "Resume the saved import first. Identity review becomes available when its selected rows finish processing.",
    IDENTITY_ROW_ALREADY_COMMITTED: "This row already created an enquiry through the original import.",
    IDENTITY_NO_DUPLICATE_EVIDENCE: "No duplicate evidence remains. Refresh the import and use its ordinary row-selection flow.",
    IDENTITY_ROW_UNAVAILABLE: "Refresh the saved import and inspect this row's current state before continuing."
  };
  return reason && messages[reason] || "Refresh or finish the saved import before continuing.";
}
export function ResolutionRecord({ resolution }: { resolution: IdentityResolution }) {
  return <div className="space-y-2 text-sm"><p className="font-medium">{resolution.decision === "LINK_EXISTING" ? "Linked to the same enquiry" : "Created a separate enquiry"} - {identityClassificationLabels[resolution.classification]}</p><p className="text-muted break-words">{resolution.reason}</p><p className="text-xs text-muted">{new Date(resolution.created_at).toLocaleString()} - reviewer {resolution.created_by}</p><Link className="text-brand underline" to={"/leads/" + encodeURIComponent(resolution.lead_id) + "?tab=enquiry"}>Open resolved enquiry</Link>{resolution.decision === "LINK_EXISTING" && <p className="text-xs text-muted">Source attached. Current enquiry facts, contact details and messages were unchanged by this decision.</p>}</div>;
}
export function ImportSourceValues({ values, rawCells, rawRow, headers }: { values: ImportRow["normalized_values"]; rawCells?: string[] | null; rawRow?: Record<string, string>; headers?: string[] }) {
  const cells = rawCells?.length ? rawCells : Object.values(rawRow || {});
  return <div className="min-w-0 space-y-3 text-sm"><dl className="space-y-1"><div><dt className="text-xs text-muted">Name / company</dt><dd className="break-words">{values.name || "Unknown name"}{values.company ? " / " + values.company : ""}</dd></div><div><dt className="text-xs text-muted">Email / phone</dt><dd className="break-words">{values.email || "Unknown email"} / {values.normalized_phone || values.raw_phone || "Unknown phone"}</dd></div></dl>{values.enquiry ? <EnquirySummary enquiry={values.enquiry} /> : <p className="text-muted">No typed enquiry recorded.</p>}{cells.length > 0 && <details><summary className="cursor-pointer text-brand">Raw source cells</summary><dl className="mt-2 space-y-2">{cells.map((cell, index) => <div key={index}><dt className="text-xs font-medium">Column {index + 1}{headers ? ": " + (headers[index] || "(blank header)") : ""}</dt><dd className="text-xs text-muted whitespace-pre-wrap break-words">{cell || "(empty)"}</dd></div>)}</dl></details>}</div>;
}
export function IdentityResolutionDialog({ importId, rowId, rowNumber, headers, onClose, onResolved }: { importId: string; rowId: string; rowNumber: number; headers?: string[]; onClose: () => void; onResolved: () => void }) {
  const operations = useImportOperations(), dialog = useRef<HTMLDialogElement>(null), active = useRef(true);
  const [review, setReview] = useState<IdentityReview | null>(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState<IdentityDecision | "">(""), [classification, setClassification] = useState<IdentityClassification | "">(""), [target, setTarget] = useState("");
  const [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false), [stale, setStale] = useState(false), [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<IdentityCommand | null>(null), [checkedRecovery, setCheckedRecovery] = useState(false), [candidatePage, setCandidatePage] = useState(0);
  useEffect(() => { active.current = true; const element = dialog.current; element?.showModal(); void load(); return () => { active.current = false; element?.close(); }; }, []);
  async function load() {
    setLoading(true); setError(null);
    try { const next = await operations.reviewIdentity(importId, rowId); if (!active.current) return; setReview(next); setStale(false); setConfirmed(false); setCandidatePage(0); if (next.resolution) { setUncertain(null); onResolved(); } }
    catch (failure) { if (active.current) setError(identityError(failure)); }
    finally { if (active.current) setLoading(false); }
  }
  async function checkSaved(command: IdentityCommand | null, message: string) {
    setCheckedRecovery(false);
    try {
      const next = await operations.reviewIdentity(importId, rowId); if (!active.current) return;
      if (next.resolution) { setReview(next); setUncertain(null); setError(null); onResolved(); operations.refreshData(); }
      else { if (command) { setReview(next); setUncertain(command); setCheckedRecovery(true); } setError(message); }
    } catch { if (active.current) setError("The decision and latest history could not be confirmed. Check saved decision before any retry. Closing this dialog does not undo an admitted request."); }
  }
  async function save(command: IdentityCommand) {
    if (busy) return;
    setBusy(true); setError(null);
    try { const result = await operations.resolveIdentity(importId, rowId, command); if (active.current) { setReview(current => current ? { ...current, can_resolve: false, resolution: result.resolution } : current); setUncertain(null); onResolved(); } }
    catch (failure) {
      if (!active.current) return;
      if (failure instanceof ApiError && failure.status >= 400 && failure.status < 500) {
        setUncertain(null); setStale(failure.status === 409); setConfirmed(false); await checkSaved(null, identityError(failure));
      } else { setUncertain(command); setConfirmed(false); await checkSaved(command, "No saved decision was found after the interrupted request. Retry only this same decision; it may still be completing."); }
    } finally { if (active.current) setBusy(false); }
  }
  function choose(next: IdentityDecision) { setDecision(next); setClassification(next === "LINK_EXISTING" ? "SAME_ENQUIRY" : ""); setTarget(""); setConfirmed(false); }
  const selected = review?.existing_candidates.find(candidate => candidate.lead.id === target);
  const valid = !!review?.can_resolve && !!review.review_token && !!decision && !!classification && !!reason.trim() && confirmed && !stale && !uncertain && (decision === "CREATE_SEPARATE" || !!selected?.can_link);
  const pages = Math.max(1, Math.ceil((review?.existing_candidates.length || 0) / 10));
  return <dialog ref={dialog} aria-labelledby="identity-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-6xl max-h-[90vh] overflow-y-auto rounded-xl border border-line bg-surface p-5 text-ink shadow-xl backdrop:bg-black/40">
    <div className="space-y-5"><div className="flex items-start justify-between gap-3"><div><h2 id="identity-title" className="text-lg font-semibold">Review identity for row {rowNumber}</h2><p className="mt-1 text-sm text-muted">A matching address can belong to another enquiry or to different people. Review the source and choose explicitly.</p></div><button type="button" disabled={busy} onClick={onClose} className="text-sm text-brand disabled:opacity-50">Close review</button></div>
      {error && <p role="alert" className="rounded-lg border border-warn bg-warn-light p-3 text-sm text-warn">{error}</p>}
      {loading && <p role="status" className="text-sm text-muted">Loading current source and candidate comparison...</p>}
      {!review && !loading && <button type="button" onClick={() => void load()} className="text-sm text-brand underline">Try loading comparison again</button>}
      {review?.resolution ? <section aria-label="Saved identity decision" className="rounded-xl border border-line bg-soft p-4 space-y-3"><h3 className="font-semibold">Recorded identity decision</h3><ResolutionRecord resolution={review.resolution} /><p className="text-xs text-muted">This source row has one final recorded decision. Repeated requests do not create another enquiry.</p></section> : review && <>
        {!review.can_resolve && <p role="alert" className="rounded-lg border border-warn p-3 text-sm text-warn">This row cannot be resolved now: {unavailableText(review.unavailable_reason)}</p>}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5"><section className="min-w-0 rounded-xl border border-line p-4 space-y-3"><h3 className="font-semibold">Source enquiry - row {rowNumber}</h3>{(review.row.contact_policy?.restricted || review.row.contact_policy?.policy_pending) && <p className="text-sm text-warn">{review.row.contact_policy.restricted ? "This source contact has a recorded restriction." : "Contact policy processing is pending for this source."} Creating or linking an enquiry does not grant sending permission.</p>}<ImportSourceValues values={review.row.normalized_values} rawCells={review.row.raw_cells} rawRow={review.row.raw_row} headers={headers} /></section>
          <section className="min-w-0 space-y-3" aria-label="Existing enquiry candidates"><h3 className="font-semibold">Existing enquiries</h3><p className="text-xs text-muted">Showing {review.existing_candidates.length} of {review.existing_total} matching enquiries.{review.existing_truncated ? " The displayed list is limited to 50. More matches exist; creating separately does not modify them." : " A candidate is not a verified person match."}</p>
            {!review.existing_candidates.length && <p className="text-sm text-muted">No existing enquiry candidate. For duplicates within this file, explicitly create an enquiry from one row first, then refresh the other row to link it.</p>}
            {review.existing_candidates.slice(candidatePage * 10, (candidatePage + 1) * 10).map(candidate => <article key={candidate.lead.id} className="rounded-xl border border-line p-3 space-y-2"><p className="font-medium text-sm break-words">{candidate.lead.name || candidate.lead.company || "Unnamed enquiry"}</p><p className="text-xs text-muted break-words">{candidate.lead.normalized_email || "Unknown email"} / {candidate.lead.normalized_phone || "Unknown phone"}</p><p className="text-xs text-muted">Match: {candidate.match_types.map(type => type.replaceAll("_", " ").toLowerCase()).join(", ")}</p>
              {(candidate.contact_policy.restricted || candidate.contact_policy.policy_pending) ? <p className="text-xs text-warn">{candidate.contact_policy.restricted ? "Contact restriction recorded. " : "Contact policy processing is pending. "}Identity decisions do not clear restrictions.</p> : <p className="text-xs text-muted">No recorded contact restriction in this review. This does not grant permission.</p>}
              <label className="flex items-start gap-2 text-sm"><input type="radio" name="identity-target" aria-label={"Link target " + (candidate.lead.name || candidate.lead.id)} checked={target === candidate.lead.id} disabled={busy || loading || !!uncertain || !candidate.can_link} onChange={() => { setTarget(candidate.lead.id); setConfirmed(false); }} className="mt-1" />Choose as the same enquiry</label>{!candidate.can_link && <p className="text-xs text-warn">{candidate.lead.archived_at || candidate.link_block_reason === "LEAD_ARCHIVED" ? "Link unavailable: this enquiry is archived. Restore it before linking a new source, or explicitly review creating a separate enquiry." : "Link unavailable: email and phone must both match, including unknown values. " + (candidate.link_block_reason === "LEGACY_CONTACT_CONFLICT" ? "Stored contact details disagree and need a separate correction review." : "Review different or additional contact details separately.")}</p>}
              <details><summary className="cursor-pointer text-sm text-brand">Compare current facts - revision {candidate.enquiry_revision}</summary><div className="mt-2 space-y-2"><EnquirySummary enquiry={candidate.enquiry} /><Link className="text-xs text-brand underline" to={"/leads/" + candidate.lead.id + "?tab=enquiry"}>Open candidate enquiry</Link></div></details></article>)}
            {pages > 1 && <div className="flex gap-3 text-sm"><button type="button" disabled={candidatePage === 0} className="text-brand disabled:opacity-40" onClick={() => setCandidatePage(candidatePage - 1)}>Previous candidates</button><span>Page {candidatePage + 1} of {pages}</span><button type="button" disabled={candidatePage >= pages - 1} className="text-brand disabled:opacity-40" onClick={() => setCandidatePage(candidatePage + 1)}>Next candidates</button></div>}
          </section></div>
        {!!review.row_total && <section className="rounded-xl border border-line p-4 space-y-3"><h3 className="font-semibold text-sm">Other matching rows in this file</h3><p className="text-xs text-muted">Showing {review.row_candidates.length} of {review.row_total} rows.{review.row_truncated ? " This list is limited to the first 20 matching rows." : ""} A source row is not yet an existing enquiry unless its decision created or linked one.</p>{review.row_candidates.map(row => <details key={row.id}><summary className="cursor-pointer text-sm text-brand">Matching row {row.row_number}{row.resolution ? " - already resolved" : " - review required"}</summary><div className="mt-2 space-y-3"><ImportSourceValues values={row.normalized_values} />{row.resolution && <ResolutionRecord resolution={row.resolution} />}</div></details>)}</section>}
        {uncertain ? <section className="rounded-xl border border-warn p-4 space-y-3" aria-label="Unconfirmed identity decision"><h3 className="font-semibold">Check the saved decision before retrying</h3><p className="text-sm text-muted">Pending intent: {uncertain.decision === "LINK_EXISTING" ? "Link source to the same enquiry" : "Create a separate enquiry"}. Closing this dialog does not undo a request already accepted by the server.</p><button type="button" disabled={busy || loading} onClick={async () => { setBusy(true); await checkSaved(uncertain, "No saved decision found. You may explicitly retry the same decision."); setBusy(false); }} className="text-brand text-sm underline">Check saved decision</button>{checkedRecovery && <button type="button" disabled={busy || loading} className="ml-4 rounded-lg bg-brand px-4 py-2 text-white text-sm disabled:opacity-50" onClick={() => void save(uncertain)}>Retry same decision</button>}</section> : <form className="space-y-4 border-t border-line pt-4" onSubmit={event => { event.preventDefault(); if (valid && review.review_token && decision && classification) void save({ review_token: review.review_token, decision, classification, target_lead_id: decision === "LINK_EXISTING" ? target : null, reason: reason.trim() }); }}>
          <fieldset disabled={busy || loading || !review.can_resolve} className="space-y-3"><legend className="font-semibold mb-2">How should this source row be handled?</legend><label className="flex items-start gap-2 text-sm"><input type="radio" name="identity-decision" aria-label="Link to the same enquiry" checked={decision === "LINK_EXISTING"} onChange={() => choose("LINK_EXISTING")} className="mt-1" />Link to the same enquiry - attach this source; keep its current facts, contact and messages.</label><label className="flex items-start gap-2 text-sm"><input type="radio" name="identity-decision" aria-label="Create a separate enquiry" checked={decision === "CREATE_SEPARATE"} onChange={() => choose("CREATE_SEPARATE")} className="mt-1" />Create a separate enquiry - create one new lead with this row's facts and source.</label>
            {decision === "LINK_EXISTING" && <p className="text-sm text-muted">Choose an eligible existing enquiry above. {selected ? "Selected: " + (selected.lead.name || selected.lead.id) + "." : "No target selected."} Linked source facts stay separately visible and do not replace current intelligence.</p>}
            {decision === "CREATE_SEPARATE" && <label className="block text-sm space-y-1">Why is this a separate enquiry?<select aria-label="Separate enquiry classification" required className={contextFieldClass} value={classification} onChange={event => { setClassification(event.target.value as IdentityClassification); setConfirmed(false); }}><option value="">Choose a classification</option><option value="REPEATED_ENQUIRY">Repeated enquiry - a different need from the same contact</option><option value="SHARED_CONTACT">Shared contact - different people use this address or number</option><option value="DISTINCT_ENQUIRY">Distinct enquiry - these records should remain separate</option></select></label>}
            <label className="block text-sm space-y-1">Identity decision reason<textarea aria-label="Identity decision reason" required maxLength={2000} rows={2} className={contextFieldClass} value={reason} onChange={event => { setReason(event.target.value); setConfirmed(false); }} /></label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" aria-label="I reviewed the source, candidates and decision" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />I reviewed the source, candidates and decision. Contact restrictions remain in force.</label>
          </fieldset>
          <div className="flex flex-wrap items-center gap-4"><button type="submit" disabled={busy || loading || !valid} className="rounded-lg bg-brand px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? "Saving decision..." : decision === "CREATE_SEPARATE" ? "Create separate enquiry" : decision === "LINK_EXISTING" ? "Link source to enquiry" : "Save identity decision"}</button><button type="button" disabled={busy || loading} onClick={() => void load()} className="text-sm text-brand underline">Refresh comparison</button></div>{stale && <p className="text-sm text-warn">A fresh comparison and renewed confirmation are required. Your decision and reason remain available for review.</p>}
        </form>}
      </>}
    </div>
  </dialog>;
}
