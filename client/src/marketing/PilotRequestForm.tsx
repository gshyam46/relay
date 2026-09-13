import { useRef, useState } from "react";
import { ArrowUpRight, Check, Loader2 } from "lucide-react";

type PilotCommand = { request_key: string; name: string; email: string; company: string; workflow: string; channel: "EMAIL" | "WHATSAPP" | "UNDECIDED"; consent: true; website: string };
export function PilotRequestForm() {
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [company, setCompany] = useState(""), [workflow, setWorkflow] = useState(""), [channel, setChannel] = useState<PilotCommand["channel"]>("UNDECIDED"), [consent, setConsent] = useState(false), [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false), [pending, setPending] = useState<PilotCommand | null>(null), [error, setError] = useState<string | null>(null), [accepted, setAccepted] = useState(false);
  const pendingRef = useRef<PilotCommand | null>(null), sending = useRef(false);
  async function send(command: PilotCommand) {
    if (sending.current || pendingRef.current?.request_key !== command.request_key) return;
    sending.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch("/api/public/pilot-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
      if (pendingRef.current?.request_key !== command.request_key) return;
      if (response.status === 202) { const body = await response.json(); if (body?.accepted !== true) throw new Error("Unconfirmed result"); setAccepted(true); pendingRef.current = null; setPending(null); return; }
      if ([400, 409, 429].includes(response.status)) {
        pendingRef.current = null; setPending(null);
        setError(response.status === 400 ? "The request was not saved. Check the required fields, email address and consent, then try again." : response.status === 429 ? "Too many requests right now. Your entries are retained; wait before trying again." : "This request reference already belongs to different information. Your entries remain; review them before creating another request."); return;
      }
      throw new Error("Unconfirmed result");
    } catch { if (pendingRef.current?.request_key === command.request_key) setError("We could not confirm whether your request was saved. Retry the same request below; your entries are retained on this page."); }
    finally { sending.current = false; setBusy(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!consent || busy || pendingRef.current || accepted) return;
    const command: PilotCommand = { request_key: "pilot-" + crypto.randomUUID(), name: name.trim(), email: email.trim(), company: company.trim(), workflow: workflow.trim(), channel, consent: true, website };
    pendingRef.current = command; setPending(command); await send(command);
  }
  return <div className="landing-pilot-form-wrap">{accepted ? <section role="status" className="landing-request-saved"><span><Check size={26} /></span><h3>Your request is saved for review.</h3><p>This records your interest. It does not confirm a pilot place, booking or live-channel access.</p><a href="#example" className="landing-text-link">Try it out<ArrowUpRight size={16} /></a></section> : <form aria-label="Pilot interest request" onSubmit={submit} className="landing-pilot-form">
    <h3>Book a demo or reach out.</h3><p className="landing-form-intro">Request a walkthrough or ask about your workflow. A demo time is confirmed separately. Share only business contact details and a short description. Please leave customer records and sensitive information out of this form.</p>
    <fieldset disabled={busy || Boolean(pending)}><div className="landing-form-row"><label htmlFor="pilot-name">Your name<input id="pilot-name" autoComplete="name" required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label><label htmlFor="pilot-company">Business name<input id="pilot-company" autoComplete="organization" required maxLength={200} value={company} onChange={event => setCompany(event.target.value)} /></label></div>
      <label htmlFor="pilot-email">Work email<input id="pilot-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label htmlFor="pilot-workflow">What would you like to improve?<textarea id="pilot-workflow" rows={3} required maxLength={2000} value={workflow} onChange={event => setWorkflow(event.target.value)} placeholder="For example: understand which existing enquiries need a follow-up, and why." /></label>
      <label htmlFor="pilot-channel">Channel important to your workflow<select aria-label="Channel important to your workflow" id="pilot-channel" value={channel} onChange={event => setChannel(event.target.value as PilotCommand["channel"])}><option value="UNDECIDED">To be discussed</option><option value="EMAIL">Email</option><option value="WHATSAPP">WhatsApp</option></select></label><p className="landing-field-note">This records your needs; it does not indicate that a live channel is available.</p>
      <div className="landing-honeypot" aria-hidden="true"><label htmlFor="pilot-website">Leave this field empty<input id="pilot-website" tabIndex={-1} autoComplete="off" value={website} onChange={event => setWebsite(event.target.value)} /></label></div>
      <label className="landing-consent"><input type="checkbox" required checked={consent} onChange={event => setConsent(event.target.checked)} /><span>I agree to these details being stored to review my pilot interest.</span></label>
    </fieldset>
    {error && <p role="alert" className="landing-form-error">{error}</p>}
    {pending ? <button type="button" className="landing-button landing-button-dark" disabled={busy} onClick={() => void send(pending)}>{busy ? <><Loader2 size={17} className="landing-spinner" />Saving request…</> : <>Retry the same request<ArrowUpRight size={17} /></>}</button> : <button type="submit" className="landing-button landing-button-dark" disabled={busy || !consent}>Send request<ArrowUpRight size={17} /></button>}
    <p className="landing-field-note"><a href="/product-information" className="landing-text-link">Read privacy and support information</a></p><p className="landing-field-note">A saved request is not an accepted pilot. No message is sent from the interactive example.</p>
  </form>}</div>;
}
