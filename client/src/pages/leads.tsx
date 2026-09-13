import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import { Upload, Plus, Building2, X, Loader2 } from "lucide-react";
import { LeadDirectory } from "@/components/lead-directory";
import { Header } from "@/components/layout/header";
import { EmptyState } from "@/components/ui/empty-state";
import { useCreateLead } from "@/hooks/use-leads";
import { useWorkspaceStore } from "@/stores/workspace";


export function LeadsPage() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  const [showAddLead, setShowAddLead] = useState(false);
  const navigate = useNavigate();

  if (!org) {
    return (
      <>
        <Header title="Leads" />
        <EmptyState
          icon={Building2}
          title="No workspace selected"
          description="Select or create a workspace to manage leads."
        />
      </>
    );
  }

  return (
    <>
      <Header
        title="Leads"
        description={org.name}
        actions={
          <div className="flex gap-2">
            <button
              onClick={() => navigate("/imports")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-line rounded-lg hover:bg-soft transition-colors cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              Import
            </button>
            <button
              onClick={() => setShowAddLead(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-brand text-white rounded-lg hover:bg-brand-strong transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add lead
            </button>
          </div>
        }
      />
      <LeadDirectory />
      {showAddLead && <AddLeadDialog onClose={() => setShowAddLead(false)} />}
    </>
  );
}

function AddLeadDialog({ onClose }: { onClose: () => void }) {
  const createLead = useCreateLead(), cache = useQueryClient();
  const submission = useRef(false), [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current, prior = document.activeElement as HTMLElement | null; node?.showModal(); node?.querySelector<HTMLInputElement>("input")?.focus(); return () => { node?.close(); if (prior?.isConnected) prior.focus(); }; }, []);
  function keepFocus(event: React.KeyboardEvent<HTMLDialogElement>) { if (event.key !== "Tab") return; const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex='0']")).filter(element => element.getClientRects().length); const first = controls[0], last = controls.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "" });
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submission.current || outcomeUnknown) return;
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    setError(null); submission.current = true;
    try {
      await createLead.mutateAsync({
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        company: form.company.trim() || undefined,
      });
      onClose();
    } catch (err: unknown) {
      const rejected = err instanceof ApiError && [400, 403, 404, 409, 413, 422, 429].includes(err.status);
      setOutcomeUnknown(!rejected);
      const response = err instanceof ApiError ? err.body as { error?: string } : null;
      setError(rejected ? (typeof response?.error === "string" ? response.error.slice(0, 500) : "The lead was rejected. Check the name and supplied contact fields before trying again.") : "The creation result is unknown. This enquiry may already be saved. Creating it again could make a duplicate. Inspect the directory before deciding what to do next.");
    } finally { submission.current = false; }
  };

  return (
    <dialog ref={dialog} aria-labelledby="add-lead-title" aria-describedby="add-lead-help" onKeyDown={keepFocus} onCancel={event => { event.preventDefault(); if (!createLead.isPending) onClose(); }} className="m-auto w-[calc(100%_-_2rem)] max-w-md max-h-[calc(100dvh_-_2rem)] overflow-y-auto rounded-xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40">
        <div className="flex items-center justify-between p-5 border-b border-line">
          <h2 id="add-lead-title" className="text-base font-semibold text-ink">Add Lead</h2>
          <button type="button" aria-label="Close add lead" disabled={createLead.isPending} onClick={onClose} className="p-1 rounded-md hover:bg-soft cursor-pointer disabled:opacity-50">
            <X className="w-4 h-4 text-muted" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <p id="add-lead-help" className="text-sm text-muted">Start with the enquiry you know. Email and phone are optional: you can record context and review intelligence before a contact address is available. Outbound messages require a usable contact and separate review.</p>
          <Field disabled={createLead.isPending || outcomeUnknown} maxLength={200} required autoFocus label="Name *" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="John Doe" />
          <Field disabled={createLead.isPending || outcomeUnknown} maxLength={320} label="Email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} placeholder="john@example.com" type="email" />
          <Field disabled={createLead.isPending || outcomeUnknown} maxLength={80} label="Phone" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} placeholder="+1234567890" />
          <p className="text-xs text-muted">If supplied, use one international phone number beginning with + and its country calling code. Add or correct contact details later through the recorded correction flow.</p>
          <Field disabled={createLead.isPending || outcomeUnknown} maxLength={200} label="Company" value={form.company} onChange={(v) => setForm((f) => ({ ...f, company: v }))} placeholder="Acme Inc" />
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {outcomeUnknown && <section aria-label="Unconfirmed lead creation" className="space-y-2 rounded-lg border border-line bg-soft p-3"><p className="text-xs text-muted">There is no request-reference recovery for manual capture. This draft is held against resubmission. Closing it does not cancel a request already received by the server. Similar records in the directory are not proof of which request created them.</p><button type="button" className="rounded-lg border border-line px-3 py-2 text-sm font-medium" onClick={() => { for (const key of ["leads", "lead-directory", "dashboard", "setup-journey"]) void cache.invalidateQueries({ queryKey: [key] }); onClose(); }}>Inspect lead directory</button></section>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" disabled={createLead.isPending} onClick={onClose} className="px-4 py-2 text-sm font-medium border border-line rounded-lg hover:bg-soft cursor-pointer">
              {outcomeUnknown ? "Close draft" : "Cancel"}
            </button>
            <button
              type="submit"
              disabled={createLead.isPending || outcomeUnknown}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-brand text-white rounded-lg hover:bg-brand-strong transition-colors cursor-pointer disabled:opacity-50"
            >
              {createLead.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Create
            </button>
          </div>
        </form>
    </dialog>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", maxLength, required = false, autoFocus = false, disabled = false }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; maxLength: number; required?: boolean; autoFocus?: boolean; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted">{label}</span>
      <input
        type={type}
        disabled={disabled}
        maxLength={maxLength}
        required={required}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      />
    </label>
  );
}
