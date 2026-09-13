import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import { useMe } from "@/hooks/use-auth";
import { useWorkspaceStore } from "@/stores/workspace";
import { api, ApiError } from "@/lib/api";

interface Controls { revision: number | null; paused: boolean | null; daily_attempt_limit: number | null; unresolved_limit: number | null; reason: string | null; updated_at: string | null }
interface State { controls: Controls; global_enabled: boolean; policy_valid: boolean; can_dispatch: boolean; hold_reason: string | null;
 usage: { utc_day: string; resets_at: string; attempts_used: number; unresolved_used: number; legacy_unresolved: number; attempts_remaining: number; unresolved_remaining: number } }
const REASONS: Record<string, string> = {
 GLOBAL_DISPATCH_PAUSED: "The application operator has paused sending. A workspace owner cannot override this setting.",
 WORKSPACE_DISPATCH_PAUSED: "Sending is paused for this workspace.",
 DISPATCH_CONTROLS_INVALID: "Saved sending controls are invalid. Review and save valid values before sending.",
 DAILY_DISPATCH_LIMIT: "The UTC-day send attempt limit has been reached.",
 UNRESOLVED_DISPATCH_LIMIT: "Outstanding provider outcomes must be resolved before more sends can be authorized."
};
const fieldClass = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink";
function errorText(error: unknown) {
 if (error instanceof ApiError && error.status === 409) return "These controls changed in another session. Load the latest values before saving again.";
 if (error instanceof ApiError && error.status === 403) return "Only a current workspace owner may change these controls.";
 return "The controls could not be loaded or saved. Refresh and try again.";
}
export function DispatchControls() {
 const org = useWorkspaceStore(s => s.currentOrg);
 const { data: me } = useMe();
 const owner = me?.user.role === "OWNER" && me.user.organization_id === org?.id;
 const query = useQuery({ queryKey: ["dispatch-controls", org?.id], queryFn: () => api.get<State>("/dispatch-controls"),
  enabled: !!org && owner, refetchInterval: 15000, retry: false });
 if (!owner || !org) return <p className="text-sm text-muted">A workspace owner can inspect and change sending controls.</p>;
 if (!query.data) return <div role="status" className="text-sm text-muted">{query.isError ? errorText(query.error) : "Loading sending controls..."}
  {query.isError && <button onClick={() => void query.refetch()} className="ml-3 text-brand">Try again</button>}</div>;
 return <DispatchControlsForm key={org.id} organizationId={org.id} state={query.data} refresh={() => query.refetch().then(result => {
  if (!result.data || result.error) throw result.error || new Error("Controls unavailable"); return result.data;
 })} refreshError={query.isError} />;
}
function DispatchControlsForm({ organizationId, state, refresh, refreshError }: { organizationId: string; state: State; refresh: () => Promise<State>; refreshError: boolean }) {
 const qc = useQueryClient();
 const [draft, setDraft] = useState({ revision: state.controls.revision, paused: state.controls.paused ?? true,
  daily: String(state.controls.daily_attempt_limit ?? 100), unresolved: String(state.controls.unresolved_limit ?? 2), reason: "" });
 const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [saved, setSaved] = useState(false);
 const changed = draft.revision !== state.controls.revision;
 const limitsValid = /^\d+$/.test(draft.daily) && Number(draft.daily) >= 1 && Number(draft.daily) <= 1000
  && /^\d+$/.test(draft.unresolved) && Number(draft.unresolved) >= 1 && Number(draft.unresolved) <= 10;
 function load(next: State) { setDraft({ revision: next.controls.revision, paused: next.controls.paused ?? true,
  daily: String(next.controls.daily_attempt_limit ?? 100), unresolved: String(next.controls.unresolved_limit ?? 2), reason: "" }); }
 async function reload() { setBusy(true); setError(null); setSaved(false); try { load(await refresh()); } catch(e) { setError(errorText(e)); } finally { setBusy(false); } }
 async function save(event: React.FormEvent) {
  event.preventDefault(); if (busy || changed || !limitsValid || draft.revision === null || !draft.reason.trim()) return;
  setBusy(true); setError(null); setSaved(false);
  try {
   const next = await api.put<State>("/dispatch-controls", { expected_revision: draft.revision, paused: draft.paused,
    daily_attempt_limit: Number(draft.daily), unresolved_limit: Number(draft.unresolved), reason: draft.reason.trim() });
   qc.setQueryData(["dispatch-controls", organizationId], next); load(next); setSaved(true);
  } catch(e) { setError(errorText(e)); } finally { setBusy(false); }
 }
 return <div className="max-w-2xl space-y-5">
  <div><h2 className="text-lg font-semibold text-ink">Sending controls</h2><p className="mt-1 text-sm text-muted">Pause new outbound sends and bound the number of attempts your workspace authorizes.</p></div>
  <div className="rounded-xl border border-line bg-surface p-4 space-y-2" role="status">
   <p className="text-sm font-medium text-ink">{state.can_dispatch ? "Operational sending capacity is available" : REASONS[state.hold_reason || ""] || "Sending is held for operational review."}</p>
   <p className="text-xs text-muted">Every send still requires current approval, a due schedule and contact-policy clearance. Already authorized requests may finish after a pause.</p>
   {!state.global_enabled && <p className="text-xs text-muted">Resuming this workspace will not change the application-wide pause.</p>}
   {state.controls.reason && <p className="text-sm text-muted">Last owner reason: {state.controls.reason}</p>}
  </div>
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
   <div className="rounded-xl border border-line p-4"><p className="text-sm font-medium">{state.usage.attempts_used} send attempts today</p>
    <p className="text-xs text-muted mt-1">{state.usage.attempts_remaining} remaining. Includes retries and sandbox sends.</p>
    <p className="text-xs text-muted mt-1">Resets {state.usage.resets_at.replace("T", " ").replace(".000Z", " UTC")}</p></div>
   <div className="rounded-xl border border-line p-4"><p className="text-sm font-medium">{state.usage.unresolved_used} unresolved dispatches</p>
    <p className="text-xs text-muted mt-1">{state.usage.unresolved_remaining} slots remaining. Expired or uncertain requests retain their slot until reconciled.</p>
    {state.usage.legacy_unresolved > 0 && <p className="text-xs text-muted mt-1">Includes {state.usage.legacy_unresolved} historical actions without reliable outcome evidence.</p>}
    <Link className="text-xs text-brand inline-block mt-2" to="/outbound">Review outbound outcomes</Link></div>
  </div>
  {(changed || refreshError) && <p role="alert" className="text-sm text-amber-700">{changed ? "The saved revision changed. Load the latest values to replace this draft." : "Usage could not refresh. The displayed numbers may be outdated."}</p>}
  <form onSubmit={save} className="space-y-4 rounded-xl border border-line p-5">
   <fieldset disabled={busy} className="space-y-4">
    <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={draft.paused} onChange={e => { setDraft({ ...draft, paused: e.target.checked }); setSaved(false); }} />Pause sending for this workspace</label>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
     <label className="text-sm space-y-1 block">Send attempts per UTC day (1-1000)<input className={fieldClass} type="number" min={1} max={1000} step={1} required value={draft.daily} onChange={e => { setDraft({ ...draft, daily: e.target.value }); setSaved(false); }} /></label>
     <label className="text-sm space-y-1 block">Unresolved dispatch slots (1-10)<input className={fieldClass} type="number" min={1} max={10} step={1} required value={draft.unresolved} onChange={e => { setDraft({ ...draft, unresolved: e.target.value }); setSaved(false); }} /></label>
    </div>
    <label className="text-sm space-y-1 block">Reason for this change<textarea className={fieldClass} rows={3} maxLength={2000} required value={draft.reason} onChange={e => { setDraft({ ...draft, reason: e.target.value }); setSaved(false); }} /></label>
   </fieldset>
   <p className="text-xs text-muted">Pausing, raising a limit or starting a new day does not reset an action's retry budget or deadline. Accepted requests release their slot; acceptance does not confirm delivery. These controls do not impose a monetary spending cap.</p>
   {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
   {saved && <p role="status" className="text-sm text-green-700">Sending controls saved.</p>}
   {draft.revision === null && <p role="alert" className="text-sm text-red-600">The stored revision requires operator repair before it can be updated.</p>}
   <div className="flex flex-wrap gap-3 items-center">
    <button type="submit" disabled={busy || changed || draft.revision === null || !limitsValid || !draft.reason.trim()} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50 flex items-center gap-2">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save sending controls</button>
    <button type="button" disabled={busy} onClick={() => void reload()} className="text-sm text-brand flex items-center gap-2 disabled:opacity-50"><RefreshCw className="h-4 w-4" />Load latest values</button>
    <span className="text-xs text-muted">Reviewing revision {draft.revision ?? "unavailable"}</span>
   </div>
  </form>
 </div>;
}
