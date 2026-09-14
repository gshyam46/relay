import { useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
type Source = "SIGNUP" | "SIGNIN" | "ONBOARDING";
type Contact = { name?: string; email?: string; company?: string };
type Command = { request_key: string; name: string; email: string; company: string; workflow: string; channel: "UNDECIDED"; consent: true; website: string; purpose: string };
export function AvailabilityNotice({ source, contact = {}, comingSoon = false, compact = false, uncertainAccount = false, onRetry }: { source: Source; contact?: Contact; comingSoon?: boolean; compact?: boolean; uncertainAccount?: boolean; onRetry: () => unknown | Promise<unknown> }) {
  const [checking, setChecking] = useState(false);
  return <section aria-label="Service availability" className={compact ? "space-y-4 rounded-xl border border-line bg-surface p-5" : "flex min-h-screen w-full items-center justify-center bg-page p-5"}>
    <div className="mx-auto w-full max-w-lg space-y-5">
      <p className="text-sm font-semibold text-brand">Relay / AI Lead Intelligence &amp; Outbound Automation</p>
      <h1 className="text-3xl font-semibold tracking-tight text-ink">{comingSoon ? "Workspace access is coming soon" : "Currently unavailable"}</h1>
      <p className="text-sm leading-relaxed text-muted">{comingSoon ? "We appreciate your interest. You can explore the product now and leave your email for updates when workspace access is available." : "We appreciate your interest and patience. We cannot reach the workspace service right now. Please try again shortly, or leave your email for availability updates."}</p>
      {uncertainAccount && <p className="rounded-lg bg-soft p-3 text-sm">We could not confirm your account request. It may have completed. Try signing in when the service returns. Your password has been cleared from this form.</p>}
      <div className="flex flex-wrap gap-4"><button type="button" className="rounded-lg border border-line px-4 py-2 text-sm disabled:opacity-50" disabled={checking} onClick={async () => { setChecking(true); try { await onRetry(); } finally { setChecking(false); } }}>{checking ? "Checking availability..." : "Check availability"}</button><a className="self-center text-sm text-brand underline" href="/#example">Try the interactive walkthrough</a></div>
      <InterestUpdates source={source} contact={contact}/>
    </div>
  </section>;
}
function InterestUpdates({ source, contact }: { source: Source; contact: Contact }) {
  const [name, setName] = useState(contact.name || ""), [email, setEmail] = useState(contact.email || ""), [company, setCompany] = useState(contact.company || ""), [consent, setConsent] = useState(false), [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState<string | null>(null), [pending, setPending] = useState<Command | null>(null);
  const pendingRef = useRef<Command | null>(null), sending = useRef(false);
  const field = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink";
  async function send(command: Command) {
    if (sending.current || pendingRef.current !== command) return;
    sending.current = true; setBusy(true); setError(null);
    try {
      const result = await api.post<{ accepted: boolean }>("/public/pilot-requests", command);
      if (result?.accepted !== true) throw new Error("Unconfirmed result");
      setSaved(true); pendingRef.current = null; setPending(null);
    } catch (failure) {
      if (failure instanceof ApiError && [400, 409, 429].includes(failure.status)) {
        pendingRef.current = null; setPending(null);
        setError(failure.status === 429 ? "Too many requests right now. Your details remain on this page; please wait before trying again." : "Your request was not saved. Check your details and consent, then try again.");
      } else setError("We could not confirm that your interest was saved. Please retry the same request. We cannot promise an update until saving is confirmed.");
    } finally { sending.current = false; setBusy(false); }
  }
  if (saved) return <div role="status" className="rounded-xl border border-line bg-surface p-5"><h2 className="font-semibold">Your interest is saved</h2><p className="mt-2 text-sm text-muted">Thank you. We appreciate your interest and will use your email to keep you posted about availability. This has not created an account or confirmed access.</p></div>;
  return <form aria-label="Availability updates" className="space-y-4 rounded-xl border border-line bg-surface p-5" onSubmit={event => { event.preventDefault(); if (!consent || sending.current || pendingRef.current) return; const command: Command = { request_key: "availability-" + crypto.randomUUID(), name: name.trim(), email: email.trim(), company: company.trim() || "Not provided", workflow: "Availability updates", channel: "UNDECIDED", consent: true, website, purpose: "AVAILABILITY_" + source }; pendingRef.current = command; setPending(command); void send(command); }}>
    <h2 className="font-semibold">Keep me posted</h2><p className="text-sm text-muted">Save your contact details for availability updates. Please do not include passwords or customer records.</p>
    <fieldset disabled={busy || Boolean(pending)} className="space-y-3">
      <label className="block text-sm">Your name<input className={field} autoComplete="name" required maxLength={200} value={name} onChange={e => setName(e.target.value)}/></label>
      <label className="block text-sm">Email<input className={field} type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)}/></label>
      <label className="block text-sm">Business name (optional)<input className={field} autoComplete="organization" maxLength={200} value={company} onChange={e => setCompany(e.target.value)}/></label>
      <div hidden aria-hidden="true"><label>Leave empty<input tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)}/></label></div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" required className="mt-1" checked={consent} onChange={e => setConsent(e.target.checked)}/><span>I agree to my contact details being stored and used for product availability updates.</span></label>
    </fieldset>
    {error && <p role="alert" className="text-sm text-warn">{error}</p>}
    {pending ? <button type="button" disabled={busy} onClick={() => void send(pending)} className="rounded-lg bg-brand px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? "Saving interest..." : "Retry the same request"}</button> : <button type="submit" disabled={!consent || busy} className="rounded-lg bg-brand px-4 py-2 text-sm text-white disabled:opacity-50">Notify me</button>}
    <p className="text-xs text-muted">Your details are recorded for availability updates. <a href="/product-information" className="text-brand underline">Privacy and support information</a></p>
  </form>;
}
