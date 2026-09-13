import {LoadingState} from "@/components/loading-screen";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Upload, FileSpreadsheet, Loader2, ArrowLeft } from "lucide-react";
import { Header } from "@/components/layout/header";
import { useMe } from "@/hooks/use-auth";
import { useImports, useImportOperations } from "@/hooks/use-imports";
import { useWorkspaceStore } from "@/stores/workspace";
import { contextFieldClass } from "@/components/context-editor";
import { ImportReview, importError } from "@/components/import-review";
import { currencies } from "@/types/business-context";
import { importLabels, importTargets, type CsvInspection, type ImportMapping, type ImportOptions, type ImportTarget } from "@/types/imports";

export function ImportsPage() {
  const { id } = useParams<{ id: string }>();
  const org = useWorkspaceStore(s => s.currentOrg);
  const { data: me } = useMe();
  const owner = me?.user.role === "OWNER" && me.user.organization_id === org?.id;
  return <><Header title="Imports" description={org?.name} actions={<Link className="inline-flex items-center gap-1 text-sm text-brand" to="/leads"><ArrowLeft className="h-4 w-4" />Leads</Link>} />
    <div className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 space-y-6">
      {id ? <ImportReview key={org?.id + ":" + id} importId={id} owner={owner} /> : <>
        {owner ? <CsvUpload key={org?.id} /> : <p className="text-sm text-muted">A workspace owner can upload and commit an import. Saved imports remain available for inspection.</p>}
        <ImportHistory />
      </>}
    </div></>;
}
function CsvUpload() {
  const operations = useImportOperations();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null), [csv, setCsv] = useState("");
  const [inspection, setInspection] = useState<CsvInspection | null>(null), [mapping, setMapping] = useState<ImportMapping>({});
  const [phoneRegion, setPhoneRegion] = useState(""), [dateFormat, setDateFormat] = useState(""), [currency, setCurrency] = useState("");
  const [assertion, setAssertion] = useState<ImportOptions["assertion"]>("OPERATOR_OBSERVED"), [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  function selectFile(next: File | null) { setFile(next); setInspection(null); setCsv(""); setMapping({}); setPhoneRegion(""); setDateFormat(""); setCurrency(""); setReviewed(false); setError(null); }
  async function inspect(event: React.FormEvent) {
    event.preventDefault(); if (!file || busy) return;
    setBusy(true); setError(null);
    try {
      if (!file.size || file.size > 2 * 1024 * 1024) throw new Error("Choose a non-empty UTF-8 CSV file of at most 2 MiB.");
      if (file.name.length > 200) throw new Error("The filename must contain no more than 200 characters.");
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
      catch { throw new Error("This file is not valid UTF-8. Save it as a UTF-8 CSV and try again."); }
      const result = await operations.inspect({ filename: file.name, csv_text: text });
      setCsv(text); setInspection(result); setMapping(result.suggested_mapping); setReviewed(false);
    } catch (failure) { setError(failure instanceof Error && failure.name !== "ApiError" ? failure.message : importError(failure)); }
    finally { setBusy(false); }
  }
  function mapColumn(index: number, target: string) {
    const next = { ...mapping };
    for (const key of importTargets) if (next[key] === index) delete next[key];
    if (target) next[target as ImportTarget] = index;
    setMapping(next); setReviewed(false);
  }
  async function preview(event: React.FormEvent) {
    event.preventDefault(); if (busy || !inspection || !file || !reviewed || !phoneRegion || !dateFormat || !currency) return;
    setBusy(true); setError(null);
    try {
      const result = await operations.preview({ filename: file.name, csv_text: csv, default_phone_region: phoneRegion, mapping,
        options: { date_format: dateFormat as ImportOptions["date_format"], default_currency: currency === "ROW_ONLY" ? null : currency, assertion } });
      navigate("/imports/" + encodeURIComponent(result.import_id));
    } catch (failure) { setError(importError(failure)); } finally { setBusy(false); }
  }
  return <section className="min-w-0 max-w-6xl space-y-5" aria-label="New CSV import">
    <div><h2 className="text-lg font-semibold flex items-center gap-2"><Upload className="h-5 w-5 text-brand" />Import existing leads and enquiries</h2><p className="text-sm text-muted mt-1">Review the columns and recorded facts, then choose which eligible rows to import. Uploading or previewing creates no leads.</p></div>
    <form onSubmit={inspect} className="rounded-xl border border-line bg-surface p-4 space-y-3">
      <label className="block text-sm space-y-2">CSV file<input aria-label="CSV file" type="file" accept=".csv,text/csv" disabled={busy} onChange={event => selectFile(event.target.files?.[0] || null)} className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-line file:bg-soft file:px-3 file:py-2" /></label>
      <p className="text-xs text-muted">UTF-8, up to 2 MiB, 1000 rows and 64 columns. Maximum 4096 characters per cell. Raw file values remain part of the import record.</p>
      <button type="submit" disabled={!file || busy} className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />}Inspect columns</button>
    </form>
    {error && <p role="alert" className="rounded-lg border border-danger bg-danger-light p-3 text-sm text-danger">{error}</p>}
    {inspection && <form onSubmit={preview} className="space-y-5">
      <div><h3 className="font-semibold">Map {inspection.headers.length} columns from {inspection.row_count} rows</h3><p className="text-sm text-muted mt-1">Suggested mappings need your review. Unmapped values stay in the raw source, but do not become lead or enquiry facts. Each column can map to one field.</p></div>
      <fieldset disabled={busy} className="min-w-0 space-y-5">
        <div className="overflow-x-auto rounded-xl border border-line bg-surface"><table className="w-full text-sm"><thead className="bg-soft"><tr><th className="text-left p-3">Source column</th><th className="text-left p-3">Sample values</th><th className="text-left p-3">Use as</th></tr></thead><tbody>
          {inspection.headers.map(column => <tr key={column.index} className="border-t border-line"><td className="p-3 align-top min-w-32"><p className="font-medium break-words">{column.label || "(blank header)"}</p><p className="text-xs text-muted">Column {column.index + 1}</p></td><td className="p-3 align-top max-w-sm"><div className="space-y-1 text-xs text-muted">{column.samples.map((value, i) => <p key={i} className="break-words whitespace-pre-wrap line-clamp-3">{value || "(empty)"}</p>)}</div></td><td className="p-3 align-top min-w-52"><select aria-label={"Map column " + (column.index + 1) + " " + (column.label || "blank header")} className={contextFieldClass} value={importTargets.find(key => mapping[key] === column.index) || ""} onChange={e => mapColumn(column.index, e.target.value)}><option value="">Keep as raw source only</option>{importTargets.map(target => <option key={target} value={target} disabled={mapping[target] !== undefined && mapping[target] !== column.index}>{importLabels[target]}</option>)}</select></td></tr>)}
        </tbody></table></div>
        <div className="rounded-xl border border-line bg-surface p-4 space-y-4"><h3 className="font-semibold">How should this file be interpreted?</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block text-sm space-y-1">Phone region<select aria-label="Phone region" required className={contextFieldClass} value={phoneRegion} onChange={e => { setPhoneRegion(e.target.value); setReviewed(false); }}><option value="">Choose explicitly</option><option value="INTERNATIONAL_ONLY">International numbers with + country code</option><option value="IN">India local numbers</option><option value="US">US local numbers</option></select></label>
            <label className="block text-sm space-y-1">Date format<select aria-label="Date format" required className={contextFieldClass} value={dateFormat} onChange={e => { setDateFormat(e.target.value); setReviewed(false); }}><option value="">Choose explicitly</option><option value="ISO">Year-month-day (YYYY-MM-DD)</option><option value="DMY">Day/month/year (DD/MM/YYYY)</option><option value="MDY">Month/day/year (MM/DD/YYYY)</option></select></label>
            <label className="block text-sm space-y-1">Budget currency when the row is blank<select aria-label="Budget currency when the row is blank" required className={contextFieldClass} value={currency} onChange={e => { setCurrency(e.target.value); setReviewed(false); }}><option value="">Choose explicitly</option><option value="ROW_ONLY">No default - currency must be in the row</option>{Object.keys(currencies).map(code => <option key={code}>{code}</option>)}</select></label>
            <label className="block text-sm space-y-1">How these enquiry facts were obtained<select aria-label="How these enquiry facts were obtained" className={contextFieldClass} value={assertion} onChange={e => { setAssertion(e.target.value as ImportOptions["assertion"]); setReviewed(false); }}><option value="OPERATOR_OBSERVED">Operator observed - recorded in this file</option><option value="CUSTOMER_STATED">Customer stated - supported by the source</option><option value="INFERRED">Inferred - requires review</option></select></label>
          </div>
          <p className="text-xs text-muted">A row currency overrides the selected default. Enter money without grouping marks or symbols. Exact budget and budget ranges are alternative mappings. Date formats apply to date-only fields; interaction/source times require an explicit ISO timezone offset. Source data is unverified and grants no contact permission.</p>
        </div>
        <label className="flex items-start gap-2 text-sm"><input aria-label="I reviewed the mapping and interpretation" type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} className="mt-1" />I reviewed the mapping and interpretation for this file.</label>
        <button type="submit" disabled={busy || !reviewed || !phoneRegion || !dateFormat || !currency || !Object.keys(mapping).length} className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />}Preview rows</button>
      </fieldset>
    </form>}
  </section>;
}
function ImportHistory() {
  const query = useImports();
  return <section className="min-w-0 max-w-6xl border-t border-line pt-6 space-y-3" aria-label="Import history"><h2 className="text-lg font-semibold flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-brand" />Import history</h2>
    {query.data?.has_more && <p className="text-sm text-muted">Showing the {query.data.limit} most recent imports.</p>}
    {query.isError ? <div role="alert" className="text-sm text-danger">Import history could not load. <button type="button" className="text-brand underline" onClick={() => void query.refetch()}>Try again</button></div> : !query.data ? <LoadingState label="Loading imports" /> : !query.data.imports.length ? <p className="text-sm text-muted">No saved imports yet. A preview will appear here before you choose rows to import.</p> : <div className="overflow-x-auto rounded-xl border border-line bg-surface"><table className="w-full text-sm"><thead className="bg-soft"><tr><th className="p-3 text-left">File</th><th className="p-3 text-left">Saved state</th><th className="p-3 text-left">Imported rows</th><th className="p-3 text-left">Last updated</th></tr></thead><tbody>{query.data.imports.map(batch => <tr key={batch.id} className="border-t border-line"><td className="p-3"><Link className="font-medium text-brand underline break-words" to={"/imports/" + encodeURIComponent(batch.id)}>{batch.filename}</Link></td><td className="p-3">{batch.state === "COMMITTED" ? "Selection processed" : batch.state === "COMMITTING" ? "In progress - can resume" : batch.state === "FAILED" ? "Interrupted - inspect progress" : "Ready for review"}</td><td className="p-3">{batch.progress?.committed_rows ?? batch.summary?.committed_rows ?? 0} of {batch.summary?.total_rows ?? 0}</td><td className="p-3 whitespace-nowrap text-muted">{new Date(batch.updated_at).toLocaleString()}</td></tr>)}</tbody></table></div>}
  </section>;
}
