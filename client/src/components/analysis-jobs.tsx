import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMe } from "@/hooks/use-auth";
import { useAnalysisJob, useAnalysisJobCommand, useAnalysisJobs, jobError, type useAnalysisSubmission } from "@/hooks/use-analysis-jobs";
import { jobFinished, jobLabels, type AnalysisJob } from "@/types/analysis-jobs";
import { contextFieldClass } from "./context-editor";

const button = "rounded-lg border border-line px-3 py-2 text-sm text-brand disabled:opacity-50";
const stageLabels: Record<string, string> = { SNAPSHOT: "Recorded evidence", SYNTHESIS: "Source summary", RECOMMENDATION: "Recommendation", PLAN: "Next best action", snapshot: "Recorded evidence", synthesis: "Source summary", recommendation: "Recommendation", plan: "Next best action", next_best_action: "Next best action", action: "Reviewable draft", prepare_drafts: "Reviewable draft", initial_action: "Reviewable draft" };
export function AnalysisSubmissionRecovery({ submission }: { submission: ReturnType<typeof useAnalysisSubmission> }) {
  if (!submission.pending && !submission.error) return null;
  return <section aria-label="Analysis request recovery" className="space-y-3 rounded-xl border border-warn/30 bg-warn-light p-4 text-sm">
    <p role={submission.error ? "alert" : "status"}>{submission.busy ? "Submitting the analysis job..." : submission.error || "An analysis request has an unconfirmed outcome. Check its saved state before submitting different work."}</p>
    {submission.pending && <><p>{submission.pending.lead_ids.length} selected records are bound to this request. Checking saved state never starts work.</p><details><summary className="cursor-pointer text-brand">Request recovery reference</summary><p className="mt-2 break-all text-xs">{submission.pending.request_key}</p></details>
      {submission.lookup.isError && <p role="alert">Saved requests could not be checked. Retain this reference and check again.</p>}
      {!submission.busy && <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={submission.lookup.isFetching} onClick={() => void submission.lookup.refetch()}>Check saved request</button><button type="button" className={button} onClick={() => void submission.retrySubmission()}>Retry same submission</button>{submission.rejected && <button type="button" className={button} onClick={submission.dismissRejected}>Correct rejected selection</button>}</div>}
    </>}
  </section>;
}
export function AnalysisJobPanel({ id, onCompleted }: { id: string; onCompleted?: (job: AnalysisJob) => void }) {
  const query = useAnalysisJob(id), notified = useRef("");
  useEffect(() => { if (!query.data || query.isError || !jobFinished(query.data)) return; const key = query.data.id + ":" + query.data.revision + ":" + query.data.status; if (notified.current !== key) { notified.current = key; onCompleted?.(query.data); } }, [query.data, query.isError, onCompleted]);
  return <section aria-label="Analysis job progress" className="space-y-4 rounded-xl border border-line bg-surface p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Analysis job</h3><button type="button" className={button} disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? "Checking job..." : "Check saved job"}</button></div>
    {query.isError && <p role="alert" className="text-sm text-warn">Job progress could not be checked. The last displayed state may be outdated; commands are unavailable until a successful check.</p>}
    {!query.data ? <p role="status" className="text-sm text-muted">{query.isError ? "Saved job unavailable." : "Loading saved analysis progress..."}</p> : <JobState job={query.data} uncertain={query.isError} refresh={() => query.refetch().then(result => result.error ? undefined : result.data)} />}
  </section>;
}
function JobState({ job, uncertain, refresh }: { job: AnalysisJob; uncertain: boolean; refresh: () => Promise<AnalysisJob | undefined> }) {
  const finished = jobFinished(job), accounted = job.counts.completed + job.counts.failed + job.counts.cancelled;
  return <>
    <div className="flex flex-wrap items-center gap-3"><span className={"rounded px-2 py-1 text-sm font-medium " + (job.status === "COMPLETED" ? "bg-ok-light text-ok" : ["PARTIAL", "FAILED"].includes(job.status) ? "bg-warn-light text-warn" : "bg-soft text-muted")}>{jobLabels[job.status] || "Status unavailable"}</span><span className="text-sm text-muted">{accounted} of {job.counts.total} records finished</span></div>
    <p role="status" className="text-sm">{job.counts.completed} completed; {job.counts.failed} failed; {job.counts.cancelled} cancelled; {job.counts.queued} queued; {job.counts.running} running; {job.counts.retry_pending} waiting to retry.</p>
    <progress className="h-2 w-full accent-brand" aria-label="Finished analysis records" value={accounted} max={Math.max(1, job.counts.total)} />
    <p className="text-sm text-muted">{job.mode === "PREPARE_DRAFTS" ? "This job assesses saved sources through the selected stage and may prepare drafts for separate review. It never approves or sends them." : "This job assesses saved sources without preparing outbound drafts."} {finished ? "Finished processing does not prove that its results are still current; open the lead to check saved inputs." : "Accepted work continues without this page. This view checks saved progress; it does not start another job."}</p>
    <dl className="grid gap-3 text-xs text-muted sm:grid-cols-3"><div><dt className="font-medium">Requested</dt><dd>{when(job.created_at)}</dd></div><div><dt className="font-medium">Target stage</dt><dd>{stageLabels[job.target_stage] || "Recorded stage"}</dd></div><div><dt className="font-medium">Last progress update</dt><dd>{when(job.updated_at)}</dd></div></dl>
    <JobCommands job={job} uncertain={uncertain} refresh={refresh} />
    <div className="space-y-3">{job.items.map(item => <article key={item.id} aria-label={(item.lead_name || "Unnamed lead") + " analysis progress"} className="space-y-2 rounded-lg border border-line p-3"><div className="flex flex-wrap justify-between gap-2"><Link className="text-sm font-medium text-brand underline" to={"/leads/" + item.lead_id + "?tab=intelligence"}>{item.lead_name || "Open lead"}</Link><span className="text-xs">{jobLabels[item.state] || "State unavailable"}</span></div>
      <p className="text-xs text-muted">{item.reused && item.state === "COMPLETED" ? "Saved result reused; matching inputs and versions were unchanged." : item.stage ? "Stage: " + (stageLabels[item.stage] || "Recorded processing stage") : "Waiting for a processing stage."} {item.attempts} of {item.max_attempts} processing attempts used.</p>
      {item.error_code && <p className="text-sm text-warn">{analysisJobIssue(item.error_code)}</p>}{item.next_attempt_at && <p className="text-xs text-muted">Next eligible retry: {when(item.next_attempt_at)}</p>}
      <details><summary className="cursor-pointer text-xs text-brand">Saved stages and result references</summary><div className="mt-2 space-y-2 text-xs text-muted"><p>Original retry deadline: {when(item.retry_deadline_at)}</p>{item.stages.length ? item.stages.map((stage, index) => <p key={index}>{stageLabels[stage.key] || "Recorded stage"}: {stage.status === "DONE" ? "Completed" : stage.status.toLowerCase().replace(/_/g, " ")}{stage.artifact_id && <span className="block break-all">{stage.artifact_id}</span>}</p>) : <p>No completed stage is recorded.</p>}<p className="break-all">Job reference: {job.id}</p></div></details>
    </article>)}</div>
    <Link className="inline-block text-sm text-brand underline" to="/settings?tab=ai">Review AI usage and analysis limits</Link>
  </>;
}
function JobCommands({ job, uncertain, refresh }: { job: AnalysisJob; uncertain: boolean; refresh: () => Promise<AnalysisJob | undefined> }) {
  const { data: me } = useMe(), mutation = useAnalysisJobCommand(job.id);
  const [draft, setDraft] = useState<{ command: "cancel" | "retry"; revision: number; reason: string } | null>(null), [error, setError] = useState<string | null>(null);
  const owner = me?.user.role === "OWNER", stale = draft && draft.revision !== job.revision;
  async function save(event: React.FormEvent) { event.preventDefault(); if (!draft || mutation.isPending || uncertain || stale || !draft.reason.trim()) return; try { await mutation.mutateAsync({ command: draft.command, expected_revision: draft.revision, reason: draft.reason }); setDraft(null); setError(null); } catch (failure) { setError(jobError(failure)); } }
  return <div className="space-y-3">
    {job.command_block_reason && <p className="text-xs text-muted">{analysisJobIssue(job.command_block_reason)}</p>}
    {owner && <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={uncertain || mutation.isPending || !job.can_cancel} onClick={() => { setDraft({ command: "cancel", revision: job.revision, reason: "" }); setError(null); }}>Cancel unfinished analysis</button><button type="button" className={button} disabled={uncertain || mutation.isPending || !job.can_retry} onClick={() => { setDraft({ command: "retry", revision: job.revision, reason: "" }); setError(null); }}>Retry eligible held records</button></div>}
    {draft && <form onSubmit={save} className="space-y-3 rounded-lg border border-line p-3"><p className="text-sm">{draft.command === "cancel" ? "Cancel unfinished records in this job. Already completed results and usage remain. An admitted provider request may still finish and incur usage, but cancelled work cannot publish another result or draft." : "Retry only records the server permits within their original attempt and time limits. Existing provider usage is retained, and current source/version checks still apply."}</p><label className="block text-sm">Reason for this job decision<textarea required maxLength={2000} className={contextFieldClass} value={draft.reason} onChange={event => setDraft({ ...draft, reason: event.target.value })} /></label>{(error || stale) && <p role="alert" className="text-sm text-warn">{error || "This job changed. Your reason remains; check its saved state before deciding again."}</p>}<div className="flex flex-wrap gap-2"><button type="submit" className={button} disabled={uncertain || mutation.isPending || Boolean(stale) || !draft.reason.trim() || !(draft.command === "cancel" ? job.can_cancel : job.can_retry)}>{mutation.isPending ? "Saving decision..." : draft.command === "cancel" ? "Confirm cancellation" : "Confirm retry"}</button><button type="button" className={button} disabled={mutation.isPending} onClick={() => setDraft(null)}>Keep current job</button>{(error || stale) && <button type="button" className={button} disabled={mutation.isPending} onClick={async () => { const latest = await refresh(); if (latest) { setDraft({ ...draft, revision: latest.revision }); setError(null); } }}>Review latest job revision</button>}</div></form>}
  </div>;
}
export function AnalysisJobsList({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  const [offset, setOffset] = useState(0), query = useAnalysisJobs({ offset });
  return <section aria-label="Analysis job history" className="space-y-4"><div className="flex flex-wrap justify-between gap-3"><h2 className="font-semibold">Analysis job history</h2><button type="button" className={button} disabled={query.isFetching} onClick={() => void query.refetch()}>Check recent jobs</button></div>{query.isError && <p role="alert" className="text-sm text-warn">Analysis history could not be checked. Existing work may still be running.</p>}{!query.data ? <p role="status">Loading analysis history...</p> : <><p className="text-sm text-muted">{query.data.total} jobs; {query.data.jobs.length} shown on this page.</p><div className="space-y-2">{query.data.jobs.map(job => <button type="button" key={job.id} aria-pressed={selectedId === job.id} onClick={() => onSelect(job.id)} className="w-full rounded-lg border border-line bg-surface p-3 text-left"><span className="block text-sm font-medium">{jobLabels[job.status]} · {job.counts.total} records</span><span className="text-xs text-muted">{when(job.created_at)} · {job.counts.completed} completed, {job.counts.failed} failed</span></button>)}</div><div className="flex flex-wrap items-center gap-3"><button type="button" className={button} disabled={!offset || query.isFetching} onClick={() => setOffset(Math.max(0, offset - 10))}>Previous job page</button><span className="text-sm">Page {Math.floor(offset / 10) + 1}</span><button type="button" className={button} disabled={!query.data.has_more || query.isFetching} onClick={() => setOffset(offset + 10)}>Next job page</button></div></>}{selectedId && <AnalysisJobPanel key={selectedId} id={selectedId} />}</section>;
}
export function LatestLeadAnalysisJob({ leadId, submittedId }: { leadId: string; submittedId?: string | null }) {
  const query = useAnalysisJobs({ leadId }), job = query.data?.jobs.find(job => !jobFinished(job)) || query.data?.jobs[0], id = submittedId || job?.id;
  return <div className="space-y-3">{query.isError && <p role="alert" className="text-sm text-warn">Recent analysis jobs could not be checked. Check saved jobs before submitting duplicate work.</p>}{id && <><Link className="text-xs text-brand underline" to={"/intelligence?view=jobs&job=" + id}>Open saved analysis job</Link><AnalysisJobPanel key={id} id={id} /></>}</div>;
}
export function analysisJobIssue(code: string) {
  if (code.includes("VERSION")) return "The configured generation version changed. Review current settings and submit a new explicit job; this historical job cannot silently switch engines.";
  if (code.includes("PAUSED")) return "Model invocations are paused by the workspace owner. Review AI limits before retrying held work.";
  if (code.includes("DAILY")) return "The current UTC day's model invocation limit is exhausted. Existing usage is retained; review the reset time in AI limits.";
  if (code.includes("IN_FLIGHT")) return "The logical in-flight model limit was reached. Check current usage before retrying; an expired local slot does not prove that remote work stopped.";
  if (code.includes("ARCHIVED")) return "The lead is archived. Its saved history remains; restore it before requesting new analysis.";
  if (code.includes("INPUT") || code.includes("CONTEXT") || code.includes("STALE")) return "Saved inputs changed or could not be verified. Review the lead's current source state before retrying.";
  if (code.includes("CANCEL")) return "This job is cancelled and cannot reopen. Its results and usage remain recorded.";
  if (code.includes("BUDGET") || code.includes("DEADLINE") || code.includes("EXHAUST")) return "The original processing attempt or time limit was reached. Review the job history; retry cannot reset that limit.";
  if (code.includes("TERMINAL") || code.includes("NOT_RETRYABLE") || code.includes("NO_RETRY")) return "No records in this job currently permit retry. Review their saved outcomes.";
  return "This work needs review. Check the saved stages, current source state and AI limits before making another request.";
}
function when(value: string | null | undefined) { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Not recorded"; }
