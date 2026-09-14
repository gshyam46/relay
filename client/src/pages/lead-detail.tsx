import {LoadingScreen} from "@/components/loading-screen";
import {CustomerWorkflow} from "@/components/customer-workflow";
import {MessageComposer} from "@/components/message-composer";
import { FeedbackLauncher } from "@/components/intelligence-feedback";
import { AssessmentMethod, EvidenceSupport } from "@/components/assessment-method";
import { ReplyInterpretation } from "@/components/reply-interpretation";
import { BusinessFitPanel } from "@/components/business-fit";
import { CurrentnessBadge, IntelligenceCurrentnessPanel } from "@/components/intelligence-currentness";
import { RecommendationChanges } from "@/components/recommendation-changes";
import { LeadDataManagement } from "@/components/lead-data-management";
import { LeadImportSources } from "@/components/lead-import-sources";
import { EnquiryContext } from "@/components/enquiry-context";
import { useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Mail,
  Phone,
  Building,
  FileSearch,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  RefreshCw,
  MessageSquare,
  Calendar,
  Loader2,
  FileText,
  Target,
  TrendingUp,
  Lightbulb,
  ChevronDown,
  ShieldCheck,
  ArrowRight,
  Send,
  ThumbsUp,
  ThumbsDown,
  Play,
  Info,
  User,
  Radio,
  History,
} from "lucide-react";
import { ApprovalReviewDialog } from "@/components/approval-review-dialog";
import { DispatchDetailsButton, DispatchOutcome } from "@/components/dispatch-recovery-dialog";
import { Header } from "@/components/layout/header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import {
  useLead,
  useLeadIntelligence,
  useLeadIntelligenceHistory,
  useLeadResearchEvidence,
  useLeadTimeline,
  type SynthesisFinding,
  type TimelineEntry,
} from "@/hooks/use-leads";
import { useAnalysisSubmission } from "@/hooks/use-analysis-jobs";
import { AnalysisSubmissionRecovery, LatestLeadAnalysisJob } from "@/components/analysis-jobs";
import {
  useLeadOutboundActions,
  useExecuteAction,
  type LeadOutboundAction,
} from "@/hooks/use-outbound";
import { useCompleteFollowUp, useCancelFollowUp } from "@/hooks/use-follow-ups";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace";
import { api } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

const MESSAGE_CHANNELS = [
  { type: "SEND_EMAIL", label: "Email", icon: Mail },
] as const;

type Tab = "data" | "overview" | "enquiry" | "intelligence" | "outbound" | "customer-workflow";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "data", label: "Lead data" },
  { key: "enquiry", label: "Enquiry" },
  { key: "intelligence", label: "Intelligence" },
  { key: "outbound", label: "Outbound & Activity" },
  { key: "customer-workflow", label: "Conversation & Outcomes" },
];

export function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: Tab = tabParam === "data" || tabParam === "enquiry" || tabParam === "intelligence" || tabParam === "outbound" || tabParam === "customer-workflow" ? tabParam : "overview";

  const { data: lead, isLoading, isError, refetch } = useLead(id);
  const { data: intel, isError: intelligenceError, isFetching: checkingIntelligence, refetch: checkIntelligence } = useLeadIntelligence(id);
  const { data: timeline } = useLeadTimeline(id);
  const { data: outboundActions } = useLeadOutboundActions(id);
  const analysisSubmission = useAnalysisSubmission();
  const org = useWorkspaceStore((s) => s.currentOrg);
  const qc = useQueryClient();
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [messageMenuOpen, setMessageMenuOpen] = useState(false);
  const [composerOpen,setComposerOpen]=useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const setTab = (next: Tab) => {
    setSearchParams(next === "overview" ? {} : { tab: next });
  };

  const showFeedback = (type: "success" | "error", message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 4000);
  };

  const invalidateAfterAction = () => {
    qc.invalidateQueries({ queryKey: ["lead-timeline"] });
    qc.invalidateQueries({ queryKey: ["lead-outbound"] });
    qc.invalidateQueries({ queryKey: ["outbound-summary"] });
    qc.invalidateQueries({ queryKey: ["activity-feed"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["dashboard-attention"] });
  };

  const handleAnalyze = async () => {
    if (!id || runningAction || lead?.archived_at || intelligenceError || !intel?.currentness?.can_refresh) return;
    setRunningAction("analyze");
    try { await analysisSubmission.submit([id]); } finally { setRunningAction(null); }
  };

  const handleSendMessage = async (type: string, label: string) => {
    if (!id || !org || runningAction || lead?.archived_at) return;
    setMessageMenuOpen(false);
    if(type === "SEND_EMAIL"){setComposerOpen(true);return;}
    setRunningAction("message");
    try {
      await api.post(`/leads/${id}/actions`, { organization_id: org.id, type });
      invalidateAfterAction();
      showFeedback("success", `${label} queued for review. Review the exact recipient and message before approving.`);
      setTab("outbound");
    } catch (err: unknown) {
      showFeedback("error", err instanceof Error ? err.message : "Failed to create action");
    } finally {
      setRunningAction(null);
    }
  };

  const handleScheduleFollowUp = async () => { setTab("customer-workflow"); };

  if (isLoading) return <><Header title="Lead" /><LoadingScreen compact title="Loading enquiry details" /></>;

  if (isError) {
    return (
      <>
        <Header title="Lead" />
        <ErrorState title="Couldn't load this lead" onRetry={() => refetch()} />
      </>
    );
  }

  if (!lead) {
    return (
      <>
        <Header title="Lead" />
        <EmptyState
          icon={User}
          title="Lead not found"
          description="This lead may have been removed, or the link is out of date."
          action={
            <button
              onClick={() => navigate("/leads")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-brand text-white rounded-lg hover:bg-brand-strong transition-colors cursor-pointer"
            >
              Back to Leads
            </button>
          }
        />
      </>
    );
  }

  const analyzeLabel =
    !intel || intel.currentness?.state === "NEVER_ANALYSED"
      ? "Analyze lead"
      : "Refresh intelligence";

  const readyForReviewCount = (outboundActions || []).filter((a) => a.approval?.status === "PENDING").length;
  const dueFollowUpCount = (timeline || []).filter((e) => e.kind === "follow_up" && e.status === "DUE").length;

  return (
    <>
      <Header
        title={lead.name || lead.email || lead.phone || "Unnamed lead"}
        actions={
          <button
            onClick={() => navigate("/leads")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-line rounded-lg hover:bg-soft transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
        }
      />
      {feedback && (
        <div role={feedback.type === "error" ? "alert" : "status"}
          className={cn(
            "mx-6 mt-4 px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2",
            feedback.type === "success" ? "bg-ok-light text-ok" : "bg-danger-light text-danger",
          )}
        >
          {feedback.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          {feedback.message}
          <button type="button" className="ml-auto text-xs underline" onClick={() => setFeedback(null)}>Dismiss</button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Contact Hero — persistent across tabs */}
        <div className="bg-surface border border-line rounded-xl p-6">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="w-14 h-14 rounded-full bg-brand-light flex items-center justify-center text-brand font-bold text-xl shrink-0">
              {(lead.name?.[0] || lead.email?.[0] || "?").toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-lg font-semibold text-ink">{lead.name || "Unnamed lead"}</h2>
                <StatusBadge status={lead.status} />
                {lead.archived_at && <span className="rounded bg-soft px-2 py-1 text-xs font-medium">Archived</span>}
                <CurrentnessBadge currentness={intel?.currentness} />
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-2">
                {lead.company && <InfoChip icon={Building} text={lead.company} />}
                {lead.email && <InfoChip icon={Mail} text={lead.email} />}
                {lead.phone && <InfoChip icon={Phone} text={lead.phone} />}
              </div>
            </div>
            <div className="flex gap-2 shrink-0 relative">
              <div className="relative">
                <button
                  onClick={() => setMessageMenuOpen((v) => !v)}
                  disabled={!!runningAction || !!lead.archived_at}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-line rounded-lg hover:bg-soft transition-colors cursor-pointer disabled:opacity-50"
                >
                  {runningAction === "message" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <MessageSquare className="w-3.5 h-3.5" />
                  )}
                  Message
                  <ChevronDown className="w-3 h-3" />
                </button>
                {messageMenuOpen && !lead.archived_at && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMessageMenuOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 w-44 bg-surface border border-line rounded-lg shadow-lg z-20 py-1">
                      {MESSAGE_CHANNELS.map((c) => (
                        <button
                          key={c.type}
                          onClick={() => handleSendMessage(c.type, c.label)}
                          className="flex items-center gap-2 w-full px-3 py-2 text-xs text-ink hover:bg-soft transition-colors cursor-pointer text-left"
                        >
                          <c.icon className="w-3.5 h-3.5 text-brand" />
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={handleAnalyze}
                disabled={!!runningAction || !!analysisSubmission.pending || !!lead.archived_at || intelligenceError || !intel?.currentness?.can_refresh}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-brand text-white rounded-lg hover:bg-brand-strong transition-colors cursor-pointer disabled:opacity-50"
              >
                {runningAction === "analyze" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                {analyzeLabel}
              </button>
            </div>
          </div>
        </div>

        {lead.archived_at && <p className="rounded-lg border border-line bg-soft p-3 text-sm">This record is archived. Contact restrictions remain in force. Restore it in Lead data before editing, analysing or creating work; restoration restarts no work.</p>}
        <AnalysisSubmissionRecovery submission={analysisSubmission} />
        {(composerOpen || searchParams.get("compose_action")) && id && !lead.archived_at && <MessageComposer leadId={id} actionId={searchParams.get("compose_action")} onClose={()=>{setComposerOpen(false);if(searchParams.has("compose_action")){const next=new URLSearchParams(searchParams);next.delete("compose_action");setSearchParams(next);}invalidateAfterAction();}}/>}
        <LatestLeadAnalysisJob leadId={id!} submittedId={analysisSubmission.job?.items.some(item => item.lead_id === id) ? analysisSubmission.job.id : null} />
        {/* Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-line -mb-px">
          {TABS.map((t) => {
            const badge =
              t.key === "outbound" && readyForReviewCount + dueFollowUpCount > 0
                ? readyForReviewCount + dueFollowUpCount
                : null;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "shrink-0 whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-1.5",
                  tab === t.key
                    ? "border-brand text-brand"
                    : "border-transparent text-muted hover:text-ink hover:border-line",
                )}
              >
                {t.label}
                {badge != null && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-warn-light text-warn">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {tab === "overview" && (
          <OverviewTab lead={lead} intel={intel} onGoToIntelligence={() => setTab("intelligence")} />
        )}
        {tab === "customer-workflow" && <CustomerWorkflow leadId={lead.id} archived={!!lead.archived_at}/> }
        {tab === "data" && <LeadDataManagement leadId={lead.id} />}
        {tab === "enquiry" && <div className="space-y-6"><EnquiryContext leadId={lead.id} archived={!!lead.archived_at} /><LeadImportSources leadId={lead.id} /></div>}
        {tab === "intelligence" && (
          <IntelligenceTab
            leadId={lead.id}
            intel={intel}
            timeline={timeline || []}
            onReviewInOutbound={() => setTab("outbound")}
            analyzeLabel={analyzeLabel}
            checking={checkingIntelligence} currentnessError={intelligenceError} onCheck={() => void checkIntelligence()}
          />
        )}
        {tab === "outbound" && (
          <OutboundActivityTab
            archived={!!lead.archived_at}
            actions={outboundActions || []}
            timeline={timeline || []}
            onScheduleFollowUp={handleScheduleFollowUp}
            runningAction={runningAction}
          />
        )}
      </div>
    </>
  );
}

// ---------- Overview ----------

function OverviewTab({
  lead,
  intel,
  onGoToIntelligence,
}: {
  lead: NonNullable<ReturnType<typeof useLead>["data"]>;
  intel: ReturnType<typeof useLeadIntelligence>["data"];
  onGoToIntelligence: () => void;
}) {
  const readiness = intel?.readiness;
  const provenance = formatProvenance(lead);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 space-y-5">
        <Section icon={User} title="Lead Information">
          <p className="text-xs text-muted -mt-1 mb-3">Customer-provided data — not AI-generated.</p>
          <div className="grid grid-cols-2 gap-x-8 gap-y-0">
            <DetailRow label="Source" value={provenance} />
            <DetailRow label="Status" value={formatLabel(lead.status)} />
            <DetailRow
              label="Created"
              value={new Date(lead.created_at).toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            />
            {lead.updated_at && (
              <DetailRow
                label="Updated"
                value={new Date(lead.updated_at).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              />
            )}
            <DetailRow label="Name" value={lead.name || "—"} />
            <DetailRow label="Company" value={lead.company || "—"} />
            <DetailRow label="Email" value={lead.email || "—"} />
            <DetailRow label="Phone" value={lead.phone || "—"} />
          </div>
        </Section>
      </div>
      <div className="space-y-5">
        <div className="bg-surface border border-line rounded-xl p-5">
          <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
            <FileSearch className="w-4 h-4 text-brand" />
            Intelligence Snapshot
          </h3>
          {readiness ? (
            <>
              <p className="text-xs text-muted mb-3">
                {readiness.factors.filter((f) => f.available).length}/{readiness.factors.length} data fields
                available for analysis.
              </p>
              <button
                onClick={onGoToIntelligence}
                className="flex items-center gap-1.5 text-xs font-medium text-brand hover:text-brand-strong cursor-pointer"
              >
                View full intelligence
                <ArrowRight className="w-3 h-3" />
              </button>
            </>
          ) : (
            <p className="text-sm text-muted">{intel?.currentness?.state === "OUTDATED" ? "Previous analysis is outdated. Open Intelligence to review the changes." : "No current analysis summary is available."}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Intelligence ----------

function IntelligenceTab({
  leadId,
  intel,
  timeline,
  onReviewInOutbound,
  analyzeLabel, checking, currentnessError, onCheck,
}: {
  leadId: string;
  intel: ReturnType<typeof useLeadIntelligence>["data"];
  timeline: TimelineEntry[];
  onReviewInOutbound: () => void;
  /** The header button's current label, so empty states name the control that
   *  actually exists rather than a fixed string that goes stale. */
  analyzeLabel: string; checking: boolean; currentnessError: boolean; onCheck: () => void;
}) {
  const readiness = intel?.readiness;
  const synthesis = intel?.synthesis;
  const recommendation = intel?.currentness?.state === "CURRENT" ? intel.recommendation : null;
  const nba = intel?.currentness?.state === "CURRENT" ? intel.next_best_action : null;
  const snapshotEvidence = intel?.snapshot?.evidence || [];
  const [historyOpen, setHistoryOpen] = useState(false);
  const { data: history } = useLeadIntelligenceHistory(leadId, historyOpen);
  const externalFindings = (synthesis?.findings || []).filter((f: SynthesisFinding) => f.source === "APPROVED_RESEARCH_EVIDENCE");
  const research = useLeadResearchEvidence(leadId, synthesis?.id, externalFindings.length > 0);
  const evidence = [...snapshotEvidence, ...(research.data || [])];
  const latestInbound = [...timeline]
    .filter((e) => e.kind === "message" && e.direction === "INBOUND")
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];

  return (
    <div className="space-y-5">
      <div aria-label="Saved assessment review actions" className="flex flex-wrap gap-2">{([ ["SNAPSHOT", intel?.snapshot?.id, "Review readiness and fit"], ["SYNTHESIS", intel?.synthesis?.id, "Review source assessment"], ["RECOMMENDATION", intel?.recommendation?.id, "Review recommendation"], ["PLAN", intel?.next_best_action?.id, "Review action plan"] ] as const).map(([kind, targetId, label]) => <FeedbackLauncher key={kind} label={label} target={targetId ? { lead_id: leadId, target_kind: kind, target_id: targetId } : null} />)}</div>
      <IntelligenceCurrentnessPanel leadId={leadId} currentness={intel?.currentness} freshness={intel?.freshness} checking={checking} error={currentnessError} onCheck={onCheck} />
      <BusinessFitPanel leadId={leadId} fit={intel?.currentness?.state === "CURRENT" ? intel.business_fit : null} attention={intel?.currentness?.state === "CURRENT" ? intel.attention_priority : null} currentnessError={currentnessError} leadStatus={intel?.lead_status} />
      {intel?.recommendation_comparison && <RecommendationChanges comparison={intel.recommendation_comparison} />}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 space-y-5">
        {latestInbound && (
          <div className="bg-brand-light/40 border border-brand/20 rounded-xl p-4 flex items-start gap-3">
            <Radio className="w-4 h-4 text-brand shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs font-semibold text-brand uppercase tracking-wide">
                  Latest recorded inbound message &middot; {formatLabel(latestInbound.channel || "")}
                </p>

              </div>
              <p className="text-xs font-medium text-muted mt-2">Original message</p>
              <p className="text-sm text-ink mt-0.5 whitespace-pre-wrap break-words">{latestInbound.original_text ?? "Original message text is unavailable."}</p>
              <p className="text-[11px] text-muted mt-0.5">{new Date(latestInbound.timestamp).toLocaleString()}</p>
              <FeedbackLauncher label="Review this reply interpretation" target={{ lead_id: leadId, target_kind: "REPLY", target_id: latestInbound.id }} /><ReplyInterpretation interpretation={latestInbound.interpretation} original={latestInbound.original_text || ""} eventType={latestInbound.classification_event_type} confidence={latestInbound.classification_confidence} />
            </div>
          </div>
        )}
        <Section icon={TrendingUp} title="Data Readiness">
          {readiness ? (
            <div className="flex items-start gap-5">
              <div className="relative w-16 h-16 shrink-0">
                <svg className="w-16 h-16 -rotate-90" viewBox="0 0 56 56">
                  <circle cx="28" cy="28" r="24" fill="none" stroke="var(--color-line)" strokeWidth="4" />
                  <circle
                    cx="28"
                    cy="28"
                    r="24"
                    fill="none"
                    stroke="var(--color-brand)"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={`${(readiness.score / 100) * 150.8} 150.8`}
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-ink">
                  {readiness.score}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink mb-2">
                  {readiness.status === "READY" ? "Ready for analysis" : "Needs more data"}
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {readiness.factors.map((f) => (
                    <div key={f.label} className="flex items-center gap-1.5 text-xs">
                      {f.available ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-ok shrink-0" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-danger shrink-0" />
                      )}
                      <span className="text-muted">{f.label}</span>
                    </div>
                  ))}
                </div>
                {readiness.missing.length > 0 && (
                  <p className="text-[11px] text-warn mt-2 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Missing: {readiness.missing.join(", ")}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <EmptySection message={`No readiness assessment yet. Use “${analyzeLabel}” above.`} />
          )}
        </Section>

        <Section icon={Info} title="Source assessment">
          {synthesis && <div className="mb-3"><AssessmentMethod generation={synthesis.summary.generation} claims={synthesis.summary.claims} evidence={evidence} leadId={leadId} reviewFlags={synthesis.qualification?.review_flags} /></div>}
          {synthesis?.qualification ? (
            <div className="p-3 bg-brand-light/30 rounded-lg border border-brand/20">
              <p className="text-xs font-semibold text-brand uppercase tracking-wide mb-1">
                {formatLabel(synthesis.qualification.outcome)}
              </p>
              <ul className="text-sm text-ink space-y-0.5 list-disc list-inside">
                {synthesis.qualification.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          ) : (
            <EmptySection
              message={
                intel?.synthesis_status === "NOT_READY"
                  ? "Not enough data yet for this source assessment."
                  : `No source assessment yet. Use “${analyzeLabel}” above.`
              }
            />
          )}
        </Section>

        {externalFindings.length > 0 && (
          <Section icon={FileText} title="External Research Findings">
            {research.isError && <p role="alert" className="text-sm text-warn">Supporting research could not be loaded. <button type="button" className="underline" onClick={() => research.refetch()}>Check saved research</button></p>}
            <p className="text-xs text-muted mb-3">These are recorded source claims. Source confidence is not a measured probability of truth; review supporting records and source freshness before using them.</p>
            <div className="space-y-2">
              {externalFindings.map((f, i) => (
                <div key={i} className="flex gap-3 p-3 bg-page rounded-lg border border-line">

                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-muted uppercase tracking-wide">{formatLabel(f.field)}</p>
                    <p className="text-sm text-ink mt-0.5 whitespace-pre-wrap break-words">{f.value}</p>
                    <p className="text-xs text-muted mt-2">Recorded source confidence: {formatLabel(f.confidence)}</p>
                    <details className="mt-2"><summary className="cursor-pointer text-xs text-brand">Supporting source records</summary><div className="mt-2"><EvidenceSupport references={f.evidence_refs} evidence={evidence} field={f.field} value={f.value} /></div></details>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section icon={Lightbulb} title="Recommendation">
          {recommendation ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <details className="text-xs text-muted"><summary className="cursor-pointer">Legacy processing attention</summary><div className="mt-2 space-y-1"><PriorityBadge label={recommendation.priority.label} score={recommendation.priority.score} /><p>{recommendation.priority.reason}</p><p>This historical processing measure is separate from configured business fit and queue order.</p></div></details>
                <span className="text-xs text-muted">{recommendation.segment.label}</span>
              </div>
              <div className="flex items-start gap-3 p-3 bg-page rounded-lg border border-line">
                <Target className="w-4 h-4 text-brand shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{recommendation.recommendation.label}</p>
                  <p className="text-xs text-muted mt-0.5">{recommendation.recommendation.reason}</p>
                </div>
              </div>
              {recommendation.personalization_context.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {recommendation.personalization_context.map((f) => (
                    <span
                      key={f.label}
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-soft text-muted"
                    >
                      {f.label}: {f.value}
                    </span>
                  ))}
                </div>
              )}
              {nba && (
                <div className="p-3 rounded-lg border border-line bg-page">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-brand shrink-0" />
                      <p className="text-sm font-medium text-ink">Next step: {nba.title}</p>
                    </div>
                    <NbaStatusBadge status={nba.status} />
                  </div>
                  <p className="text-xs text-muted mt-1">{nba.rationale}</p>
                  {nba.status === "PLANNED" && (
                    <button
                      onClick={onReviewInOutbound}
                      disabled={currentnessError}
                      className="flex items-center gap-1 mt-2 text-xs font-medium text-brand hover:text-brand-strong cursor-pointer"
                    >
                      Review outbound
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                  {nba.status === "BLOCKED" && (
                    <p className="text-xs text-danger mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      Blocked by policy: {nba.policy_decision.reasons.join(", ")}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <EmptySection
              message={
                intel?.recommendation_status === "NOT_READY"
                  ? intel?.currentness?.state === "OUTDATED" ? "Previous recommendations are outdated. Review the source changes above and refresh when appropriate." : "Analyze this lead to generate a recommendation."
                  : `No recommendation yet. Use “${analyzeLabel}” above.`
              }
            />
          )}
        </Section>
      </div>

      <div className="space-y-5">
        {intel && (
          <div className="bg-surface border border-line rounded-xl p-5">
            <h3 className="text-sm font-semibold text-ink mb-3">Analysis Status</h3>
            <div className="space-y-2">
              <PipelineRow label="Readiness" status={intel.intelligence_status} />
              <PipelineRow label="Qualification" status={intel.synthesis_status} />
              <PipelineRow label="Recommendation" status={intel.recommendation_status} />
              <PipelineRow label="Next step" status={intel.next_best_action_status} />
            </div>
          </div>
        )}

        {evidence.length > 0 && (
          <div className="bg-surface border border-line rounded-xl p-5">
            <h3 className="text-sm font-semibold text-ink mb-2 flex items-center gap-2">
              <FileText className="w-4 h-4 text-brand" />
              Evidence
            </h3>
            <p className="text-[11px] text-muted mb-3">What grounds this analysis.</p>
            <div className="flex flex-wrap gap-1.5">
              {evidence.slice(0, 20).map((e) => (
                <span
                  key={e.id}
                  className="text-[10px] px-2 py-1 rounded-md bg-page border border-line text-muted"
                  title={e.claim_value || e.title || undefined}
                >
                  {formatLabel(e.source_type)} &middot; {e.claim_field ? formatLabel(e.claim_field) : "Source review"}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="bg-surface border border-line rounded-xl p-5">
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="w-full flex items-center justify-between text-sm font-semibold text-ink cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <History className="w-4 h-4 text-brand" />
              Analysis History
            </span>
            <ChevronDown className={cn("w-4 h-4 text-muted transition-transform", historyOpen && "rotate-180")} />
          </button>
          {historyOpen && (
            <div className="mt-3 space-y-2">
              {!history ? (
                <p className="text-xs text-muted">Loading...</p>
              ) : history.length === 0 ? (
                <p className="text-xs text-muted">No prior runs yet — this is the first analysis.</p>
              ) : (
                history.map((snap) => (
                  <div key={snap.id} className="flex items-start gap-3 p-2.5 rounded-lg border border-line bg-page">
                    <div className="text-[10px] font-mono font-semibold text-muted shrink-0 mt-0.5">v{snap.version}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-ink">{formatLabel(snap.readiness_status)}</span>
                        <span className="text-[10px] text-muted">score {snap.readiness_score}</span>
                        <span className="text-[10px] text-subtle">{new Date(snap.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-[11px] text-muted mt-0.5 line-clamp-2">{snap.summary}</p><FeedbackLauncher label={"Review saved snapshot v" + snap.version} target={{ lead_id: leadId, target_kind: "SNAPSHOT", target_id: snap.id }} />
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

// ---------- Outbound & Activity ----------

function OutboundActivityTab({
  archived,
  actions,
  timeline,
  onScheduleFollowUp,
  runningAction,
}: {
  archived: boolean;
  actions: LeadOutboundAction[];
  timeline: TimelineEntry[];
  onScheduleFollowUp: () => void;
  runningAction: string | null;
}) {
  const execute = useExecuteAction();
  const completeFollowUp = useCompleteFollowUp();
  const cancelFollowUp = useCancelFollowUp();
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [reviewIds, setReviewIds] = useState<string[] | null>(null);

  // A conversation is what was said to and by the lead. Internal human tasks
  // share the same channel_messages table so they appear on the activity
  // timeline, but showing them as conversation bubbles ("Follow up with X based
  // on the current lead intelligence") is a note to ourselves, not a message.
  // They stay visible in Outbound Actions above.
  const CONVERSATIONAL_CHANNELS = ["EMAIL", "WHATSAPP", "SMS", "VOICE"];
  const messages = timeline.filter(
    (e) => e.kind === "message" && CONVERSATIONAL_CHANNELS.includes(String(e.channel || "").toUpperCase()),
  );
  const followUps = timeline.filter((e) => e.kind === "follow_up");

  const withBusy = (id: string, fn: () => Promise<unknown>) => async () => {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await fn();
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {reviewIds && !archived && <ApprovalReviewDialog actionIds={reviewIds} onClose={() => setReviewIds(null)} />}
      <div className="lg:col-span-2 space-y-5">
        <Section icon={Send} title="Outbound Actions">
          {actions.length > 0 ? (
            <div className="space-y-2">
              {actions.map((a) => (
                <OutboundActionRow
                  key={a.id}
                  action={a}
                  archived={archived}
                  busy={busyIds.has(a.id)}
                  onApprove={() => setReviewIds([a.id])}
                  onReject={() => setReviewIds([a.id])}
                  onExecute={withBusy(a.id, () => execute.mutateAsync(a.id))}
                />
              ))}
            </div>
          ) : (
            <EmptySection message={archived ? "No outbound actions. Restore this record before creating work." : "No outbound actions yet. Analyze this lead to get a recommendation, or send a message above."} />
          )}
        </Section>

        <Section icon={MessageSquare} title="Conversation">
          {messages.length > 0 ? (
            <ConversationThread messages={messages} />
          ) : (
            <EmptySection message="No messages yet on any channel." />
          )}
        </Section>
      </div>

      <div className="space-y-5">
        <div className="bg-surface border border-line rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
              <Calendar className="w-4 h-4 text-brand" />
              Follow-ups
            </h3>
            <button
              onClick={onScheduleFollowUp}
              disabled={!!runningAction || archived}
              className="text-xs font-medium text-brand hover:text-brand-strong cursor-pointer disabled:opacity-50"
            >
              + Schedule
            </button>
          </div>
          {followUps.length > 0 ? (
            <div className="space-y-2">
              {followUps.map((f) => (
                <FollowUpTask
                  key={f.id}
                  entry={f}
                  onComplete={() => completeFollowUp.mutate(f.id)}
                  onCancel={() => cancelFollowUp.mutate(f.id)}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted text-center py-4">No follow-ups scheduled.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function OutboundActionRow({
  archived,
  action,
  busy,
  onApprove,
  onReject,
  onExecute,
}: {
  archived: boolean;
  action: LeadOutboundAction;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onExecute: () => void;
}) {
  const needsApproval = action.status === "AWAITING_APPROVAL" || (action.status === "PLANNED" && action.type.startsWith("SEND_"));
  const canReview = !archived && ["PLANNED", "AWAITING_APPROVAL", "APPROVED", "RETRYING"].includes(action.status);
  const canExecute = !archived && (["APPROVED", "RETRYING"].includes(action.status) || (action.status === "PLANNED" && !action.type.startsWith("SEND_")));

  return (
    <div className="flex items-center justify-between gap-3 p-3 bg-page rounded-lg border border-line flex-wrap">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <TypeBadge type={action.type} />
          <ActionStatusBadge status={action.status} />
          <DispatchOutcome outcome={action.executions.at(-1)?.outcome_class} />
        </div>
        {/* Show original draft context. Exact reviewed content is loaded in the dialog.
            Show the message draft, not just the internal
            plan title — this is an approval decision, and it cannot be made
            without seeing the content. Human tasks have no customer-facing copy
            and fall back to their title. */}
        {typeof action.payload?.message === "string" && action.type.startsWith("SEND_") ? (
          <div className="mt-1.5">
            <p className="text-[10px] text-muted">Draft context / Open Review for the current message</p>
            {typeof action.payload?.subject === "string" && (
              <p className="text-xs font-medium text-ink truncate">{action.payload.subject as string}</p>
            )}
            <p className="text-xs text-muted mt-0.5 whitespace-pre-wrap line-clamp-3">
              {action.payload.message as string}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted mt-1">
            {formatLabel((action.payload?.title as string) || (action.payload?.reason as string) || action.type)}
          </p>
        )}
      </div>
      {busy ? (
        <Loader2 className="w-4 h-4 animate-spin text-brand shrink-0" />
      ) : (
        <div className="flex items-center gap-1 shrink-0">
          <DispatchDetailsButton actionId={action.id} />
          {canReview && (
            <>
              <button
                onClick={onApprove}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-ok bg-ok-light rounded-md hover:bg-ok/15 transition-colors cursor-pointer"
              >
                <ThumbsUp className="w-3.5 h-3.5" />
                Review
              </button>
              <button
                onClick={onReject}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-danger bg-danger-light rounded-md hover:bg-danger/15 transition-colors cursor-pointer"
              >
                <ThumbsDown className="w-3.5 h-3.5" />
                Review to reject
              </button>
            </>
          )}
          {canExecute && !needsApproval && (
            <button
              onClick={onExecute}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-brand bg-brand-light rounded-md hover:bg-brand-muted transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              Send now
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ConversationThread({ messages }: { messages: TimelineEntry[] }) {
  const { id: leadId } = useParams();
  const sorted = [...messages].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return (
    <div className="space-y-3">
      {sorted.map((m) => {
        const inbound = m.direction === "INBOUND";
        return (
          <div key={m.id} className={cn("flex gap-3", inbound ? "flex-row" : "flex-row-reverse")}>
            <div
              className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                inbound ? "bg-ok-light text-ok" : "bg-brand-light text-brand",
              )}
            >
              {inbound ? <User className="w-3.5 h-3.5" /> : <Radio className="w-3.5 h-3.5" />}
            </div>
            <div className={cn("max-w-[75%] rounded-xl px-3.5 py-2.5", inbound ? "bg-ok-light" : "bg-page border border-line")}>
              <div className={cn("flex items-center gap-2 mb-1", inbound ? "" : "flex-row-reverse")}>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {formatLabel(m.channel || "channel")}
                </span>
                <span className="text-[10px] text-subtle">{new Date(m.timestamp).toLocaleString()}</span>
                {m.status && <StatusDot status={m.status} />}
              </div>
              {inbound && <p className="text-xs font-medium text-muted mb-1">Original message</p>}
              <p className="text-sm text-ink whitespace-pre-wrap break-words">{inbound ? m.original_text ?? "Original message text is unavailable." : m.message}</p>
              {inbound && <FeedbackLauncher label="Review this reply interpretation" target={{ lead_id: leadId!, target_kind: "REPLY", target_id: m.id }} />}{inbound && <ReplyInterpretation interpretation={m.interpretation} original={m.original_text || ""} eventType={m.classification_event_type} confidence={m.classification_confidence} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FollowUpTask({
  entry,
  onComplete,
  onCancel,
}: {
  entry: TimelineEntry;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const isOpen = entry.status === "PLANNED" || entry.status === "DUE";
  return (
    <div className="p-3 bg-page rounded-lg border border-line">
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
            entry.status === "DUE" ? "bg-warn-light text-warn" : entry.status === "COMPLETED" ? "bg-ok-light text-ok" : "bg-soft text-muted",
          )}
        >
          {formatLabel(entry.status || "")}
        </span>
        <span className="text-[11px] text-muted">{new Date(entry.timestamp).toLocaleDateString()}</span>
      </div>
      <p className="text-sm text-ink mt-1.5">{entry.message}</p>
      {isOpen && (
        <div className="flex items-center gap-2 mt-2">
          <button onClick={onComplete} className="text-[11px] font-medium text-ok hover:underline cursor-pointer">
            Mark done
          </button>
          <button onClick={onCancel} className="text-[11px] font-medium text-danger hover:underline cursor-pointer">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Shared UI ----------

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface border border-line rounded-xl p-5">
      <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
        <Icon className="w-4 h-4 text-brand" />
        {title}
      </h3>
      {children}
    </div>
  );
}

function EmptySection({ message }: { message: string }) {
  return <p className="text-sm text-muted text-center py-4">{message}</p>;
}

function InfoChip({ icon: Icon, text }: { icon: typeof Mail; text: string }) {
  return (
    <span className="flex items-center gap-1.5 text-sm text-muted">
      <Icon className="w-3.5 h-3.5" />
      {text}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    NEW: "bg-brand-light text-brand",
    ACTIVE: "bg-ok-light text-ok",
    CONVERTED: "bg-ok-light text-ok",
    OPTED_OUT: "bg-danger-light text-danger",
  };
  return (
    <span className={cn("text-xs font-semibold uppercase px-2.5 py-1 rounded-full", styles[status] ?? "bg-soft text-muted")}>
      {formatLabel(status)}
    </span>
  );
}

function NbaStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    PLANNED: { label: "Ready for review", className: "bg-warn-light text-warn" },
    BLOCKED: { label: "Blocked", className: "bg-danger-light text-danger" },
  };
  const entry = map[status] ?? { label: formatLabel(status), className: "bg-soft text-muted" };
  return <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0", entry.className)}>{entry.label}</span>;
}

function PipelineRow({ label, status }: { label: string; status: string }) {
  const DONE = new Set(["READY", "GENERATED", "PLANNED", "BLOCKED", "COMPLETED"]);
  const FAILED = new Set(["FAILED"]);
  const isDone = DONE.has(status);
  const isFailed = FAILED.has(status);
  const Icon = isFailed ? XCircle : isDone ? CheckCircle2 : Clock;
  const className = isFailed ? "text-danger" : isDone ? "text-ok" : "text-muted";
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted">{label}</span>
      <span className={cn("flex items-center gap-1 font-medium", className)}>
        <Icon className="w-3 h-3" />
        {isDone ? "Done" : isFailed ? "Failed" : "Pending"}
      </span>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "DELIVERED" || status === "COMPLETED" || status === "SENT"
      ? "bg-ok"
      : status === "FAILED"
        ? "bg-danger"
        : "bg-warn";
  return <span className={cn("w-1.5 h-1.5 rounded-full", color)} title={formatLabel(status)} />;
}

function PriorityBadge({ label, score }: { label: string; score: number }) {
  const className = score >= 75 ? "bg-danger-light text-danger" : score >= 50 ? "bg-warn-light text-warn" : "bg-ok-light text-ok";
  return <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", className)}>{label} ({score})</span>;
}

function TypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    SEND_EMAIL: "bg-brand-light text-brand-strong",
    SEND_WHATSAPP: "bg-brand/5 text-brand-strong",
    SEND_SMS: "bg-soft text-ink",
    SEND_VOICE_CALL: "bg-soft text-ink",
    CREATE_HUMAN_TASK: "bg-brand-light text-brand-strong",
    UPDATE_CRM: "bg-soft text-muted",
    RUN_RESEARCH: "bg-brand/5 text-brand-strong",
  };
  return (
    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap", styles[type] ?? "bg-soft text-muted")}>
      {formatLabel(type)}
    </span>
  );
}

function ActionStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    PLANNED: { label: "Planned", className: "bg-soft text-muted" },
    AWAITING_APPROVAL: { label: "Awaiting review", className: "bg-warn-light text-warn" },
    APPROVED: { label: "Approved", className: "bg-ok-light text-ok" },
    EXECUTING: { label: "Sending", className: "bg-brand-light text-brand" },
    COMPLETED: { label: "Sent", className: "bg-ok-light text-ok" },
    RETRYING: { label: "Retrying", className: "bg-warn-light text-warn" },
    FAILED: { label: "Failed", className: "bg-danger-light text-danger" },
    BLOCKED: { label: "Blocked", className: "bg-danger-light text-danger" },
  };
  const entry = map[status] ?? { label: formatLabel(status), className: "bg-soft text-muted" };
  return <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap", entry.className)}>{entry.label}</span>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-2 border-b border-line last:border-0">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-sm text-ink font-medium text-right truncate max-w-[60%]">{value}</span>
    </div>
  );
}

function formatProvenance(lead: { source: string; source_metadata?: { filename?: string; row_number?: number } | null }): string {
  const rowNumber = lead.source_metadata?.row_number;
  const filename = lead.source_metadata?.filename;
  if (lead.source === "CSV" && rowNumber) {
    return `Imported from CSV${filename ? ` (${filename})` : ""} · Row ${rowNumber}`;
  }
  if (lead.source === "MANUAL") {
    return "Added manually";
  }
  return formatLabel(lead.source);
}

function formatLabel(s: string) {
  return s
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}
