import { Link } from "react-router-dom";
import { CriteriaSummary } from "./fit-criteria";
import { useMe } from "@/hooks/use-auth";
import { useBusinessProfile, useSaveContext } from "@/hooks/use-business-context";
import { useWorkspaceStore } from "@/stores/workspace";
import { ContextEditor, ContextLoadState, contextFieldClass } from "./context-editor";
import type { BusinessProfile as Profile, ProfileRevision } from "@/types/business-context";

const lists = [
  ["offerings", "Products or services offered", "Describe what you can actually provide. At least one offering is required."],
  ["service_areas", "Service areas", "Where can you serve customers? Leave blank if unknown."],
  ["target_customers", "Target customers", "Who is your offering relevant to?"],
  ["exclusions", "Exclusions", "Describe needs or customers you cannot serve."],
  ["required_criteria", "Required fit criteria", "Facts that must be known to judge a fit. These descriptions are saved for review."],
  ["preferred_criteria", "Preferred fit criteria", "Useful additional information; not a promise of buying intent."],
] as const;
function normalized(profile: Profile): Profile {
  const next = { ...profile };
  for (const [key] of lists) next[key] = next[key].map(v => v.trim()).filter(Boolean);
  return next;
}
export function BusinessProfile() {
  const org = useWorkspaceStore(s => s.currentOrg);
  const { data: me } = useMe();
  const query = useBusinessProfile();
  const save = useSaveContext();
  if (!query.data) return <ContextLoadState error={query.isError ? query.error : undefined} retry={() => void query.refetch()} />;
  return <ContextEditor<Profile, ProfileRevision> key={org?.id} title="Business profile"
    description="Describe your actual business, offerings and qualification criteria. Unknown details can remain blank."
    current={query.data} value={row => row.profile} owner={me?.user.role === "OWNER" && me.user.organization_id === org?.id}
    refresh={async () => { const result = await query.refetch(); if (result.error || !result.data) throw result.error; return result.data; }}
    refreshError={query.isError}
    save={(draft, revision, reason) => save<ProfileRevision>({ expected_revision: revision, reason, profile: normalized(draft) })}
    fields={(draft, change) => <>
      <Link className="inline-block text-sm text-brand underline" to="/settings?tab=fit">Review configured fit criteria</Link>
      <label className="block text-sm space-y-1">Business name<input className={contextFieldClass} required maxLength={200} value={draft.business_name || ""} onChange={e => change({ ...draft, business_name: e.target.value })} /></label>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{lists.map(([key, label, hint]) => <label key={key} className="block text-sm space-y-1">{label}
        <textarea aria-label={label} className={contextFieldClass} rows={3} required={key === "offerings"} maxLength={10019} value={draft[key].join("\n")} onChange={e => change({ ...draft, [key]: e.target.value.split("\n") })} aria-describedby={"profile-" + key + "-help"} />
        <span id={"profile-" + key + "-help"} className="block text-xs text-muted">{hint} One item per line, up to 20 items of 500 characters.</span>
      </label>)}</div>
      <label className="block text-sm space-y-1">Preferred next step<input className={contextFieldClass} maxLength={500} value={draft.preferred_next_step || ""} onChange={e => change({ ...draft, preferred_next_step: e.target.value || null })} placeholder="For example, confirm the required service before preparing a quote" /></label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block text-sm space-y-1">Business timezone<input aria-label="Business timezone" className={contextFieldClass} maxLength={100} value={draft.timezone || ""} onChange={e => change({ ...draft, timezone: e.target.value || null })} placeholder="For example, Asia/Kolkata" aria-describedby="context-timezone-help" /><span id="context-timezone-help" className="block text-xs text-muted">Optional IANA timezone. This profile does not configure sending hours.</span></label>
        <label className="block text-sm space-y-1">Preferred language<input className={contextFieldClass} maxLength={80} value={draft.language || ""} onChange={e => change({ ...draft, language: e.target.value || null })} placeholder="Unknown" /></label>
      </div>
      <p className="text-xs text-muted">These are descriptive notes, not executable criteria. Required/exclusion notes still need manual review; preferred notes remain unassessed. Configure explicit rules under Fit criteria.</p>
    </>}
    summary={row => <><ProfileSummary profile={row.profile} /><div className="mt-4 border-t border-line pt-3"><p className="font-medium text-sm mb-2">Configured fit criteria in this revision</p><CriteriaSummary criteria={row.fit_criteria || null} /></div></>} />;
}
function ProfileSummary({ profile }: { profile: Profile }) {
  return <dl className="space-y-3 text-sm break-words">
    <div><dt className="font-medium">Business name</dt><dd className="text-muted">{profile.business_name || "Unknown"}</dd></div>
    {lists.map(([key, label]) => <div key={key}><dt className="font-medium">{label}</dt><dd className="text-muted">{profile[key].length ? <ul className="list-disc pl-5">{profile[key].map((value, i) => <li key={i}>{value}</li>)}</ul> : "Unknown / not specified"}</dd></div>)}
    {([["preferred_next_step", "Preferred next step"], ["timezone", "Business timezone"], ["language", "Preferred language"]] as const).map(([key, label]) => <div key={key}><dt className="font-medium">{label}</dt><dd className="text-muted">{profile[key] || "Unknown"}</dd></div>)}
  </dl>;
}
