import { Link } from "react-router-dom";
import { useLeadImportSources } from "@/hooks/use-imports";
import { importLabels, type ImportTarget } from "@/types/imports";
import { ImportSourceValues, ResolutionRecord } from "./identity-resolution";

export function LeadImportSources({ leadId }: { leadId: string }) {
  const query = useLeadImportSources(leadId);
  return <section className="max-w-4xl min-w-0 border-t border-line pt-5 space-y-3" aria-label="Enquiry import sources"><h2 className="text-lg font-semibold">Imported source history</h2><p className="text-sm text-muted">Original and attached CSV sources remain traceable. Linked source facts are shown separately; linking does not replace current enquiry facts or grant contact permission.</p>
    {query.isError ? <p role="alert" className="text-sm text-danger">Source history could not load. <button type="button" onClick={() => void query.refetch()} className="text-brand underline">Try source history again</button></p> : !query.data ? <p role="status" className="text-sm text-muted">Loading source history...</p> : <>
      {query.data.has_more && <p className="text-sm text-muted">Showing the {query.data.sources.length} most recent sources. Older saved import links remain accessible.</p>}
      {!query.data.sources.length && <p className="text-sm text-muted">No imported source is associated with this enquiry.</p>}
      {query.data.sources.map(source => <details key={source.import_row_id} className="rounded-xl border border-line bg-surface p-4"><summary className="cursor-pointer text-sm font-medium break-words">{source.filename} - row {source.row_number} - {source.resolution?.decision === "LINK_EXISTING" ? "Attached source" : source.resolution ? "Created through identity review" : "Original imported source"}</summary><div className="mt-4 space-y-4">
        <Link className="text-sm text-brand underline" to={"/imports/" + encodeURIComponent(source.import_id) + "?row=" + encodeURIComponent(source.import_row_id)}>Open import row and review history</Link>
        {source.resolution ? <ResolutionRecord resolution={source.resolution} /> : <p className="text-xs text-muted">Original import recorded {new Date(source.created_at).toLocaleString()}.</p>}
        {source.resolution?.decision === "LINK_EXISTING" && <p className="rounded-lg bg-soft p-3 text-sm text-muted">Recorded source only. Current enquiry facts were unchanged by this link, even where this source contains a different value.</p>}
        <ImportSourceValues values={source.normalized_values} rawCells={source.raw_cells} rawRow={source.raw_row} />
        <details><summary className="cursor-pointer text-sm text-brand">Reviewed mapped values</summary><dl className="mt-2 space-y-2">{Object.entries(source.mapped_values || {}).map(([field, value]) => <div key={field}><dt className="text-xs font-medium">{importLabels[field as ImportTarget] || field}</dt><dd className="text-xs text-muted whitespace-pre-wrap break-words">{value || "(empty)"}</dd></div>)}</dl></details>
      </div></details>)}
    </>}
  </section>;
}
