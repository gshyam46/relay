import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMe } from "@/hooks/use-auth";
import { useWorkspaceStore } from "@/stores/workspace";
import { api, ApiError } from "@/lib/api";
import { connectionErrorCode, connectionIssue, emailConnectionPath, useEmailConnection, useEmailConnectionHistory, useInvalidateEmailConnection } from "@/hooks/use-channel-readiness";
import type { EmailConnectionChange, EmailConnectionCommand, EmailConnectionOperation, EmailConnectionSnapshot, EmailConnectionState, EmailConnectionValues } from "@/types/channel-readiness";

const field = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink disabled:opacity-60";
const button = "rounded-lg border border-line px-3 py-2 text-sm font-medium hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50";
const names: Record<string, string> = { provider: "Provider", from_email: "Sender email", reply_to: "Reply-To email", api_key: "API key", sendgrid_events_public_key: "Event Webhook public key", sendgrid_inbound_public_key: "Inbound Parse public key", webhook_token: "Managed webhook routing", public_app_origin: "Public application origin" };
const operations: Record<EmailConnectionOperation, string> = { SAVE: "Settings saved", PROVISION_ROUTE: "Webhook URLs provisioned", ROTATE_ROUTE: "Webhook URLs rotated" };
type Pending = { operation: EmailConnectionOperation; command: EmailConnectionCommand; rejected: boolean };
const definitive = new Set(["EMAIL_CONNECTION_INVALID_INPUT", "EMAIL_CONNECTION_OWNER_REQUIRED", "EMAIL_CONNECTION_REVISION_STALE", "EMAIL_CONNECTION_REVIEW_STALE", "EMAIL_CONNECTION_REVISION_LIMIT", "EMAIL_CONNECTION_ROUTE_EXISTS", "EMAIL_CONNECTION_ROUTE_REQUIRED", "EMAIL_CONNECTION_ROUTE_LIMIT", "CHANNEL_ROUTE_AMBIGUOUS", "CHANNEL_LIVE_DISABLED"]);
function editable(snapshot: EmailConnectionSnapshot): EmailConnectionValues {
  const s = snapshot.settings;
  return { provider: s.provider, from_email: s.from_email || "", reply_to: s.reply_to || "", api_key: s.api_key || "", sendgrid_events_public_key: s.sendgrid_events_public_key || "", sendgrid_inbound_public_key: s.sendgrid_inbound_public_key || "" };
}
function when(value: string) { return Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Time unavailable"; }

export function ChannelSetup() {
  const org = useWorkspaceStore(s => s.currentOrg), { data: me } = useMe();
  const owner = Boolean(org && me?.user.role === "OWNER" && me.user.organization_id === org.id);
  const query = useEmailConnection(owner);
  if (!owner || !org) return <p className="text-sm text-muted">A current workspace owner can inspect and manage email setup.</p>;
  return <section aria-label="Email connection setup" className="max-w-3xl space-y-5">
    <div><h2 className="text-lg font-semibold">Email setup</h2><p className="mt-1 text-sm text-muted">Configure email for outbound automation. Saving settings records local configuration; it does not verify the provider or enable live sending.</p></div>
    {query.isError && <p role="alert" className="text-sm text-warn">Saved email setup could not be checked. {connectionIssue(connectionErrorCode(query.error))}</p>}
    {query.data ? <ConnectionEditor key={org.id} state={query.data} uncertain={query.isError} refresh={async () => { const result = await query.refetch(); if (result.error || !result.data) throw result.error || new Error("Setup unavailable"); return result.data; }} /> : <p role="status" className="text-sm text-muted">{query.isError ? "Setup is unavailable; changes remain held." : "Loading saved email setup..."}</p>}
    <button type="button" className={button} disabled={query.isFetching} onClick={() => void query.refetch()}>Check saved email setup</button>
  </section>;
}

function ConnectionEditor({ state, uncertain, refresh }: { state: EmailConnectionState; uncertain: boolean; refresh: () => Promise<EmailConnectionState> }) {
  const invalidate = useInvalidateEmailConnection();
  const [draft, setDraft] = useState(() => editable(state)), [base, setBase] = useState(() => ({ revision: state.revision, token: state.review_token }));
  const [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null), [historyOpen, setHistoryOpen] = useState(false);
  const pendingRef = useRef<Pending | null>(null), acceptedRef = useRef<string | null>(null), activeSendRef = useRef<string | null>(null);
  const stale = state.revision !== base.revision || state.review_token !== base.token;
  const dirty = JSON.stringify(draft) !== JSON.stringify(editable(state));
  const blocked = busy || Boolean(pending) || uncertain || stale || !base.token || !reason.trim();
  function update(key: keyof EmailConnectionValues, value: string) { setDraft(current => ({ ...current, [key]: value })); setNotice(null); }
  async function accepted(change: EmailConnectionChange, key: string) {
    if (pendingRef.current?.command.request_key !== key) return;
    acceptedRef.current = key; pendingRef.current = null; setPending(null); setBusy(false); setError(null); setNotice(operations[change.operation] + " at revision " + change.revision + ". Live verification remains unverified.");
    setDraft(editable(change.after)); setBase({ revision: change.revision, token: null }); setReason(""); invalidate();
    try { const latest = await refresh(); if (acceptedRef.current === key && !pendingRef.current && latest.revision === change.revision && latest.management !== "DRIFTED" && JSON.stringify(editable(latest)) === JSON.stringify(editable(change.after))) setBase({ revision: latest.revision, token: latest.review_token }); }
    catch { if (acceptedRef.current === key && !pendingRef.current) setError("The change was recorded, but current setup could not be checked. Refresh saved setup before making another change."); }
  }
  async function send(item: Pending) {
    if (pendingRef.current?.command.request_key !== item.command.request_key) return;
    activeSendRef.current = item.command.request_key; setBusy(true); setError(null); setNotice(null);
    try {
      const suffix = item.operation === "SAVE" ? "" : item.operation === "PROVISION_ROUTE" ? "/provision" : "/rotate";
      const result = item.operation === "SAVE" ? await api.put<{ change: EmailConnectionChange; replayed: boolean }>(emailConnectionPath, item.command) : await api.post<{ change: EmailConnectionChange; replayed: boolean }>(emailConnectionPath + suffix, item.command);
      await accepted(result.change, item.command.request_key);
    } catch (failure) {
      if (pendingRef.current?.command.request_key === item.command.request_key) {
        const code = connectionErrorCode(failure), rejected = definitive.has(code) || failure instanceof ApiError && [400, 403, 413, 422, 429].includes(failure.status);
        const next = { ...item, rejected }; pendingRef.current = next; setPending(next); setError(connectionIssue(code));
        if (/STALE/.test(code)) void refresh().catch(() => {});
      }
    } finally { if (activeSendRef.current === item.command.request_key) { activeSendRef.current = null; setBusy(false); } }
  }
  async function start(operation: EmailConnectionOperation) {
    if (blocked || pendingRef.current || operation === "SAVE" && !state.can_save || operation === "PROVISION_ROUTE" && (!state.can_provision || dirty) || operation === "ROTATE_ROUTE" && (!state.can_rotate || dirty)) return;
    const item: Pending = { operation, rejected: false, command: { expected_revision: base.revision, review_token: base.token!, request_key: "email-setup-" + crypto.randomUUID(), reason, ...(operation === "SAVE" ? { values: { ...draft } } : {}) } };
    pendingRef.current = item; acceptedRef.current = null; setPending(item); await send(item);
  }
  async function lookup() {
    const item = pendingRef.current; if (!item) return;
    try { const result = await api.get<{ change: EmailConnectionChange | null }>(emailConnectionPath + "/requests/" + encodeURIComponent(item.command.request_key));
      if (result.change) await accepted(result.change, item.command.request_key);
      else if (pendingRef.current?.command.request_key === item.command.request_key) setError("No accepted change is visible for this request at this read. Keep the same request for retry; an in-flight response may still arrive.");
    } catch { if (pendingRef.current?.command.request_key === item.command.request_key) setError("The request result could not be checked. Keep this draft and request reference; retry the check when available."); }
  }
  return <>
    <Readiness state={state} />
    <form aria-label="Email setup editor" onSubmit={event => { event.preventDefault(); void start("SAVE"); }} className="space-y-4 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">Owner configuration</h3><span className="text-xs text-muted">Saved revision {state.revision}; editing revision {base.revision}</span></div>
      <fieldset disabled={Boolean(pending) || busy} className="space-y-4">
        <label className="block text-sm font-medium">Email provider<select aria-label="Email provider" className={field} value={draft.provider} onChange={event => update("provider", event.target.value)}><option value="sandbox">Sandbox — simulated email only</option><option value="sendgrid">SendGrid — setup only; live sending held</option><option value="resend" disabled>Resend — live operation unavailable</option>{!["sandbox", "sendgrid", "resend"].includes(draft.provider) && <option value={draft.provider} disabled>{draft.provider} — stored unsupported provider</option>}</select></label>
        <p className="text-sm text-muted">{draft.provider === "sandbox" ? "Sandbox creates simulated results. No real email is delivered." : draft.provider === "sendgrid" ? "Complete supported setup can prepare normal-application SendGrid drafts. Use the separate verification journey below to establish current provider evidence before live sending." : "This stored provider is unsupported. It is retained until you explicitly save another supported mode."}</p>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Sender email<input type="email" autoComplete="off" maxLength={254} className={field} value={draft.from_email} onChange={event => update("from_email", event.target.value)} placeholder="sender@example.com" /></label><label className="text-sm font-medium">Reply-To email<input type="email" autoComplete="off" maxLength={254} className={field} value={draft.reply_to} onChange={event => update("reply_to", event.target.value)} placeholder="replies@example.com" /></label></div>
        <p className="text-xs text-muted">Use individual mailbox addresses. The saved Reply-To is captured in the exact message review. A return mailbox alone does not establish which enquiry an incoming reply belongs to.</p>
        <label className="block text-sm font-medium">SendGrid API key<input type="password" autoComplete="new-password" maxLength={4096} className={field} value={draft.api_key} onChange={event => update("api_key", event.target.value)} /></label>
        <p className="text-xs text-muted">{state.settings.api_key_configured ? "An API key is stored. The mask keeps it unchanged; replace the mask to replace it, or empty this field to clear it explicitly." : "No API key is stored. Leave the field empty to keep it cleared."} The stored secret is never revealed.</p>
        {(["sendgrid_events_public_key", "sendgrid_inbound_public_key"] as const).map(key => <label key={key} className="block text-sm font-medium">{names[key]}<textarea aria-label={names[key]} rows={3} spellCheck={false} autoComplete="off" maxLength={8192} className={field + " font-mono text-xs"} value={draft[key]} onChange={event => update(key, event.target.value)} placeholder="-----BEGIN PUBLIC KEY-----" /></label>)}
        <p className="text-xs text-muted">Use the separate Event Webhook and Inbound Parse EC P-256 public keys (SPKI PEM or base64 DER), never private keys. Empty public-key fields explicitly clear them. Saving keys does not verify signatures or remote security-policy setup. Parsed inbound messages are supported; raw MIME and attachments are not.</p>
        <label className="block text-sm font-medium">Reason for setup change<textarea aria-label="Reason for setup change" required maxLength={2000} className={field} value={reason} onChange={event => setReason(event.target.value)} /></label>
      </fieldset>
      {(error || stale) && <p role="alert" className="text-sm text-warn">{error || "Saved setup changed. Your draft is retained. Review the saved summary before using its latest revision or replacing your draft."}</p>}
      {notice && <p role="status" className="text-sm text-ok">{notice}</p>}
      {!pending && <div className="flex flex-wrap gap-2"><button type="submit" className={button} disabled={blocked || !state.can_save || !["sandbox", "sendgrid"].includes(draft.provider)}>{busy ? "Saving email setup..." : "Save email setup"}</button>
        <button type="button" className={button} disabled={busy || uncertain} onClick={() => { setDraft(editable(state)); setBase({ revision: state.revision, token: state.review_token }); setError(null); setNotice(null); }}>Replace draft with saved setup</button>
        {stale && <button type="button" className={button} disabled={busy || uncertain || !state.review_token} onClick={() => { setBase({ revision: state.revision, token: state.review_token }); setError(null); }}>Use latest revision with this draft</button>}
      </div>}
      {pending && <div role="region" aria-label="Email setup request recovery" className="space-y-2 rounded-lg border border-line bg-soft p-3"><p className="text-sm">{pending.rejected ? "The change was rejected. Review and correct the retained draft." : "Awaiting confirmation of this exact change. Keep this page open until its saved result is checked."}</p><p className="break-all text-xs text-muted">Request: {pending.command.request_key}</p><div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={() => void lookup()}>Check request result</button>{pending.rejected ? <button type="button" className={button} disabled={busy} onClick={() => { pendingRef.current = null; setPending(null); setError(null); }}>Review rejected setup change</button> : <button type="button" className={button} disabled={busy} onClick={() => void send(pending)}>Retry exact setup request</button>}</div><p className="text-xs text-muted">Draft secrets remain only in this page's memory. Reloading closes this draft; saved setup and its history remain available.</p></div>}
      <section aria-label="Webhook routing" className="space-y-3 border-t border-line pt-4"><h3 className="font-semibold">Webhook routing</h3><Routing snapshot={state} />
        <p className="text-xs text-muted">Provisioning and rotation use saved settings and the reason above. Save or replace any edited configuration first. These commands do not contact SendGrid.</p>
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={blocked || dirty || !state.can_provision} onClick={() => void start("PROVISION_ROUTE")}>Provision webhook URLs</button><button type="button" className={button} disabled={blocked || dirty || !state.can_rotate} onClick={() => void start("ROTATE_ROUTE")}>Rotate webhook URLs</button></div>
        <p className="text-xs text-muted">Rotation changes the advertised URLs. Earlier aliases remain valid and require provider signatures; this does not revoke signing keys. {state.routing.generated_alias_count} of 10 routing aliases used.</p>
      </section>
    </form>
    <button type="button" className={button} onClick={() => setHistoryOpen(value => !value)}>{historyOpen ? "Hide email setup history" : "View email setup history"}</button>
    {historyOpen && <ConnectionHistory />}
  </>;
}

function Readiness({ state }: { state: EmailConnectionState }) {
  return <section aria-label="Saved email readiness" className="space-y-3 rounded-xl border border-line bg-soft p-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">Saved setup</h3><span className="text-sm font-medium">{state.settings.provider === "sandbox" ? "Sandbox simulation" : "Live sending held"}</span></div>
    <SavedSummary snapshot={state} />
    {state.management === "LEGACY" && <p className="text-sm text-muted">Existing configuration has no managed setup revision yet. It has not been verified or adopted automatically.</p>}
    {state.management === "DRIFTED" && <p role="alert" className="text-sm text-warn">Configuration changed outside the recorded setup revision. Review it before explicitly saving a new revision.</p>}
    <p className="text-sm">{state.configuration.complete ? "Local configuration complete. Provider operation remains unverified." : "Local configuration incomplete. Review the missing or invalid fields below."}</p>
    {state.configuration.missing_fields.length > 0 && <p className="text-xs text-muted">Missing: {state.configuration.missing_fields.map(value => names[value] || value.replaceAll("_", " ")).join(", ")}.</p>}
    {state.configuration.invalid_fields.length > 0 && <p className="text-xs text-warn">Invalid: {state.configuration.invalid_fields.map(value => names[value] || value.replaceAll("_", " ")).join(", ")}.</p>}
    <div className="space-y-1 border-t border-line pt-3"><p className="text-sm font-medium">Provider verification: {state.verification.status === "VERIFIED" ? "Verified for current setup" : "Unverified"}</p>{state.verification.checks.map(check => <p key={check.id} className="flex flex-wrap justify-between gap-2 text-xs text-muted"><span>{check.label}</span><span>{check.status === "VERIFIED" ? "Verified" : "Unverified"}</span></p>)}</div>
    <p className="text-xs text-muted">No current configuration-bound provider evidence is available. Historical callbacks are not proof that these credentials, sender, routing and public keys work together. Signed transport also does not establish sender identity, contact permission or enquiry correlation.</p>
    {state.hold_reasons.filter(code => code !== "EMAIL_CONNECTION_CONFIG_DRIFT").map(code => <p key={code} className="text-sm text-warn">{connectionIssue(code)}</p>)}
    <Link to="/settings?tab=sending" className="inline-block text-sm font-medium text-brand underline">Review separate workspace sending controls</Link><p className="text-xs text-muted">Channel configuration never overrides sending pauses, contact restrictions or exact-message approval.</p>
  </section>;
}
function SavedSummary({ snapshot }: { snapshot: EmailConnectionSnapshot }) {
  return <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"><dt className="text-muted">Provider</dt><dd className="break-words">{snapshot.settings.provider === "sandbox" ? "Sandbox" : snapshot.settings.provider === "sendgrid" ? "SendGrid" : snapshot.settings.provider + " (unsupported live provider)"}</dd><dt className="text-muted">Sender</dt><dd className="break-all">{snapshot.settings.from_email || "Not configured"}</dd><dt className="text-muted">Reply-To</dt><dd className="break-all">{snapshot.settings.reply_to || "Not configured"}</dd><dt className="text-muted">API key</dt><dd>{snapshot.settings.api_key_configured ? "Stored; hidden" : "Not stored"}</dd><dt className="text-muted">Event public key</dt><dd>{snapshot.settings.sendgrid_events_public_key ? "Stored" : "Not stored"}</dd><dt className="text-muted">Inbound public key</dt><dd>{snapshot.settings.sendgrid_inbound_public_key ? "Stored" : "Not stored"}</dd></dl>;
}
function Routing({ snapshot }: { snapshot: EmailConnectionSnapshot }) {
  const [copied, setCopied] = useState<string | null>(null);
  return <><p className="text-sm text-muted">{snapshot.routing.provisioned ? "Managed routing is provisioned. Use the server-provided public URLs below." : "No managed routing is provisioned. Opening this page does not create a route."}</p>{snapshot.routing.legacy_route_present && <p className="text-xs text-muted">A legacy callback route is retained. It does not certify or automatically become managed setup.</p>}
    {([ ["Event Webhook URL", snapshot.routing.events_url], ["Inbound Parse URL", snapshot.routing.inbound_url] ] as const).map(([label, url]) => <div key={label} className="space-y-1"><p className="text-xs font-medium">{label}</p>{url ? <div className="flex items-start gap-2"><code className="min-w-0 flex-1 break-all rounded border border-line bg-surface p-2 text-xs">{url}</code><button type="button" className={button} onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(label); } catch { setCopied(null); } }}>{copied === label ? "Copied " : "Copy "}{label}</button></div> : <p className="text-xs text-muted">Public URL unavailable until managed routing and the public application origin are configured.</p>}</div>)}
  </>;
}
function ConnectionHistory() {
  const [before, setBefore] = useState<number | null>(null), query = useEmailConnectionHistory(before);
  return <section aria-label="Email setup history" className="space-y-3"><h3 className="font-semibold">Email setup history</h3>{query.isError && <p role="alert" className="text-sm text-warn">Setup history could not be loaded.</p>}{query.isPending && <p className="text-sm text-muted">Loading setup history...</p>}{query.data?.changes.length === 0 && <p className="text-sm text-muted">No managed changes have been recorded.</p>}
    {query.data?.changes.map(change => <article key={change.id} className="space-y-2 rounded-lg border border-line p-4"><p className="text-sm font-semibold">Revision {change.revision} · {operations[change.operation]}</p><p className="text-xs text-muted">{when(change.created_at)} · Owner {change.created_by}</p><p className="whitespace-pre-wrap break-words text-sm">{change.reason}</p><details><summary className="cursor-pointer text-sm text-brand">Recorded before and after setup</summary><div className="mt-3 grid gap-4 sm:grid-cols-2"><div><h4 className="mb-2 text-sm font-medium">Before · revision {change.before.revision}</h4><SavedSummary snapshot={change.before} /></div><div><h4 className="mb-2 text-sm font-medium">After · revision {change.after.revision}</h4><SavedSummary snapshot={change.after} /></div></div><p className="mt-3 text-xs text-muted">Managed routing: {change.before.routing.generated_alias_count} → {change.after.routing.generated_alias_count} aliases. Provider operation remained unverified.</p></details></article>)}
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={before === null || query.isFetching} onClick={() => setBefore(null)}>Latest setup changes</button><button type="button" className={button} disabled={!query.data?.has_more || query.data.next_before_revision === null || query.isFetching} onClick={() => setBefore(query.data!.next_before_revision)}>Older setup changes</button>{query.isError && <button type="button" className={button} onClick={() => void query.refetch()}>Retry setup history</button>}</div>
  </section>;
}
