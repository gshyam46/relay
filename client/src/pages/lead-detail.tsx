import { useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Mail,
  Phone,
  Building,
  Brain,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Zap,
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
  HelpCircle,
  Ban,
  History,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import {
  useLead,
  useLeadIntelligence,
  useLeadIntelligenceHistory,
  useLeadTimeline,
  type SynthesisFinding,
  type TimelineEntry,
} from "@/hooks/use-leads";
import { useRunFullPipeline } from "@/hooks/use-intelligence";
import {
  useLeadOutboundActions,
  useApproveAction,
  useRejectAction,
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
  { type: "SEND_WHATSAPP", label: "WhatsApp", icon: MessageSquare },
  { type: "SEND_SMS", label: "SMS", icon: MessageSquare },
  { type: "SEND_VOICE_CALL", label: "Voice call", icon: Phone },
] as const;

type Tab = "overview" | "intelligence" | "outbound";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "intelligence", label: "Intelligence" },
  { key: "outbound", label: "Outbound & Activity" },
];

export function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: Tab = tabParam === "intelligence" || tabParam === "outbound" ? tabParam : "overview";

  const { data: lead, isLoading, isError, refetch } = useLead(id);
  const { data: intel } = useLeadIntelligence(id);
  const { data: timeline } = useLeadTimeline(id);
  const { data: outboundActions } = useLeadOutboundActions(id);
  const runPipeline = useRunFullPipeline();
  const org = useWorkspaceStore((s) => s.currentOrg);
  const qc = useQueryClient();
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [messageMenuOpen, setMessageMenuOpen] = useState(false);
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
    if (!id || runningAction) return;
    setRunningAction("analyze");
    try {
      await runPipeline.mutateAsync(id);
      showFeedback("success", "Analysis complete — recommendation and next action ready below.");
    } catch (err: unknown) {
      showFeedback("error", err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setRunningAction(null);
    }
  };

  const handleSendMessage = async (type: string, label: string) => {
    if (!id || !org || runningAction) return;
    setMessageMenuOpen(false);
    setRunningAction("message");
    try {
      await api.post(`/leads/${id}/actions`, { organization_id: org.id, type });
      invalidateAfterAction();
      showFeedback("success", `${label} queued — it will send automatically within a few seconds.`);
      setTab("outbound");
    } catch (err: unknown) {
      showFeedback("error", err instanceof Error ? err.message : "Failed to create action");
    } finally {
      setRunningAction(null);
    }
  };

  const handleScheduleFollowUp = async () => {
    if (!id || !org || runningAction) return;
    setRunningAction("followup");
    try {
      await api.post(`/leads/${id}/actions`, { organization_id: org.id, type: "CREATE_HUMAN_TASK" });
      invalidateAfterAction();
      showFeedback("success", "Follow-up task created.");
      setTab("outbound");
    } catch (err: unknown) {
      showFeedback("error", err instanceof Error ? err.message : "Failed to create follow-up");
    } finally {
      setRunningAction(null);
    }
  };

  if (isLoading) {
    return (
      <>
        <Header title="Lead" />
        <div className="p-6 space-y-4">
          <div className="h-32 bg-surface border border-line rounded-xl animate-pulse" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 h-64 bg-surface border border-line rounded-xl animate-pulse" />
            <div className="h-64 bg-surface border border-line rounded-xl animate-pulse" />
          </div>
        </div>
      </>
    );
  }

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
    !intel || intel.intelligence_status === "NOT_RUN" || intel.intelligence_status === "READY_TO_RUN"
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
        <div
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
                {intel && <IntelStatusBadge status={intel.intelligence_status} />}
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
                  disabled={!!runningAction}
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
                {messageMenuOpen && (
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
                disabled={!!runningAction}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-brand text-white rounded-lg hover:bg-brand-strong transition-colors cursor-pointer disabled:opacity-50"
              >
                {runningAction === "analyze" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Zap className="w-3.5 h-3.5" />
                )}
                {analyzeLabel}
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-line -mb-px">
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
                  "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-1.5",
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
        {tab === "intelligence" && (
          <IntelligenceTab
            leadId={lead.id}
            intel={intel}
            timeline={timeline || []}
            onReviewInOutbound={() => setTab("outbound")}
          />
        )}
        {tab === "outbound" && (
          <OutboundActivityTab
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
            <Brain className="w-4 h-4 text-brand" />
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
            <p className="text-sm text-muted">Not analyzed yet.</p>
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
}: {
  leadId: string;
  intel: ReturnType<typeof useLeadIntelligence>["data"];
  timeline: TimelineEntry[];
  onReviewInOutbound: () => void;
}) {
  const readiness = intel?.readiness;
  const synthesis = intel?.synthesis;
  const recommendation = intel?.recommendation;
  const nba = intel?.next_best_action;
  const evidence = intel?.snapshot?.evidence || [];
  const [historyOpen, setHistoryOpen] = useState(false);
  const { data: history } = useLeadIntelligenceHistory(leadId, historyOpen);
  const externalFindings = (synthesis?.findings || []).filter((f: SynthesisFinding) => f.source === "APPROVED_RESEARCH_EVIDENCE");
  const latestInbound = [...timeline]
    .filter((e) => e.kind === "message" && e.direction === "INBOUND")
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 space-y-5">
        {latestInbound && (
          <div className="bg-brand-light/40 border border-brand/20 rounded-xl p-4 flex items-start gap-3">
            <Radio className="w-4 h-4 text-brand shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs font-semibold text-brand uppercase tracking-wide">
                  Latest customer signal &middot; {formatLabel(latestInbound.channel || "")}
                </p>
                {latestInbound.classification_event_type && (
                  <ReplyClassificationBadge
                    eventType={latestInbound.classification_event_type}
                    confidence={latestInbound.classification_confidence ?? null}
                  />
                )}
              </div>
              <p className="text-sm text-ink mt-0.5">{latestInbound.message}</p>
              <p className="text-[11px] text-muted mt-0.5">{new Date(latestInbound.timestamp).toLocaleString()}</p>
              {latestInbound.suggested_next_step && (
                <p className="text-xs text-ink mt-2 pt-2 border-t border-brand/20">
                  <span className="font-semibold">Suggested next step: </span>
                  {latestInbound.suggested_next_step}
                </p>
              )}
            </div>
          </div>
        )}
        <Section icon={TrendingUp} title="Data Readiness">
          {readiness ? (
            <div className="flex items-start gap-5">
              <div className="relative w-16 h-16 shrink-0">
                <svg className="w-16 h-16 -rotate-90" viewBox="0 0 56 56">
                  <circle cx="28" cy="28" r="24" fill="none" stroke="#d9e1e7" strokeWidth="4" />
                  <circle
                    cx="28"
                    cy="28"
                    r="24"
                    fill="none"
                    stroke="#0f766e"
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
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
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
            <EmptySection message="No readiness assessment yet. Click “Analyze lead” above." />
          )}
        </Section>

        <Section icon={Info} title="Qualification Assessment">
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
                  ? "Not enough data yet to qualify this lead."
                  : "No qualification yet. Click “Analyze lead” above."
              }
            />
          )}
        </Section>

        {externalFindings.length > 0 && (
          <Section icon={FileText} title="External Research Findings">
            <div className="space-y-2">
              {externalFindings.map((f, i) => (
                <div key={i} className="flex gap-3 p-3 bg-page rounded-lg border border-line">
                  <ConfidenceDot confidence={f.confidence} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-muted uppercase tracking-wide">{formatLabel(f.field)}</p>
                    <p className="text-sm text-ink mt-0.5">{f.value}</p>
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
                <PriorityBadge label={recommendation.priority.label} score={recommendation.priority.score} />
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
                  ? "Analyze this lead to generate a recommendation."
                  : "No recommendation yet. Click “Analyze lead” above."
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
                  title={e.claim_value}
                >
                  {formatLabel(e.source_type)} &middot; {formatLabel(e.claim_field)}
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
                      <p className="text-[11px] text-muted mt-0.5 line-clamp-2">{snap.summary}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Outbound & Activity ----------

function OutboundActivityTab({
  actions,
  timeline,
  onScheduleFollowUp,
  runningAction,
}: {
  actions: LeadOutboundAction[];
  timeline: TimelineEntry[];
  onScheduleFollowUp: () => void;
  runningAction: string | null;
}) {
  const approve = useApproveAction();
  const reject = useRejectAction();
  const execute = useExecuteAction();
  const completeFollowUp = useCompleteFollowUp();
  const cancelFollowUp = useCancelFollowUp();
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const messages = timeline.filter((e) => e.kind === "message");
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
      <div className="lg:col-span-2 space-y-5">
        <Section icon={Send} title="Outbound Actions">
          {actions.length > 0 ? (
            <div className="space-y-2">
              {actions.map((a) => (
                <OutboundActionRow
                  key={a.id}
                  action={a}
                  busy={busyIds.has(a.id)}
                  onApprove={withBusy(a.id, () => approve.mutateAsync(a.id))}
                  onReject={withBusy(a.id, () => reject.mutateAsync(a.id))}
                  onExecute={withBusy(a.id, () => execute.mutateAsync(a.id))}
                />
              ))}
            </div>
          ) : (
            <EmptySection message="No outbound actions yet. Analyze this lead to get a recommendation, or send a message above." />
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
              disabled={!!runningAction}
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
  action,
  busy,
  onApprove,
  onReject,
  onExecute,
}: {
  action: LeadOutboundAction;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onExecute: () => void;
}) {
  const needsApproval = action.approval?.status === "PENDING";
  const canExecute = action.status === "APPROVED" || action.status === "PLANNED";

  return (
    <div className="flex items-center justify-between gap-3 p-3 bg-page rounded-lg border border-line flex-wrap">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <TypeBadge type={action.type} />
          <ActionStatusBadge status={action.status} />
        </div>
        <p className="text-xs text-muted mt-1">
          {formatLabel((action.payload?.title as string) || (action.payload?.reason as string) || action.type)}
        </p>
      </div>
      {busy ? (
        <Loader2 className="w-4 h-4 animate-spin text-brand shrink-0" />
      ) : (
        <div className="flex items-center gap-1 shrink-0">
          {needsApproval && (
            <>
              <button
                onClick={onApprove}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-ok bg-ok-light rounded-md hover:bg-green-200 transition-colors cursor-pointer"
              >
                <ThumbsUp className="w-3.5 h-3.5" />
                Approve
              </button>
              <button
                onClick={onReject}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-danger bg-danger-light rounded-md hover:bg-red-200 transition-colors cursor-pointer"
              >
                <ThumbsDown className="w-3.5 h-3.5" />
                Reject
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
              <p className="text-sm text-ink">{m.message}</p>
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

function IntelStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    NOT_RUN: { label: "Not analyzed", className: "bg-soft text-muted" },
    READY_TO_RUN: { label: "Ready to analyze", className: "bg-soft text-muted" },
    NEEDS_DATA: { label: "Needs data", className: "bg-warn-light text-warn" },
    GENERATED: { label: "Analyzed", className: "bg-ok-light text-ok" },
    FAILED: { label: "Analysis failed", className: "bg-danger-light text-danger" },
  };
  const entry = map[status] ?? { label: formatLabel(status), className: "bg-soft text-muted" };
  return <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", entry.className)}>{entry.label}</span>;
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

const REPLY_CLASSIFICATION_STYLES: Record<string, { label: string; icon: typeof ThumbsUp; className: string }> = {
  POSITIVE_REPLY: { label: "Positive", icon: ThumbsUp, className: "bg-ok-light text-ok" },
  NEGATIVE_REPLY: { label: "Negative", icon: ThumbsDown, className: "bg-danger-light text-danger" },
  QUESTION: { label: "Question", icon: HelpCircle, className: "bg-brand-light text-brand" },
  OPT_OUT: { label: "Opted out", icon: Ban, className: "bg-danger-light text-danger" },
  UNKNOWN: { label: "Unclear", icon: AlertCircle, className: "bg-warn-light text-warn" },
};

function ReplyClassificationBadge({
  eventType,
  confidence,
}: {
  eventType: string;
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
}) {
  const escalated = confidence === "LOW";
  const entry = REPLY_CLASSIFICATION_STYLES[eventType] ?? REPLY_CLASSIFICATION_STYLES.UNKNOWN;
  const Icon = escalated ? AlertCircle : entry.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap",
        escalated ? "bg-warn-light text-warn" : entry.className,
      )}
      title={confidence ? `${confidence.toLowerCase()} confidence` : undefined}
    >
      <Icon className="w-2.5 h-2.5" />
      {escalated ? "Needs review" : entry.label}
    </span>
  );
}

function ConfidenceDot({ confidence }: { confidence: string }) {
  const color = confidence === "HIGH" ? "bg-green-500" : confidence === "MEDIUM" ? "bg-amber-500" : "bg-red-400";
  return <div className={cn("w-2.5 h-2.5 rounded-full shrink-0 mt-1", color)} title={confidence} />;
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
    SEND_EMAIL: "bg-blue-50 text-blue-700",
    SEND_WHATSAPP: "bg-green-50 text-green-700",
    SEND_SMS: "bg-cyan-50 text-cyan-700",
    SEND_VOICE_CALL: "bg-orange-50 text-orange-700",
    CREATE_HUMAN_TASK: "bg-purple-50 text-purple-700",
    UPDATE_CRM: "bg-amber-50 text-amber-700",
    RUN_RESEARCH: "bg-cyan-50 text-cyan-700",
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
