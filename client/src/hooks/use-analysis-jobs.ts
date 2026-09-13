import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";
import { jobFinished, type AnalysisJob, type AnalysisJobList, type AnalysisRequest } from "@/types/analysis-jobs";

const resultKeys = ["intelligence-summary", "lead-intelligence", "lead-intelligence-history", "lead", "leads", "lead-directory", "lead-outbound", "outbound-summary", "lead-timeline", "activity-feed", "dashboard", "dashboard-attention", "ai-usage", "ai-controls"];
function invalidateResults(client: QueryClient) { for (const key of resultKeys) void client.invalidateQueries({ queryKey: [key] }); }
export function useAnalysisJobs(options: { leadId?: string; requestKey?: string; offset?: number; enabled?: boolean } = {}) {
  const org = useWorkspaceStore(state => state.currentOrg);
  const params = new URLSearchParams({ organization_id: org?.id || "", limit: "10", offset: String(options.offset || 0) });
  if (options.leadId) params.set("lead_id", options.leadId);
  if (options.requestKey) params.set("request_key", options.requestKey);
  return useQuery({ queryKey: ["analysis-jobs", org?.id, options.leadId, options.requestKey, options.offset || 0], queryFn: () => api.get<AnalysisJobList>("/intelligence/jobs?" + params), enabled: Boolean(org && options.enabled !== false), retry: false, refetchInterval: 5000, refetchIntervalInBackground: false, refetchOnWindowFocus: "always" });
}
export function useAnalysisJob(id: string | null | undefined) {
  const org = useWorkspaceStore(state => state.currentOrg), client = useQueryClient();
  const query = useQuery({ queryKey: ["analysis-job", org?.id, id], queryFn: async () => (await api.get<{ job: AnalysisJob }>("/intelligence/jobs/" + id + "?organization_id=" + org!.id)).job, enabled: Boolean(org && id), retry: false, refetchInterval: query => query.state.data && jobFinished(query.state.data) ? false : 2000, refetchIntervalInBackground: false, refetchOnWindowFocus: "always" });
  const previous = useRef("");
  useEffect(() => {
    if (!query.data) return;
    const next = query.data.id + ":" + query.data.status + ":" + query.data.counts.completed + ":" + query.data.revision;
    if (previous.current === next) return;
    previous.current = next;
    invalidateResults(client);
    void client.invalidateQueries({ queryKey: ["analysis-jobs"] });
  }, [query.data, client]);
  return query;
}
export function useAnalysisJobCommand(id: string) {
  const org = useWorkspaceStore(state => state.currentOrg), client = useQueryClient();
  return useMutation({ mutationFn: async (input: { command: "cancel" | "retry"; expected_revision: number; reason: string }) => (await api.post<{ job: AnalysisJob }>("/intelligence/jobs/" + id + "/" + input.command, { organization_id: org!.id, expected_revision: input.expected_revision, reason: input.reason })).job, retry: false, onSuccess: job => { client.setQueryData(["analysis-job", org?.id, id], job); void client.invalidateQueries({ queryKey: ["analysis-jobs"] }); invalidateResults(client); }, onError: () => { void client.invalidateQueries({ queryKey: ["analysis-job", org?.id, id] }); } });
}
function storageKey(org: string) { return "relay-analysis-request:" + org; }
function loadRequest(org: string | undefined): AnalysisRequest | null {
  if (!org) return null;
  try { const value = JSON.parse(sessionStorage.getItem(storageKey(org)) || "null") as AnalysisRequest | null; return value && typeof value.request_key === "string" && value.request_key.length <= 200 && Array.isArray(value.lead_ids) && value.lead_ids.length > 0 && value.lead_ids.length <= 50 && value.lead_ids.every(id => typeof id === "string" && id.length <= 200) && value.mode === "PREPARE_DRAFTS" && value.target_stage === "PLAN" ? value : null; } catch { return null; }
}
export function useAnalysisSubmission() {
  const org = useWorkspaceStore(state => state.currentOrg), client = useQueryClient();
  const liveOrg = useRef(org?.id), confirmedRequest = useRef<string | null>(null); liveOrg.current = org?.id;
  const [scopedRequest, setScopedRequest] = useState<{ organizationId: string | undefined; request: AnalysisRequest | null }>(() => ({ organizationId: org?.id, request: loadRequest(org?.id) }));
  const pending = scopedRequest.organizationId === org?.id ? scopedRequest.request : null;
  function setPending(request: AnalysisRequest | null) { setScopedRequest({ organizationId: org?.id, request }); }
  const [job, setJob] = useState<AnalysisJob | null>(null), [error, setError] = useState<string | null>(null), [rejected, setRejected] = useState(false);
  const lookup = useAnalysisJobs({ requestKey: pending?.request_key, enabled: Boolean(pending) });
  useEffect(() => { setPending(loadRequest(org?.id)); setJob(null); setError(null); setRejected(false); }, [org?.id]);
  function accepted(value: AnalysisJob) {
    if (!org || value.organization_id !== org.id || value.organization_id !== liveOrg.current) return;
    try { sessionStorage.removeItem(storageKey(org.id)); } catch { /* Server history remains authoritative. */ }
    confirmedRequest.current = value.organization_id + ":" + value.request_key;
    setPending(null); setJob(value); setError(null); setRejected(false);
    client.setQueryData(["analysis-job", org.id, value.id], value);
    void client.invalidateQueries({ queryKey: ["analysis-jobs"] });
  }
  useEffect(() => { const found = lookup.data?.jobs.find(value => value.request_key === pending?.request_key); if (found) accepted(found); }, [lookup.data, pending?.request_key]);
  const mutation = useMutation({ mutationFn: async (input: { organizationId: string; request: AnalysisRequest }) => api.post<{ job: AnalysisJob; replayed: boolean }>("/intelligence/jobs", { organization_id: input.organizationId, ...input.request }), retry: false, onSuccess: response => accepted(response.job), onError: (failure, input) => { if (input.organizationId !== liveOrg.current || confirmedRequest.current === input.organizationId + ":" + input.request.request_key) return; const code = failure instanceof ApiError && failure.body && typeof failure.body === "object" ? (failure.body as { code?: string }).code : null; setRejected(Boolean(code && ["ANALYSIS_INVALID_INPUT", "ANALYSIS_INVALID_SELECTION", "ANALYSIS_LEAD_NOT_FOUND", "LEAD_ARCHIVED", "ANALYSIS_QUEUE_LIMIT", "FORBIDDEN"].includes(code))); setError(jobError(failure)); void lookup.refetch(); } });
  async function submit(ids: string[]) {
    if (!org || mutation.isPending) return;
    if (pending) { setError("Check the unconfirmed request before starting different work."); return; }
    if (!ids.length || ids.length > 50 || new Set(ids).size !== ids.length) { setError("Choose between 1 and 50 distinct leads for one job."); return; }
    const request: AnalysisRequest = { request_key: crypto.randomUUID(), lead_ids: [...ids], mode: "PREPARE_DRAFTS", target_stage: "PLAN" };
    try { sessionStorage.setItem(storageKey(org.id), JSON.stringify(request)); } catch { setError("The request recovery reference could not be saved in this browser. Allow local storage before submitting."); return; }
    setError(null); setRejected(false); setJob(null); setPending(request);
    try { await mutation.mutateAsync({ organizationId: org.id, request }); } catch { /* Visible error retains the same recoverable request. */ }
  }
  async function retrySubmission() { if (org && pending && !mutation.isPending) { setError(null); try { await mutation.mutateAsync({ organizationId: org.id, request: pending }); } catch { /* Keep the original request key. */ } } }
  function dismissRejected() {
    if (!org || mutation.isPending || !rejected) return;
    try { sessionStorage.removeItem(storageKey(org.id)); } catch { return; }
    setPending(null); setError(null); setRejected(false);
  }
  return { submit, pending, job, error, rejected, busy: mutation.isPending, lookup, retrySubmission, dismissRejected };
}
export function jobError(error: unknown) {
  const code = error instanceof ApiError && error.body && typeof error.body === "object" ? (error.body as { code?: string }).code : null;
  if (code === "ANALYSIS_INVALID_INPUT" || code === "ANALYSIS_INVALID_SELECTION") return "The selection was rejected before a job was created. Choose 1 to 50 distinct records and try again.";
  if (code?.includes("REVISION") || code?.includes("CONFLICT")) return "This request or job changed. Check its saved state; your reason is retained.";
  if (code?.includes("ARCHIVED") || code?.includes("LEAD")) return "The selection contains an unavailable or archived record. No new job was accepted; review the selected leads.";
  if (code?.includes("LIMIT") || code?.includes("BUDGET")) return "The workspace analysis limit was reached. Review existing jobs and owner AI limits before retrying.";
  if (error instanceof ApiError && error.status === 403) return "A current workspace owner is required to start or change analysis work.";
  return "The request outcome could not be confirmed. Check its saved state before explicitly retrying the same request.";
}
