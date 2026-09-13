import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useMe } from "@/hooks/use-auth";
import { useWorkspaceStore } from "@/stores/workspace";
import { api, ApiError } from "@/lib/api";

type Inventory = { tables: { table: string; count: number; source_bytes: number; erased: boolean; export_omissions: string[] }[]; total_rows: number; source_bytes: number; within_limits: boolean };
type Inspection = { inventory_version: number; inventory: Inventory; limits: { rows: number; source_bytes: number; history: number }; can_export: boolean; can_erase: boolean; holds: { code: string; count: number }[]; retained: string[]; limitations: string[]; confirmation: string };
type Preview = Pick<Inspection, "inventory_version" | "inventory" | "can_erase" | "holds" | "confirmation" | "retained" | "limitations"> & { plan_token: string; effects: { customer_data_erased: boolean; channel_setup_reset: boolean; dispatch_paused: boolean; account_deleted: boolean } };
type Receipt = { id: string; request_key: string; inventory_version: number; plan_hash: string; erased_counts: Record<string, number>; retained_suppression_count: number; completed_at: string; completed_by: string };
type Command = { request_key: string; plan_token: string; confirmation: string };
type Pending = { command: Command; rejected: boolean; uncertain: boolean };
const path = "/workspace-data", confirmationText = "ERASE WORKSPACE CUSTOMER DATA";
const button = "rounded-lg border border-line px-3 py-2 text-sm font-medium hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50";
const field = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink disabled:opacity-60";
const messages: Record<string, string> = {
  WORKSPACE_DATA_INPUT_INVALID: "Review the supported fields and enter the exact confirmation.",
  WORKSPACE_DATA_OWNER_REQUIRED: "Only the current workspace owner can perform this operation.",
  WORKSPACE_DATA_LIMIT: "This workspace exceeds the supported online operation size. An inspected offline operation is required.",
  WORKSPACE_DATA_EXPORT_LIMIT: "The encoded export exceeds 64 MiB. An inspected offline export is required.",
  WORKSPACE_DATA_HISTORY_LIMIT: "Erasure history reached the supported limit. Operational inspection is required.",
  WORKSPACE_DATA_PLAN_STALE: "Workspace data or account authority changed. This request did not erase data. Review a fresh plan.",
  WORKSPACE_DATA_REQUEST_CONFLICT: "This request reference already belongs to another command. Check its recorded result before proceeding.",
  WORKSPACE_DATA_PROVIDER_ACTIVE: "An active or uncertain provider action must be reconciled before erasure.",
  WORKSPACE_DATA_EVENT_ACTIVE: "An event processing lease must be reconciled before erasure.",
  WORKSPACE_DATA_RECEIPT_ACTIVE: "An inbound receipt processing lease must be reconciled before erasure.",
  WORKSPACE_DATA_POLICY_PENDING: "A mandatory contact-policy receipt is pending. Process or reconcile it before erasure.",
  WORKSPACE_DATA_AI_ACTIVE: "An admitted or unconfirmed AI request must be reconciled before erasure.",
  WORKSPACE_DATA_CHECK_ACTIVE: "A running email verification check must be reconciled before erasure.",
  WORKSPACE_DATA_SCHEDULER_ACTIVE: "A scheduler lease must be reconciled before erasure.",
  WORKSPACE_DATA_INVENTORY_CHANGED: "The stored schema does not match this release's reviewed inventory. Operational inspection is required.",
  WORKSPACE_DATA_STATE_INVALID: "Stored data requires operational inspection before this operation.",
  AUTH_PASSWORD_REJECTED: "The current password could not be verified. Enter it again to retry the same request.",
  AUTH_RATE_LIMITED: "Too many authentication attempts. Wait before retrying the same request.",
};
const noWrite = new Set(Object.keys(messages).filter(code => !["WORKSPACE_DATA_REQUEST_CONFLICT", "WORKSPACE_DATA_INVENTORY_CHANGED", "WORKSPACE_DATA_STATE_INVALID"].includes(code)));
function code(error: unknown) { const body = error instanceof ApiError ? error.body as { code?: string } : null; return body?.code || ""; }
function issue(error: unknown) { return messages[code(error)] || "The result could not be confirmed. Keep this request reference and check its recorded result before taking another action."; }
function size(value: number) { return (value / 1024 / 1024).toFixed(2) + " MiB"; }
function name(value: string) { return value.replaceAll("_", " "); }

export function WorkspaceData() {
  const org = useWorkspaceStore(state => state.currentOrg), { data: me } = useMe();
  if (!org || me?.user.role !== "OWNER" || me.user.organization_id !== org.id) return <p className="text-sm text-muted">A current workspace owner can export or erase workspace customer data.</p>;
  return <DataEditor key={org.id} orgId={org.id} />;
}

function DataEditor({ orgId }: { orgId: string }) {
  const cache = useQueryClient();
  const query = useQuery({ queryKey: ["workspace-data", orgId], queryFn: () => api.get<Inspection>(path), retry: false });
  const [preview, setPreview] = useState<Preview | null>(null), [confirmation, setConfirmation] = useState(""), [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false), [checking, setChecking] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null), [receipt, setReceipt] = useState<Receipt | null>(null), [historyOpen, setHistoryOpen] = useState(false);
  const pendingRef = useRef<Pending | null>(null), lookupRef = useRef(false), sendRef = useRef<string | null>(null);
  function accepted(value: Receipt, key: string) {
    if (pendingRef.current?.command.request_key !== key) return;
    pendingRef.current = null; setPending(null); setPassword(""); setConfirmation(""); setPreview(null); setReceipt(value); setError(null); setNotice("Workspace customer data erasure is recorded. The account and minimum suppression are retained; channel setup is reset and sends are paused.");
    cache.removeQueries({ predicate: item => item.queryKey[0] !== "auth" });
    void query.refetch();
  }
  async function send(item: Pending, currentPassword: string) {
    const key = item.command.request_key;
    if (!currentPassword || sendRef.current || pendingRef.current?.command.request_key !== key) return;
    sendRef.current = key; setBusy(true); setError(null);
    try { const result = await api.post<{ erasure: Receipt }>(path + "/erase", { ...item.command, current_password: currentPassword }); accepted(result.erasure, key); }
    catch (failure) { if (pendingRef.current?.command.request_key === key) { const knownRejection = noWrite.has(code(failure)); const next = { ...item, rejected: knownRejection && !item.uncertain, uncertain: item.uncertain || !knownRejection }; pendingRef.current = next; setPending(next); setError(issue(failure)); } }
    finally { if (sendRef.current === key) { sendRef.current = null; setBusy(false); setPassword(""); } }
  }
  async function lookup() {
    const item = pendingRef.current; if (!item || lookupRef.current) return;
    const key = item.command.request_key; lookupRef.current = true; setChecking(true);
    try { const result = await api.get<{ erasure: Receipt | null }>(path + "/requests/" + encodeURIComponent(key));
      if (result.erasure) accepted(result.erasure, key);
      else if (pendingRef.current?.command.request_key === key) setError("No accepted erasure is visible at this read. Keep the same request; an in-flight result may still arrive. Re-enter your password only to retry this exact request.");
    } catch { if (pendingRef.current?.command.request_key === key) setError("The recorded result is unavailable. Keep this request reference and check again when available."); }
    finally { lookupRef.current = false; setChecking(false); }
  }
  async function reviewPlan() {
    if (busy || pendingRef.current) return; setBusy(true); setError(null); setNotice(null); setPreview(null); setConfirmation(""); setPassword("");
    try { setPreview(await api.post<Preview>(path + "/erasure-preview", {})); } catch (failure) { setError(messages[code(failure)] || "An erasure plan could not be read. No erasure was requested."); }
    finally { setBusy(false); }
  }
  async function exportData() {
    if (busy || pendingRef.current) return; setBusy(true); setError(null); setNotice(null);
    try {
      const result = await api.post<{ manifest: { format: string }; records: Record<string, unknown[]> }>(path + "/export", {});
      if (result.manifest?.format !== "WORKSPACE_CUSTOMER_DATA_JSON" || !result.records) throw new Error("Invalid export");
      const blob = new Blob([JSON.stringify(result)], { type: "application/json" }); if (!blob.size || blob.size > 64 * 1024 * 1024) throw new Error("Invalid export size");
      const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = "workspace-customer-data.json"; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("The workspace customer-data export was prepared for download. Store this file securely; it can contain personal information. Exporting does not erase stored data.");
    } catch (failure) { setError(messages[code(failure)] || "The export could not be downloaded. No erasure was requested; retry the export when available."); }
    finally { setBusy(false); }
  }
  const unavailable = query.isError || !query.data;
  return <section aria-label="Workspace customer data" className="max-w-4xl space-y-5">
    <div><h2 className="text-lg font-semibold">Workspace customer data</h2><p className="mt-1 text-sm text-muted">Export a reviewed inventory or erase customer records from the active application database. These operations apply to the current workspace.</p></div>
    {query.isError && <p role="alert" className="text-sm text-warn">Current data inventory is unavailable. {messages[code(query.error)] || "Refresh the inventory before starting an operation."} {query.data && "The inventory below is the last successful read."}</p>}
    {query.isPending && <p role="status" className="text-sm text-muted">Loading workspace inventory...</p>}
    {query.data && <div className="space-y-3 rounded-xl border border-line bg-surface p-4"><h3 className="font-semibold">Current inventory</h3><InventorySummary value={query.data.inventory} /><p className="text-xs text-muted">Online operation limits: {query.data.limits.rows.toLocaleString()} scoped rows and {size(query.data.limits.source_bytes)} of source data. The encoded download is limited to 64 MiB.</p><Holds values={query.data.holds} /><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || Boolean(pending) || unavailable || !query.data.can_export} onClick={() => void exportData()}>Download customer-data export</button><button type="button" className={button} disabled={busy || Boolean(pending) || query.isFetching} onClick={() => void query.refetch()}>Refresh data inventory</button></div><p className="text-xs text-muted">Protected evaluation datasets and their membership, credentials, sessions and secret fields are omitted. Original customer records are exported independently. This is a customer-data export, not a restorable application backup.</p></div>}
    {error && <p role="alert" className="text-sm text-warn">{error}</p>}{notice && <p role="status" className="text-sm text-ok">{notice}</p>}
    {receipt && <ReceiptCard receipt={receipt} />}
    <section aria-label="Erase workspace customer data" className="space-y-4 rounded-xl border border-warn/40 p-4"><h3 className="font-semibold">Erase workspace customer data</h3><p className="text-sm">This removes customer source records and derived intelligence, message and workflow records. Email channel setup is reset and sends are paused. Your workspace, account, security records, completed erasure receipts and minimum exact-contact suppression remain.</p><p className="text-sm text-warn">This cannot be undone in this application. Backups, logs, downloaded files and provider copies require separate handling. Restoring an older backup requires independent reconciliation of later erasures and suppression before traffic resumes.</p>
      {!pending && <button type="button" className={button} disabled={busy || unavailable || !query.data?.can_erase} onClick={() => void reviewPlan()}>{preview ? "Review a fresh erasure plan" : "Review erasure plan"}</button>}
      {preview && <div aria-label="Reviewed erasure plan" role="region" className="space-y-3 rounded-lg border border-line bg-soft p-3"><h4 className="font-medium">Reviewed plan</h4><InventorySummary value={preview.inventory} /><Holds values={preview.holds} /><p className="text-xs text-muted">The server checks this exact data and account state again at confirmation. A change requires a fresh review.</p><ul className="list-disc space-y-1 pl-5 text-sm">{preview.retained.map(value => <li key={value}>{value}</li>)}</ul></div>}
      {preview && !pending && <form aria-label="Confirm customer-data erasure" onSubmit={event => { event.preventDefault(); if (!preview.can_erase || busy || pendingRef.current || confirmation !== confirmationText || !password) return; const item: Pending = { command: { request_key: "workspace-erasure-" + crypto.randomUUID(), plan_token: preview.plan_token, confirmation }, rejected: false, uncertain: false }; pendingRef.current = item; setPending(item); void send(item, password); }} className="space-y-3">
        <label className="block text-sm font-medium">Type ERASE WORKSPACE CUSTOMER DATA<input autoComplete="off" spellCheck={false} className={field} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} /></label>
        <label className="block text-sm font-medium">Current password<input type="password" autoComplete="current-password" className={field} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>
        <button type="submit" className={button + " text-warn"} disabled={busy || unavailable || !preview.can_erase || confirmation !== confirmationText || !password}>Confirm erasure of workspace customer data</button>
      </form>}
      {pending && <section aria-label="Erasure request recovery" className="space-y-3 rounded-lg border border-line bg-soft p-3"><p className="text-sm">{pending.rejected ? "The server rejected this erasure request. No customer data was erased by this request." : "This exact erasure request is awaiting confirmation. Check the recorded result before starting another operation."}</p><p className="break-all text-xs">Request reference: {pending.command.request_key}</p><p className="text-xs text-muted">Keep this reference if you close the page. Passwords are never retained with a pending request and are cleared when a request settles. Reloading closes this page's draft; completed receipts remain in history.</p><button type="button" className={button} disabled={checking} onClick={() => void lookup()}>Check erasure result</button>
        {!busy && <label className="block text-sm font-medium">Re-enter current password to retry<input type="password" autoComplete="current-password" className={field} value={password} onChange={event => setPassword(event.target.value)} /></label>}
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || checking || !password} onClick={() => void send(pending, password)}>Retry exact erasure request</button>{pending.rejected && <button type="button" className={button} disabled={busy || checking} onClick={() => { pendingRef.current = null; setPending(null); setPassword(""); setConfirmation(""); setPreview(null); setError(null); void query.refetch(); }}>Review a new erasure plan</button>}</div>
      </section>}
      <Link to="/settings?tab=operations" className="inline-block text-sm text-brand underline">Review operational status and recovery</Link>
    </section>
    <button type="button" className={button} onClick={() => setHistoryOpen(value => !value)}>{historyOpen ? "Hide erasure history" : "View erasure history"}</button>{historyOpen && <History orgId={orgId} />}
    <details className="text-sm"><summary className="cursor-pointer font-medium">Data handling limitations</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{(query.data?.limitations || ["Active database deletion does not erase backups, logs, exported files or provider copies.", "Account deletion and automatic retention schedules are not performed by this action."]).map(value => <li key={value}>{value}</li>)}</ul></details>
  </section>;
}

function Holds({ values }: { values: Inspection["holds"] }) { return <>{values.map(value => <p key={value.code} role="alert" className="text-sm text-warn">{messages[value.code] || "An unresolved operation requires operational inspection before erasure."} ({value.count})</p>)}</>; }
function InventorySummary({ value }: { value: Inventory }) {
  return <><p className="text-sm">{value.total_rows.toLocaleString()} scoped records; {size(value.source_bytes)} of source data. {value.within_limits ? "Within supported online size limits." : "Outside supported online size limits."}</p><details><summary className="cursor-pointer text-sm text-brand">Records and export omissions</summary><div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Record group</th><th className="p-2">Count</th><th className="p-2">Erasure handling</th><th className="p-2">Export omissions</th></tr></thead><tbody>{value.tables.filter(row => row.count > 0).map(row => <tr key={row.table} className="border-t border-line"><td className="p-2">{name(row.table)}</td><td className="p-2">{row.count}</td><td className="p-2">{row.erased ? "Erased" : "Retained or minimized"}</td><td className="p-2">{row.export_omissions.map(name).join(", ") || "None listed"}</td></tr>)}</tbody></table></div></details></>;
}
function ReceiptCard({ receipt }: { receipt: Receipt }) {
  return <article aria-label="Recorded erasure receipt" className="space-y-2 rounded-lg border border-line bg-surface p-4"><h3 className="font-semibold">Recorded erasure receipt</h3><p className="text-sm">Completed {new Date(receipt.completed_at).toLocaleString()} by owner {receipt.completed_by}.</p><p className="break-all text-xs text-muted">Receipt {receipt.id}<br />Request {receipt.request_key}</p><p className="text-sm">{Object.values(receipt.erased_counts).reduce((total, value) => total + value, 0)} records erased; {receipt.retained_suppression_count} minimum suppression records retained.</p><details><summary className="cursor-pointer text-sm text-brand">Erased counts by record group</summary><dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-xs">{Object.entries(receipt.erased_counts).map(([key, value]) => <div className="contents" key={key}><dt>{name(key)}</dt><dd>{value}</dd></div>)}</dl></details><p className="text-xs text-muted">This receipt records the accepted operation at that time. It does not certify erasure from independent backups, logs, providers or files, or describe data added later.</p></article>;
}
function History({ orgId }: { orgId: string }) {
  const [cursor, setCursor] = useState<string | null>(null), query = useQuery({ queryKey: ["workspace-data-history", orgId, cursor], queryFn: () => api.get<{ erasures: Receipt[]; next_cursor: string | null }>(path + "/history" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : "")), retry: false });
  const [reference, setReference] = useState(""), [found, setFound] = useState<Receipt | null>(null), [lookupBusy, setLookupBusy] = useState(false), [lookupNote, setLookupNote] = useState<string | null>(null);
  async function lookupReference() { if (!reference.trim() || lookupBusy) return; setLookupBusy(true); setFound(null); setLookupNote(null); try { const result = await api.get<{ erasure: Receipt | null }>(path + "/requests/" + encodeURIComponent(reference.trim())); setFound(result.erasure); if (!result.erasure) setLookupNote("No accepted erasure is visible for this reference at this read. This does not prove that an earlier in-flight command failed."); } catch { setLookupNote("The saved request could not be checked. Keep the reference and retry this read."); } finally { setLookupBusy(false); } }
  return <section aria-label="Customer-data erasure history" className="space-y-3"><h3 className="font-semibold">Completed erasures</h3><form aria-label="Find saved erasure request" className="space-y-2 rounded-lg border border-line p-3" onSubmit={event => { event.preventDefault(); void lookupReference(); }}><label className="block text-sm">Saved request reference<input maxLength={200} className={field} value={reference} disabled={lookupBusy} onChange={event => setReference(event.target.value)} /></label><button type="submit" className={button} disabled={!reference.trim() || lookupBusy}>Find saved erasure result</button>{lookupNote && <p role="status" className="text-sm text-muted">{lookupNote}</p>}{found && <ReceiptCard receipt={found} />}</form>{query.isPending && <p className="text-sm text-muted">Loading receipts...</p>}{query.isError && <p role="alert" className="text-sm text-warn">Erasure history is unavailable. Retry this read when available.</p>}{query.data?.erasures.length === 0 && <p className="text-sm text-muted">No completed erasures are recorded.</p>}{query.data?.erasures.map(value => <ReceiptCard key={value.id} receipt={value} />)}<div className="flex flex-wrap gap-2"><button className={button} disabled={!cursor || query.isFetching} onClick={() => setCursor(null)}>Latest erasures</button><button className={button} disabled={!query.data?.next_cursor || query.isFetching} onClick={() => setCursor(query.data!.next_cursor)}>Older erasures</button><button className={button} disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh erasure history</button></div></section>;
}
