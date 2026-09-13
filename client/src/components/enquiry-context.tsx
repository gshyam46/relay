import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useMe } from "@/hooks/use-auth";
import { useEnquiryContext, useSaveContext } from "@/hooks/use-business-context";
import { useWorkspaceStore } from "@/stores/workspace";
import { ContextEditor, ContextLoadState, contextFieldClass } from "./context-editor";
import { budgetInput, currencies, enquiryFields, type Enquiry, type EnquiryRevision, type EnquiryField, type EnquiryFact, type FactValue, type Provenance, type Assertion, type Budget, type BudgetInput, type Location, type Timeline } from "@/types/business-context";

const labels: Record<EnquiryField, string> = { interest: "Product or service interest", location: "Enquiry location", budget: "Stated budget", timeline: "Requested timing", enquiry_date: "Enquiry date", last_interaction: "Last meaningful interaction" };
const assertions = { CUSTOMER_STATED: "Customer stated", OPERATOR_OBSERVED: "Operator observed", INFERRED: "Inferred - unverified" };
function emptyAssertion(field: EnquiryField): Assertion {
  const value = field === "budget" ? { currency: "", minimum: "", maximum: "" } : field === "location" ? { locality: "", country_code: null } : field === "timeline" ? { description: "", target_date: null } : "";
  return { value, provenance: { assertion: "OPERATOR_OBSERVED", source_type: "MANUAL", source_reference: "", observed_at: null } };
}
function changeState(field: EnquiryField, fact: EnquiryFact, state: EnquiryFact["state"]): EnquiryFact {
  if (state === "UNKNOWN") return { state, value: null, provenance: null };
  const first = fact.state === "KNOWN" ? { value: fact.value, provenance: fact.provenance } : emptyAssertion(field);
  if (state === "KNOWN") return { state, ...structuredClone(first) };
  return { state, alternatives: fact.state === "CONFLICTED" ? fact.alternatives : [structuredClone(first), emptyAssertion(field)] };
}
export function EnquiryContext({ leadId, archived = false }: { leadId: string; archived?: boolean }) {
  const org = useWorkspaceStore(s => s.currentOrg);
  const { data: me } = useMe();
  const query = useEnquiryContext(leadId), save = useSaveContext();
  const { hash } = useLocation();
  useEffect(() => { if (!query.data || !/^#enquiry-(interest|location|budget|timeline|enquiry_date|last_interaction)$/.test(hash)) return; const target = document.getElementById(hash.slice(1)); target?.scrollIntoView({ block: "start" }); target?.focus({ preventScroll: true }); }, [hash, query.data, leadId]);
  if (!query.data) return <ContextLoadState error={query.isError ? query.error : undefined} retry={() => void query.refetch()} />;
  return <ContextEditor<Enquiry, EnquiryRevision> key={org?.id + ":" + leadId} title="Enquiry context"
    description="Record this lead's current enquiry with its source. Preserve conflicting accounts and leave missing facts unknown."
    current={query.data} value={row => row.enquiry} readOnlyReason={archived ? "Restore this archived lead before editing enquiry context. Saved facts and history remain readable." : undefined} owner={!archived && me?.user.role === "OWNER" && me.user.organization_id === org?.id} leadId={leadId} refreshError={query.isError}
    refresh={async () => { const result = await query.refetch(); if (result.error || !result.data) throw result.error; return result.data; }}
    save={(draft, revision, reason) => save<EnquiryRevision>({ expected_revision: revision, reason, enquiry: draft }, leadId)}
    fields={(draft, change) => <>
      <p className="text-sm text-muted">One active enquiry per lead is supported. A different enquiry or a shared contact needs review; do not replace another person's need. Choosing Unknown removes the current value from this draft, while saved history remains available.</p>
      {enquiryFields.map(field => <FactEditor key={field} field={field} fact={draft[field]} change={next => change({ ...draft, [field]: next })} />)}
    </>}
    summary={row => <EnquirySummary enquiry={row.enquiry} />} />;
}
function FactEditor({ field, fact, change }: { field: EnquiryField; fact: EnquiryFact; change: (fact: EnquiryFact) => void }) {
  const entries = fact.state === "CONFLICTED" ? fact.alternatives : fact.state === "KNOWN" ? [{ value: fact.value, provenance: fact.provenance }] : [];
  return <fieldset id={"enquiry-" + field} tabIndex={-1} className="scroll-mt-4 min-w-0 rounded-xl border border-line p-4 space-y-3"><legend className="px-1 text-sm font-semibold">{labels[field]}</legend>
    <label className="block text-sm space-y-1">{labels[field]} status<select aria-label={labels[field] + " status"} className={contextFieldClass} value={fact.state} onChange={e => change(changeState(field, fact, e.target.value as EnquiryFact["state"]))}>
      <option value="UNKNOWN">Unknown</option><option value="KNOWN">Recorded value</option><option value="CONFLICTED">Conflicting values - needs review</option>
    </select></label>
    {fact.state === "UNKNOWN" && <p className="text-xs text-muted">No value is asserted. Unknown is different from zero, no interest or no budget.</p>}
    {fact.state === "CONFLICTED" && <p className="text-xs text-warn">Keep 2-5 different accounts until reviewed. No alternative is treated as the established value. To resolve the conflict, choose Recorded value and enter the reviewed value and source.</p>}
    {entries.map((entry, index) => <div key={index} className="min-w-0 space-y-3 border-t border-line pt-3" role="group" aria-label={labels[field] + (fact.state === "CONFLICTED" ? " alternative " + (index + 1) : " recorded fact")}>
      {fact.state === "CONFLICTED" && <p className="text-sm font-medium">Alternative {index + 1}</p>}
      <fieldset disabled={entry.provenance.source_type === "IMPORT_ROW"} className="min-w-0"><ValueEditor field={field} value={entry.value} change={value => { const next = { ...entry, value }; change(fact.state === "CONFLICTED" ? { ...fact, alternatives: fact.alternatives.map((item, i) => i === index ? next : item) } : { state: "KNOWN", ...next }); }} /></fieldset>
      <SourceEditor provenance={entry.provenance} change={provenance => { const next = { ...entry, provenance }; change(fact.state === "CONFLICTED" ? { ...fact, alternatives: fact.alternatives.map((item, i) => i === index ? next : item) } : { state: "KNOWN", ...next }); }} />
      {fact.state === "CONFLICTED" && fact.alternatives.length > 2 && <button type="button" className="text-sm text-danger underline" onClick={() => change({ ...fact, alternatives: fact.alternatives.filter((_, i) => i !== index) })}>Remove alternative {index + 1}</button>}
    </div>)}
    {fact.state === "CONFLICTED" && fact.alternatives.length < 5 && <button type="button" className="text-sm text-brand underline" onClick={() => change({ ...fact, alternatives: [...fact.alternatives, emptyAssertion(field)] })}>Add alternative</button>}
  </fieldset>;
}
function ValueEditor({ field, value, change }: { field: EnquiryField; value: FactValue; change: (value: FactValue) => void }) {
  if (field === "budget") {
    const budget = budgetInput(value as Budget | BudgetInput);
    return <div className="space-y-2"><div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <label className="block text-sm space-y-1">Budget currency<select aria-label="Budget currency" className={contextFieldClass} required value={budget.currency} onChange={e => change({ ...budget, currency: e.target.value })}><option value="">Choose currency</option>{Object.keys(currencies).map(currency => <option key={currency}>{currency}</option>)}</select></label>
      <label className="block text-sm space-y-1">Minimum budget<input className={contextFieldClass} inputMode="decimal" required pattern="[0-9]+([.][0-9]+)?" value={budget.minimum} onChange={e => change({ ...budget, minimum: e.target.value })} /></label>
      <label className="block text-sm space-y-1">Maximum budget<input className={contextFieldClass} inputMode="decimal" required pattern="[0-9]+([.][0-9]+)?" value={budget.maximum} onChange={e => change({ ...budget, maximum: e.target.value })} /></label>
    </div><p className="text-xs text-muted">Use the same amount for an exact budget. Enter plain digits without separators; {budget.currency ? budget.currency + " supports " + currencies[budget.currency] + " decimal places." : "Select the stated currency."} No conversion is performed.</p></div>;
  }
  if (field === "location") { const location = value as Location; return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <label className="block text-sm space-y-1">Locality<input className={contextFieldClass} required maxLength={200} value={location.locality} onChange={e => change({ ...location, locality: e.target.value })} /></label>
    <label className="block text-sm space-y-1">Country code<input className={contextFieldClass} maxLength={2} pattern="[A-Z]{2}" placeholder="Unknown, or two letters such as IN" value={location.country_code || ""} onChange={e => change({ ...location, country_code: e.target.value.toUpperCase() || null })} /></label>
  </div>; }
  if (field === "timeline") { const timing = value as Timeline; return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <label className="block text-sm space-y-1">Timing description<input className={contextFieldClass} required maxLength={500} value={timing.description} onChange={e => change({ ...timing, description: e.target.value })} /></label>
    <label className="block text-sm space-y-1">Target date (optional)<input className={contextFieldClass} type="date" value={timing.target_date || ""} onChange={e => change({ ...timing, target_date: e.target.value || null })} /></label>
  </div>; }
  return <label className="block text-sm space-y-1">{field === "interest" ? "Interest description" : labels[field] + " value"}
    <input aria-label={field === "interest" ? "Interest description" : labels[field] + " value"} className={contextFieldClass} required type={field === "enquiry_date" ? "date" : "text"} maxLength={field === "interest" ? 500 : 40} value={value as string} onChange={e => change(e.target.value)} placeholder={field === "last_interaction" ? "2026-09-12T10:30:00+05:30" : undefined} />
    {field === "last_interaction" && <span className="block text-xs text-muted">Use a full time with UTC Z or an explicit offset. Do not substitute the import time.</span>}
  </label>;
}
function SourceEditor({ provenance, change }: { provenance: Provenance; change: (next: Provenance) => void }) {
  if (provenance.source_type === "IMPORT_ROW") return <div className="space-y-2 rounded-lg bg-soft p-3 text-sm">
    <p className="font-medium">Recorded from an imported CSV row</p><p className="text-xs text-muted">{assertions[provenance.assertion]}. Source remains unverified. Its original linkage is preserved while this fact is unchanged.</p>
    <p className="text-xs text-muted">Source observed: {provenance.observed_at || "Unknown"}</p>
    <Link className="inline-block text-brand underline" to={"/imports/" + encodeURIComponent(provenance.import_id) + "?row=" + encodeURIComponent(provenance.import_row_id)}>Open original import</Link>
    <p className="text-xs text-muted">To correct this fact, record a new manual source. The original imported value and source remain in revision history.</p>
    <button type="button" className="text-brand underline" onClick={() => change({ assertion: provenance.assertion, source_type: "MANUAL", source_reference: "", observed_at: null })}>Correct this imported fact</button>
  </div>;
  return <div className="space-y-3 rounded-lg bg-soft p-3">
    <label className="block text-sm space-y-1">How this was obtained<select aria-label="How this was obtained" className={contextFieldClass} value={provenance.assertion} onChange={e => change({ ...provenance, assertion: e.target.value as Provenance["assertion"] })}>{Object.entries(assertions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label className="block text-sm space-y-1">Source reference<input className={contextFieldClass} required maxLength={500} value={provenance.source_reference} onChange={e => change({ ...provenance, source_reference: e.target.value })} placeholder="For example, customer email received on 12 September" /></label>
    <label className="block text-sm space-y-1">Source observed at (optional)<input className={contextFieldClass} maxLength={40} value={provenance.observed_at || ""} onChange={e => change({ ...provenance, observed_at: e.target.value || null })} placeholder="Unknown, or 2026-09-12T10:30:00+05:30" /></label>
    <p className="text-xs text-muted">Manually recorded, unverified source context. {provenance.assertion === "INFERRED" ? "An inference is not used as an established enquiry fact." : "The source is not independently verified."} Source time can remain unknown.</p>
  </div>;
}
function displayValue(field: EnquiryField, value: FactValue): string {
  if (field === "budget") { const budget = budgetInput(value as Budget | BudgetInput); return budget.currency + " " + budget.minimum + (budget.minimum === budget.maximum ? " (exact)" : " - " + budget.maximum + " (range)"); }
  if (field === "location") { const location = value as Location; return location.locality + (location.country_code ? ", " + location.country_code : " (country unknown)"); }
  if (field === "timeline") { const timeline = value as Timeline; return timeline.description + (timeline.target_date ? "; target " + timeline.target_date : "; target date unknown"); }
  return value as string;
}
export function EnquirySummary({ enquiry }: { enquiry: Enquiry }) {
  return <dl className="space-y-4 text-sm break-words">{enquiryFields.map(field => { const fact = enquiry[field]; const entries = fact.state === "KNOWN" ? [fact] : fact.state === "CONFLICTED" ? fact.alternatives : [];
    return <div key={field}><dt className="font-medium">{labels[field]} - {fact.state === "UNKNOWN" ? "Unknown" : fact.state === "CONFLICTED" ? "Conflicting values" : "Recorded value"}</dt><dd className="space-y-2 text-muted">
      {entries.map((entry, index) => <div key={index} className="border-l-2 border-line pl-3"><p>{displayValue(field, entry.value)}</p><p className="text-xs">{assertions[entry.provenance.assertion]} / {entry.provenance.source_type === "IMPORT_ROW" ? "CSV source" : "manually recorded: " + entry.provenance.source_reference}</p><p className="text-xs">Source observed: {entry.provenance.observed_at || "Unknown"}</p>{entry.provenance.source_type === "IMPORT_ROW" && <Link className="text-xs text-brand underline" to={"/imports/" + encodeURIComponent(entry.provenance.import_id) + "?row=" + encodeURIComponent(entry.provenance.import_row_id)}>Open original import</Link>}</div>)}
      {fact.state === "UNKNOWN" && "No value is asserted."}
    </dd></div>;
  })}</dl>;
}
