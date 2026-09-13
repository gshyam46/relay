import { useState, useMemo, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import {
  Send,
  Building2,
  Search,
  CheckCircle2,
  Clock,
  XCircle,
  Shield,
  Mail,
  MessageCircle,
  ClipboardList,
  Phone,
  Loader2,
  Play,
  ThumbsUp,
  ThumbsDown,
  CalendarClock,
  Inbox,
  AlertTriangle,
  Download,
  ChevronRight,
} from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { ApprovalReviewDialog } from "@/components/approval-review-dialog";
import { DispatchDetailsButton, DispatchOutcome } from "@/components/dispatch-recovery-dialog";
import { Header } from "@/components/layout/header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { useWorkspaceStore } from "@/stores/workspace";
import {
  useOutboundSummary,
  useExecuteAction,
  useBulkExecuteActions,
  type OutboundAction,
} from "@/hooks/use-outbound";
import { useFollowUpSummary, useCompleteFollowUp, useCancelFollowUp, type FollowUp } from "@/hooks/use-follow-ups";
import { useChannelMessages, type ChannelMessage } from "@/hooks/use-channels";
import { useTestControlsEnabled } from "@/hooks/use-auth";
import { downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

const CHART_COLORS = ["#0f766e", "#0ea5e9", "#8b5cf6", "#f59e0b", "#ef4444", "#10b981"];

type Tab = "IN_PROGRESS" | "RECOVERY" | "READY" | "APPROVED" | "SCHEDULED" | "SENT" | "REPLIES" | "FOLLOW_UPS" | "FAILED";

const TABS: { key: Tab; label: string }[] = [
  { key: "READY", label: "Ready for review" },
  { key: "APPROVED", label: "Approved" },
  { key: "IN_PROGRESS", label: "Sending & accepted" },
  { key: "RECOVERY", label: "Needs attention" },
  { key: "SCHEDULED", label: "Scheduled" },
  { key: "SENT", label: "Sent" },
  { key: "REPLIES", label: "Replies" },
  { key: "FOLLOW_UPS", label: "Follow-ups" },
  { key: "FAILED", label: "Failed" },
];

export function OutboundPage() {
  const org = useWorkspaceStore((s) => s.currentOrg);

  if (!org) {
    return (
      <>
        <Header title="Outbound" />
        <EmptyState
          icon={Building2}
          title="No workspace selected"
          description="Select or create a workspace first."
        />
      </>
    );
  }

  return <OutboundWithOrg />;
}

function OutboundWithOrg() {
  const org = useWorkspaceStore((s) => s.currentOrg)!;
  const testControlsEnabled = useTestControlsEnabled();
  const { data, isLoading, isError, refetch } = useOutboundSummary();
  const { data: followUpData } = useFollowUpSummary();
  const { data: replies } = useChannelMessages({ direction: "INBOUND" });
  const execute = useExecuteAction();
  const bulkExecute = useBulkExecuteActions();
  const completeFollowUp = useCompleteFollowUp();
  const cancelFollowUp = useCancelFollowUp();
  const [tab, setTab] = useState<Tab>("READY");
  const [search, setSearch] = useState("");
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Expanded rows show draft context. The review dialog loads the exact current revision.
  const [reviewIds, setReviewIds] = useState<string[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const navigate = useNavigate();

  const actions = data?.actions || [];
  const followUps = followUpData?.follow_ups || [];

  const filteredActions = useMemo(() => {
    let rows = actions;
    if (tab === "READY") rows = rows.filter((r) => ["PLANNED", "AWAITING_APPROVAL"].includes(r.status));
    else if (tab === "APPROVED") rows = rows.filter((r) => ["APPROVED", "RETRYING"].includes(r.status));
    else if (tab === "IN_PROGRESS") rows = rows.filter((r) => r.status === "EXECUTING");
    else if (tab === "RECOVERY") rows = rows.filter((r) => !!r.execution_hold_reason || r.execution_outcome === "UNCERTAIN");
    else if (tab === "SENT") rows = rows.filter((r) => r.status === "COMPLETED");
    else if (tab === "FAILED") rows = rows.filter((r) => r.status === "FAILED" || r.status === "BLOCKED");
    else return [];
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) => r.lead_name?.toLowerCase().includes(q) || r.lead_email?.toLowerCase().includes(q) || r.lead_company?.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [actions, tab, search]);

  const filteredFollowUps = useMemo(() => {
    if (tab === "SCHEDULED") return followUps.filter((f) => f.status === "PLANNED");
    if (tab === "FOLLOW_UPS") return followUps.filter((f) => f.status === "DUE");
    return [];
  }, [followUps, tab]);

  const filteredReplies = useMemo(() => {
    if (tab !== "REPLIES") return [];
    if (!search) return replies || [];
    const q = search.toLowerCase();
    return (replies || []).filter((m) => m.lead_name?.toLowerCase().includes(q));
  }, [replies, tab, search]);

  const totals = data?.totals;
  const readyCount = actions.filter((a) => ["PLANNED", "AWAITING_APPROVAL"].includes(a.status)).length;
  const scheduledCount = followUps.filter((f) => f.status === "PLANNED").length;
  const dueCount = followUps.filter((f) => f.status === "DUE").length;
  const repliesCount = replies?.length || 0;

  const countFor = (key: Tab) => {
    if (key === "READY") return readyCount;
    if (key === "APPROVED") return actions.filter((a) => ["APPROVED", "RETRYING"].includes(a.status)).length;
    if (key === "SCHEDULED") return scheduledCount;
    if (key === "IN_PROGRESS") return actions.filter((a) => a.status === "EXECUTING").length;
    if (key === "RECOVERY") return actions.filter((a) => !!a.execution_hold_reason || a.execution_outcome === "UNCERTAIN").length;
    if (key === "SENT") return actions.filter((a) => a.status === "COMPLETED").length;
    if (key === "REPLIES") return repliesCount;
    if (key === "FOLLOW_UPS") return dueCount;
    if (key === "FAILED") return actions.filter((a) => a.status === "FAILED" || a.status === "BLOCKED").length;
    return 0;
  };

  const withBusy = (actionId: string, fn: () => Promise<unknown>) => async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusyIds((prev) => new Set(prev).add(actionId));
    try {
      await fn();
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(actionId);
        return next;
      });
    }
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVisibleSelected = filteredActions.length > 0 && filteredActions.every((a) => selected.has(a.action_id));

  const toggleSelectAll = () => {
    setSelected(allVisibleSelected ? new Set() : new Set(filteredActions.map((a) => a.action_id)));
  };

  // Backend bulk endpoints cap at 100 ids per request, so chunk larger batches.
  const runInChunks = async (ids: string[], mutateAsync: (chunk: string[]) => Promise<unknown>) => {
    for (let i = 0; i < ids.length; i += 100) {
      await mutateAsync(ids.slice(i, i + 100));
    }
  };

  const handleBulkReject = () => {
    if (selected.size > 0 && !bulkBusy) setReviewIds(Array.from(selected));
  };

  const handleApproveAllReady = () => {
    const ids = selected.size > 0 ? Array.from(selected) : filteredActions.map((a) => a.action_id);
    if (ids.length > 0 && !bulkBusy) setReviewIds(ids);
  };

  const handleExecuteAllApproved = async () => {
    const ids = selected.size > 0 ? Array.from(selected) : filteredActions.map((a) => a.action_id);
    if (ids.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      await runInChunks(ids, (chunk) => bulkExecute.mutateAsync(chunk));
      setSelected(new Set());
    } finally {
      setBulkBusy(false);
    }
  };

  const typeBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of actions) counts.set(a.type, (counts.get(a.type) || 0) + 1);
    return Array.from(counts.entries()).map(([type, count]) => ({ name: formatLabel(type), value: count }));
  }, [actions]);

  return (
    <>
      {reviewIds && <ApprovalReviewDialog actionIds={reviewIds} onClose={() => { setReviewIds(null); setSelected(new Set()); }} />}
      <Header title="Outbound" description={org.name} actions={<ExportCsvButton actions={actions} />} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Summary Row */}
        {totals && (
          <div className="px-6 py-4 border-b border-line bg-surface flex items-start gap-6 flex-wrap">
            {/* A grid rather than flex-wrap: eight tiles wrapping freely produced
                ragged rows with a gap at the end. A grid keeps them aligned in
                columns at every width. */}
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3 flex-1 min-w-[280px]">
              <SummaryCard label="Total actions" value={totals.total} />
              <SummaryCard label="Ready for review" value={readyCount} color="text-warn" highlight={readyCount > 0} />
              <SummaryCard label="Approved" value={actions.filter((a) => ["APPROVED", "RETRYING"].includes(a.status)).length} />
              <SummaryCard label="Scheduled" value={scheduledCount} icon={CalendarClock} />
              <SummaryCard label="Sent" value={actions.filter((a) => a.status === "COMPLETED").length} color="text-ok" />
              <SummaryCard label="Replies" value={repliesCount} icon={Inbox} />
              <SummaryCard label="Follow-ups due" value={dueCount} color={dueCount > 0 ? "text-warn" : undefined} icon={AlertTriangle} />
              <SummaryCard
                label="Failed"
                value={actions.filter((a) => a.status === "FAILED" || a.status === "BLOCKED").length}
                color="text-danger"
              />
            </div>
            {typeBreakdown.length > 0 && (
              <div className="flex items-center gap-3 shrink-0">
                <ResponsiveContainer width={72} height={72}>
                  <PieChart>
                    <Pie data={typeBreakdown} cx="50%" cy="50%" innerRadius={20} outerRadius={34} paddingAngle={2} dataKey="value" stroke="none">
                      {typeBreakdown.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #d9e1e7" }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-0.5">
                  <p className="text-[10px] font-semibold text-muted uppercase tracking-wide mb-1">By channel</p>
                  {typeBreakdown.map((t, i) => (
                    <div key={t.name} className="flex items-center gap-1.5 text-[11px]">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span className="text-muted">{t.name}</span>
                      <span className="font-semibold text-ink">{t.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="px-6 py-3 border-b border-line bg-surface flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setTab(t.key);
                  setSelected(new Set());
                }}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded-full transition-colors cursor-pointer whitespace-nowrap",
                  tab === t.key ? "bg-brand text-white" : "bg-soft text-muted hover:text-ink",
                )}
              >
                {t.label} {countFor(t.key) > 0 && `(${countFor(t.key)})`}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-xs ml-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by lead..."
              className="w-full pl-9 pr-4 py-2 text-sm border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
          </div>
        </div>

        {(tab === "READY" || tab === "APPROVED") && filteredActions.length > 0 && (
          <div className="px-6 py-2.5 border-b border-line bg-brand-light/40 flex items-center gap-3">
            <span className="text-xs font-medium text-ink">
              {selected.size > 0 ? `${selected.size} selected` : `${filteredActions.length} in this view`}
            </span>
            {tab === "READY" && (
              <>
                <button
                  onClick={handleApproveAllReady}
                  disabled={bulkBusy}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-white bg-brand rounded-md hover:bg-brand-strong transition-colors cursor-pointer disabled:opacity-50"
                >
                  {bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ThumbsUp className="w-3.5 h-3.5" />}
                  {selected.size > 0 ? "Review selected" : `Review queue (${filteredActions.length})`}
                </button>
                {selected.size > 0 && (
                  <button
                    onClick={handleBulkReject}
                    disabled={bulkBusy}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-danger bg-danger-light rounded-md hover:bg-red-200 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ThumbsDown className="w-3.5 h-3.5" />}
                    Review to reject
                  </button>
                )}
              </>
            )}
            {tab === "APPROVED" && (
              <button
                onClick={handleExecuteAllApproved}
                disabled={bulkBusy}
                className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-white bg-brand rounded-md hover:bg-brand-strong transition-colors cursor-pointer disabled:opacity-50"
              >
                {bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                {selected.size > 0 ? "Send selected now" : `Send all now (${filteredActions.length})`}
              </button>
            )}
            {selected.size > 0 && (
              <button
                onClick={() => setSelected(new Set())}
                className="text-xs text-muted hover:text-ink transition-colors cursor-pointer ml-auto"
              >
                Clear selection
              </button>
            )}
          </div>
        )}

        {/* Content */}
        {isError ? (
          <ErrorState title="Couldn't load outbound activity" onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-6 space-y-2 flex-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 bg-surface border border-line rounded-lg animate-pulse" />
            ))}
          </div>
        ) : tab === "SCHEDULED" || tab === "FOLLOW_UPS" ? (
          filteredFollowUps.length > 0 ? (
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-soft border-b border-line">
                    <th className="py-2.5 px-4 pl-6 text-[11px] font-semibold text-muted uppercase tracking-wider">Lead</th>
                    <th className="py-2.5 px-4 text-[11px] font-semibold text-muted uppercase tracking-wider">Reason</th>
                    <th className="py-2.5 px-4 text-[11px] font-semibold text-muted uppercase tracking-wider">Due</th>
                    <th className="py-2.5 px-4 text-[11px] font-semibold text-muted uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filteredFollowUps.map((f) => (
                    <FollowUpRow
                      key={f.id}
                      followUp={f}
                      onClick={() => navigate(`/leads/${f.lead_id}?tab=outbound`)}
                      onComplete={(e) => {
                        e.stopPropagation();
                        completeFollowUp.mutate(f.id);
                      }}
                      onCancel={(e) => {
                        e.stopPropagation();
                        cancelFollowUp.mutate(f.id);
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={CalendarClock} title="Nothing here" description="Follow-ups will appear once outbound actions or replies create them." />
          )
        ) : tab === "REPLIES" ? (
          filteredReplies.length > 0 ? (
            <div className="flex-1 overflow-y-auto divide-y divide-line">
              {filteredReplies.map((m) => (
                <ReplyRow key={m.id} message={m} onClick={() => navigate(`/leads/${m.lead_id}?tab=outbound`)} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Inbox}
              title="No replies yet"
              description={testControlsEnabled
                ? "Inbound replies from leads will appear here. Use Conversations to simulate a reply in the local sandbox."
                : "Inbound replies from leads will appear here."}
            />
          )
        ) : filteredActions.length > 0 ? (
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-left">
              <thead className="sticky top-0 z-10">
                <tr className="bg-soft border-b border-line">
                  {(tab === "READY" || tab === "APPROVED") && (
                    <th className="w-10 pl-6">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAll}
                        title={allVisibleSelected ? "Deselect all" : "Select all"}
                        className="cursor-pointer"
                      />
                    </th>
                  )}
                  <th className="py-2.5 px-4 pl-6 text-[11px] font-semibold text-muted uppercase tracking-wider">Lead</th>
                  <th className="py-2.5 px-4 text-[11px] font-semibold text-muted uppercase tracking-wider">Type</th>
                  <th className="py-2.5 px-4 text-[11px] font-semibold text-muted uppercase tracking-wider">Status</th>
                  <th className="py-2.5 px-4 text-[11px] font-semibold text-muted uppercase tracking-wider">Approval</th>
                  <th className="py-2.5 px-4 text-[11px] font-semibold text-muted uppercase tracking-wider">Created</th>
                  <th className="py-2.5 px-4 text-[11px] font-semibold text-muted uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredActions.map((action) => {
                  const expanded = expandedId === action.action_id;
                  const columnCount = tab === "READY" || tab === "APPROVED" ? 7 : 6;
                  return (
                    <Fragment key={action.action_id}>
                      <ActionRow
                        action={action}
                        busy={busyIds.has(action.action_id)}
                        showCheckbox={tab === "READY" || tab === "APPROVED"}
                        checked={selected.has(action.action_id)}
                        expanded={expanded}
                        onToggle={() => toggleSelected(action.action_id)}
                        onApprove={(event) => { event.stopPropagation(); setReviewIds([action.action_id]); }}
                        onReject={(event) => { event.stopPropagation(); setReviewIds([action.action_id]); }}
                        onExecute={withBusy(action.action_id, () => execute.mutateAsync(action.action_id))}
                        onClick={() => setExpandedId(expanded ? null : action.action_id)}
                      />
                      {expanded && (
                        <tr className="bg-soft/60">
                          <td colSpan={columnCount} className="px-6 py-4">
                            <MessagePreview
                              action={action}
                              onOpenLead={() => navigate(`/leads/${action.lead_id}?tab=outbound`)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={Send}
            title="No actions found"
            description={
              search
                ? "Try a different search term."
                : "Actions appear here once a lead is analyzed and a recommendation is approved."
            }
          />
        )}
      </div>
    </>
  );
}

function FollowUpRow({
  followUp,
  onClick,
  onComplete,
  onCancel,
}: {
  followUp: FollowUp;
  onClick: () => void;
  onComplete: (e: React.MouseEvent) => void;
  onCancel: (e: React.MouseEvent) => void;
}) {
  return (
    <tr onClick={onClick} className="hover:bg-soft transition-colors cursor-pointer">
      <td className="py-3 px-4 pl-6">
        <p className="text-sm font-medium text-ink truncate max-w-[180px]">{followUp.lead_name || "Unnamed"}</p>
        {followUp.lead_company && <p className="text-[11px] text-muted truncate max-w-[180px]">{followUp.lead_company}</p>}
      </td>
      <td className="py-3 px-4 text-sm text-ink max-w-[280px]">
        <div className="flex items-center gap-1.5">
          {!!followUp.escalated && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-danger-light text-danger shrink-0">
              <AlertTriangle className="w-2.5 h-2.5" />
              Escalated
            </span>
          )}
          <span className="truncate">{followUp.reason}</span>
        </div>
      </td>
      <td className="py-3 px-4 text-xs text-muted">{followUp.due_at && Number.isFinite(Date.parse(followUp.due_at)) ? formatDate(followUp.due_at) : "Schedule needs review"}</td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-1">
          <button
            onClick={onComplete}
            title="Mark complete"
            className="p-1.5 rounded-md bg-ok-light text-ok hover:bg-green-200 transition-colors cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onCancel}
            title="Cancel"
            className="p-1.5 rounded-md bg-danger-light text-danger hover:bg-red-200 transition-colors cursor-pointer"
          >
            <XCircle className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function ReplyRow({ message, onClick }: { message: ChannelMessage; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-start gap-3 w-full px-6 py-3 text-left hover:bg-soft transition-colors cursor-pointer">
      <div className="w-8 h-8 rounded-full bg-brand-light text-brand flex items-center justify-center text-xs font-bold shrink-0">
        {(message.lead_name?.[0] ?? "?").toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-ink">{message.lead_name || "Unnamed"}</p>
          <TypeBadge type={`SEND_${message.channel}`} />
        </div>
        <p className="text-sm text-muted mt-0.5 truncate">{message.body || message.summary}</p>
      </div>
      <span className="text-xs text-muted shrink-0">{formatDate(message.occurred_at)}</span>
    </button>
  );
}

function ActionRow({
  action,
  busy,
  showCheckbox,
  checked,
  expanded,
  onToggle,
  onApprove,
  onReject,
  onExecute,
  onClick,
}: {
  action: OutboundAction;
  busy: boolean;
  showCheckbox: boolean;
  checked: boolean;
  expanded: boolean;
  onToggle: () => void;
  onApprove: (e: React.MouseEvent) => void;
  onReject: (e: React.MouseEvent) => void;
  onExecute: (e: React.MouseEvent) => void;
  onClick: () => void;
}) {
  const needsApproval = action.status === "AWAITING_APPROVAL" || (action.status === "PLANNED" && action.type.startsWith("SEND_"));
  const canReview = ["PLANNED", "AWAITING_APPROVAL", "APPROVED", "RETRYING"].includes(action.status);
  const dueDates = [action.scheduled_at, action.next_attempt_at].filter((value): value is string => !!value);
  const invalidDue = dueDates.some((value) => !Number.isFinite(Date.parse(value)));
  const earliestAttempt = dueDates.length && !invalidDue ? new Date(Math.max(...dueDates.map(Date.parse))).toISOString() : null;
  const canExecute = !action.execution_hold_reason && !invalidDue && (!earliestAttempt || Date.parse(earliestAttempt) <= Date.now())
    && (["APPROVED", "RETRYING"].includes(action.status) || (action.status === "PLANNED" && !action.type.startsWith("SEND_")));

  return (
    <tr
      onClick={onClick}
      title={expanded ? "Hide draft context" : "Show draft context"}
      className={cn("hover:bg-soft transition-colors cursor-pointer group", expanded && "bg-soft/60")}
    >
      {showCheckbox && (
        <td className="py-3 pl-6" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={checked} onChange={onToggle} className="cursor-pointer" />
        </td>
      )}
      <td className="py-3 px-4 pl-6">
        <div className="flex items-center gap-3">
          <ChevronRight
            className={cn("w-3.5 h-3.5 text-muted shrink-0 transition-transform", expanded && "rotate-90")}
            aria-hidden
          />
          <div className="w-8 h-8 rounded-full bg-brand-light text-brand flex items-center justify-center text-xs font-bold shrink-0">
            {(action.lead_name?.[0] ?? "?").toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink truncate max-w-[160px]">{action.lead_name || "Unnamed"}</p>
            {action.lead_company && <p className="text-[11px] text-muted truncate max-w-[160px]">{action.lead_company}</p>}
          </div>
        </div>
      </td>
      <td className="py-3 px-4"><TypeBadge type={action.type} /></td>
      <td className="py-3 px-4"><ActionStatusBadge status={action.status} /><DispatchOutcome outcome={action.execution_outcome} />
        {earliestAttempt && <p className="mt-1 text-xs text-muted">Earliest attempt: {formatDate(earliestAttempt)}</p>}
      </td>
      <td className="py-3 px-4"><ApprovalCell action={action} /></td>
      <td className="py-3 px-4">
        <span className="text-xs text-muted">{formatDate(action.created_at)}</span>
      </td>
      <td className="py-3 px-4">
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin text-brand" />
        ) : (
          <div className="flex items-center gap-1">
            <DispatchDetailsButton actionId={action.action_id} />
            {canReview && (
              <>
                <button
                  onClick={onApprove}
                  title="Review exact message"
                  className="p-1.5 rounded-md bg-ok-light text-ok hover:bg-green-200 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-1 text-xs"><ThumbsUp className="w-3.5 h-3.5" />Review</span>
                </button>
                <button
                  onClick={onReject}
                  title="Open review before rejecting"
                  className="p-1.5 rounded-md bg-danger-light text-danger hover:bg-red-200 transition-colors cursor-pointer"
                >
                  <ThumbsDown className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            {canExecute && !needsApproval && (
              <button
                onClick={onExecute}
                title="Execute"
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-brand bg-brand-light rounded-md hover:bg-brand-muted transition-colors cursor-pointer"
              >
                <Play className="w-3 h-3" />
                Execute
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

/**
 * Draft context only. The review dialog loads the exact revision used for approval.
 *
 * The subject and message come from the action's payload, which is composed
 * server-side from the lead's own record. `rationale` is shown separately and
 * labelled as internal, because it is the reasoning behind the action rather
 * than anything the lead sees — conflating the two is what made the sandbox
 * conversation thread read like an audit log.
 */
function MessagePreview({ action, onOpenLead }: { action: OutboundAction; onOpenLead: () => void }) {
  const payload = (action.payload ?? {}) as Record<string, unknown>;
  const asText = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

  const subject = asText(payload.subject);
  const message = asText(payload.message);
  const rationale = asText(payload.rationale) ?? asText(payload.title);
  const isMessageChannel = action.type.startsWith("SEND_");
  const evidenceCount = Array.isArray(payload.evidence_refs) ? payload.evidence_refs.length : 0;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Original draft context. Open Review to see the exact recipient, sender and current message revision.</p>
      {isMessageChannel ? (
        message ? (
          <div className="rounded-lg border border-line bg-surface overflow-hidden">
            <div className="px-4 py-2 border-b border-line bg-soft/60 flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">To</span>
              <span className="text-xs text-ink">{action.lead_email || action.lead_name || "the lead"}</span>
              {subject && (
                <>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted ml-2">Subject</span>
                  <span className="text-xs font-medium text-ink">{subject}</span>
                </>
              )}
            </div>
            <p className="px-4 py-3 text-sm text-ink whitespace-pre-wrap leading-relaxed">{message}</p>
          </div>
        ) : (
          <p className="text-xs text-warn">
            No message content is attached to this action yet, so there is nothing to review. Re-analyze the lead to
            regenerate it.
          </p>
        )
      ) : (
        <div className="rounded-lg border border-line bg-surface px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">Internal task</p>
          <p className="text-sm text-ink">{asText(payload.message) ?? rationale ?? "No details."}</p>
        </div>
      )}

      {rationale && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
            Why this was recommended {evidenceCount > 0 && `· ${evidenceCount} evidence item${evidenceCount === 1 ? "" : "s"}`}
          </p>
          <p className="text-xs text-muted leading-relaxed">{rationale}</p>
        </div>
      )}

      <button
        onClick={(e) => {
          e.stopPropagation();
          onOpenLead();
        }}
        className="text-xs font-medium text-brand hover:underline cursor-pointer"
      >
        Open full lead record →
      </button>
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const Icon = typeIcon(type);
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
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap", styles[type] ?? "bg-soft text-muted")}>
      <Icon className="w-3 h-3" />
      {formatLabel(type)}
    </span>
  );
}

function ActionStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    PLANNED: { label: "Planned", className: "bg-soft text-muted" },
    AWAITING_APPROVAL: { label: "Awaiting", className: "bg-warn-light text-warn" },
    APPROVED: { label: "Approved", className: "bg-ok-light text-ok" },
    EXECUTING: { label: "Executing", className: "bg-brand-light text-brand" },
    COMPLETED: { label: "Completed", className: "bg-ok-light text-ok" },
    RETRYING: { label: "Retrying", className: "bg-warn-light text-warn" },
    FAILED: { label: "Failed", className: "bg-danger-light text-danger" },
    BLOCKED: { label: "Blocked", className: "bg-danger-light text-danger" },
  };
  const entry = map[status] ?? { label: status, className: "bg-soft text-muted" };
  return (
    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap", entry.className)}>
      {entry.label}
    </span>
  );
}

function ApprovalCell({ action }: { action: OutboundAction }) {
  if (action.approval_requirement === "NOT_REQUIRED" && !action.type.startsWith("SEND_")) {
    return <span className="text-xs text-muted">N/A</span>;
  }
  if (!action.approval) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted">
        <Shield className="w-3 h-3" />
        Required
      </span>
    );
  }
  const ap = action.approval;
  if (ap.status === "PENDING") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-warn-light text-warn">
        <Clock className="w-3 h-3" />
        Pending
      </span>
    );
  }
  if (ap.status === "APPROVED") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-ok-light text-ok">
        <CheckCircle2 className="w-3 h-3" />
        Approved
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-danger-light text-danger">
      <XCircle className="w-3 h-3" />
      Rejected
    </span>
  );
}

function ExportCsvButton({ actions }: { actions: OutboundAction[] }) {
  const handleExport = () => {
    downloadCsv(
      `outbound-activity-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Lead", "Email", "Company", "Channel/Type", "Status", "Approval", "Intent/Reason", "Created", "Updated"],
      actions.map((a) => [
        a.lead_name || "",
        a.lead_email || "",
        a.lead_company || "",
        formatLabel(a.type),
        formatLabel(a.status),
        a.approval?.status ? formatLabel(a.approval.status) : a.approval_requirement === "NOT_REQUIRED" ? "Not required" : "—",
        String((a.payload?.rationale as string) || (a.payload?.reason as string) || (a.payload?.title as string) || ""),
        a.created_at,
        a.updated_at,
      ]),
    );
  };

  return (
    <button
      onClick={handleExport}
      disabled={actions.length === 0}
      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-line rounded-lg hover:bg-soft transition-colors cursor-pointer disabled:opacity-50"
    >
      <Download className="w-3.5 h-3.5" />
      Export CSV
    </button>
  );
}

function SummaryCard({
  label,
  value,
  color,
  highlight,
  icon: Icon,
}: {
  label: string;
  value: number;
  color?: string;
  highlight?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className={cn("border rounded-lg px-3 py-2.5", highlight ? "border-warn bg-warn-light" : "border-line bg-page")}>
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className={cn("w-3.5 h-3.5", color ?? "text-muted")} />}
        <p className={cn("text-lg font-bold", color ?? "text-ink")}>{value}</p>
      </div>
      <p className="text-[10px] text-muted uppercase tracking-wide">{label}</p>
    </div>
  );
}

function typeIcon(type: string) {
  const map: Record<string, typeof Mail> = {
    SEND_EMAIL: Mail,
    SEND_WHATSAPP: MessageCircle,
    SEND_SMS: MessageCircle,
    SEND_VOICE_CALL: Phone,
    CREATE_HUMAN_TASK: ClipboardList,
    RUN_RESEARCH: Search,
  };
  return map[type] ?? Send;
}

function formatLabel(s: string) {
  return s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
