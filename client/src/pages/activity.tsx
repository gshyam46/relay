import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  Building2,
  Clock,
  CalendarClock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronRight,
  Loader2,
  Ban,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { useWorkspaceStore } from "@/stores/workspace";
import { useActivityFeed, type ActivityEvent } from "@/hooks/use-activity";
import {
  useFollowUpSummary,
  useCompleteFollowUp,
  useCancelFollowUp,
  type FollowUp,
} from "@/hooks/use-follow-ups";
import { cn } from "@/lib/utils";
import { useMe } from "@/hooks/use-auth";

type Tab = "follow-ups" | "activity";

export function ActivityPage() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  const [tab, setTab] = useState<Tab>("follow-ups");

  if (!org) {
    return (
      <>
        <Header title="Activity" />
        <EmptyState
          icon={Building2}
          title="No workspace selected"
          description="Select or create a workspace first."
        />
      </>
    );
  }

  return (
    <>
      <Header title="Activity" description={org.name} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tab Bar */}
        <div className="px-6 pt-3 border-b border-line bg-surface flex gap-4">
          <TabButton
            active={tab === "follow-ups"}
            onClick={() => setTab("follow-ups")}
          >
            <CalendarClock className="w-3.5 h-3.5" />
            Follow-ups
          </TabButton>
          <TabButton
            active={tab === "activity"}
            onClick={() => setTab("activity")}
          >
            <Activity className="w-3.5 h-3.5" />
            Audit Log
          </TabButton>
        </div>

        {tab === "follow-ups" ? <FollowUpsPanel /> : <ActivityFeedPanel />}
      </div>
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      role="link"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === "Enter") onClick();
      }}
      className={cn(
        "flex items-center gap-1.5 px-1 pb-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer",
        active
          ? "border-brand text-brand"
          : "border-transparent text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function FollowUpsPanel() {
  const { data, isLoading, isError, refetch } = useFollowUpSummary();
  const { data: session } = useMe();
  const canManage = session?.user.role === "OWNER";
  const [mutationError, setMutationError] = useState<string | null>(null);
  const completeFu = useCompleteFollowUp();
  const cancelFu = useCancelFollowUp();
  const navigate = useNavigate();
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const followUps = data?.follow_ups ?? [];
  const totals = data?.totals;

  const withBusy = (id: string, fn: () => Promise<unknown>) => async (e: React.MouseEvent) => {
    e.stopPropagation();
    setMutationError(null);
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await fn();
    } catch {
      setMutationError("The follow-up could not be updated. Refresh its current state and try again.");
      void refetch();
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {mutationError && <p role="alert" className="px-6 py-3 text-sm text-danger">{mutationError}</p>}
      {/* Summary */}
      {totals && totals.total > 0 && (
        <div className="flex flex-wrap gap-3 px-6 py-4 border-b border-line bg-surface">
          <FollowUpStatCard label="Total" value={totals.total} />
          <FollowUpStatCard
            label="Needs review"
            value={totals.by_status["BLOCKED"] ?? 0}
            color="text-danger"
            highlight={(totals.by_status["BLOCKED"] ?? 0) > 0}
          />
          <FollowUpStatCard
            label="Due"
            value={totals.by_status["DUE"] ?? 0}
            color="text-warn"
            highlight={(totals.by_status["DUE"] ?? 0) > 0}
          />
          <FollowUpStatCard
            label="Scheduled"
            value={totals.by_status["PLANNED"] ?? 0}
          />
          <FollowUpStatCard
            label="Completed"
            value={totals.by_status["COMPLETED"] ?? 0}
            color="text-ok"
          />
          <FollowUpStatCard
            label="Cancelled"
            value={totals.by_status["CANCELLED"] ?? 0}
          />
        </div>
      )}

      {/* List */}
      {isError ? (
        <ErrorState title="Couldn't load follow-ups" onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="p-6 space-y-2 flex-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-16 bg-surface border border-line rounded-lg animate-pulse"
            />
          ))}
        </div>
      ) : followUps.length > 0 ? (
        <div className="flex-1 overflow-y-auto">
          <div className="divide-y divide-line">
            {followUps.map((fu) => (
              <FollowUpRow
                key={fu.id}
                followUp={fu}
                busy={busyIds.has(fu.id)}
                canManage={canManage}
                onComplete={withBusy(fu.id, () => completeFu.mutateAsync(fu.id))}
                onCancel={withBusy(fu.id, () => cancelFu.mutateAsync(fu.id))}
                onClick={() => navigate(`/leads/${fu.lead_id}`)}
              />
            ))}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={CalendarClock}
          title="No follow-ups"
          description="Follow-ups appear here when actions trigger them."
        />
      )}
    </div>
  );
}

function FollowUpRow({
  followUp,
  busy,
  canManage,
  onComplete,
  onCancel,
  onClick,
}: {
  followUp: FollowUp;
  busy: boolean;
  canManage: boolean;
  onComplete: (e: React.MouseEvent) => void;
  onCancel: (e: React.MouseEvent) => void;
  onClick: () => void;
}) {
  const isUrgent = followUp.status === "DUE";
  const canComplete = canManage && ["PLANNED", "DUE"].includes(followUp.status);
  const canCancel = canManage && ["PLANNED", "DUE", "BLOCKED"].includes(followUp.status);
  const hasDueTime = followUp.due_at !== null && Number.isFinite(Date.parse(followUp.due_at));

  return (
    <div
      onClick={onClick}
      role="link"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === "Enter") onClick();
      }}
      className={cn(
        "flex items-center gap-4 px-6 py-3.5 hover:bg-soft transition-colors cursor-pointer group",
        isUrgent && "bg-warn-light/30",
      )}
    >
      <FollowUpStatusIcon status={followUp.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-ink truncate">
            {followUp.lead_name || "Unnamed lead"}
          </p>
          <FollowUpStatusBadge status={followUp.status} />
        </div>
        <p className="text-xs text-muted mt-0.5 truncate">{followUp.reason}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs text-muted">
          {hasDueTime ? "Due " : "Schedule needs review"}
          {hasDueTime && new Date(followUp.due_at!).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
        {followUp.lead_company && (
          <p className="text-[11px] text-muted">{followUp.lead_company}</p>
        )}
      </div>
      {/* Action buttons */}
      {busy ? (
        <Loader2 className="w-4 h-4 animate-spin text-brand shrink-0" />
      ) : canCancel ? (
        <div className="flex items-center gap-1 shrink-0">
          {canComplete && <button
            aria-label="Mark follow-up complete"
            onClick={onComplete}
            title="Mark complete"
            className="p-1.5 rounded-md bg-ok-light text-ok hover:bg-green-200 transition-colors cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
          </button>}
          <button
            aria-label="Cancel follow-up"
            onClick={onCancel}
            title="Cancel"
            className="p-1.5 rounded-md bg-soft text-muted hover:bg-line transition-colors cursor-pointer"
          >
            <Ban className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <ChevronRight className="w-4 h-4 text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      )}
    </div>
  );
}

function FollowUpStatusIcon({ status }: { status: string }) {
  const map: Record<
    string,
    { icon: typeof Clock; className: string }
  > = {
    BLOCKED: { icon: AlertTriangle, className: "text-danger" },
    DUE: { icon: Clock, className: "text-warn" },
    PLANNED: { icon: CalendarClock, className: "text-brand" },
    COMPLETED: { icon: CheckCircle2, className: "text-ok" },
    CANCELLED: { icon: XCircle, className: "text-muted" },
  };
  const entry = map[status] ?? { icon: Clock, className: "text-muted" };
  const Icon = entry.icon;
  return (
    <div
      className={cn(
        "w-9 h-9 rounded-full flex items-center justify-center shrink-0",
        status === "BLOCKED" && "bg-danger-light",
        status === "DUE" && "bg-warn-light",
        status === "PLANNED" && "bg-brand-light",
        status === "COMPLETED" && "bg-ok-light",
        status === "CANCELLED" && "bg-soft",
      )}
    >
      <Icon className={cn("w-4 h-4", entry.className)} />
    </div>
  );
}

function FollowUpStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    BLOCKED: "bg-danger-light text-danger",
    DUE: "bg-warn-light text-warn",
    PLANNED: "bg-brand-light text-brand",
    COMPLETED: "bg-ok-light text-ok",
    CANCELLED: "bg-soft text-muted",
  };
  return (
    <span
      className={cn(
        "text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full whitespace-nowrap",
        styles[status] ?? "bg-soft text-muted",
      )}
    >
      {status === "PLANNED" ? "Scheduled" : status === "BLOCKED" ? "Needs review" : status}
    </span>
  );
}

function FollowUpStatCard({
  label,
  value,
  color,
  highlight,
}: {
  label: string;
  value: number;
  color?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "border rounded-lg px-4 py-2.5 min-w-[80px]",
        highlight ? "border-warn bg-warn-light" : "border-line bg-page",
      )}
    >
      <p className={cn("text-lg font-bold", color ?? "text-ink")}>{value}</p>
      <p className="text-[10px] text-muted uppercase tracking-wide">{label}</p>
    </div>
  );
}

function ActivityFeedPanel() {
  const { data, isLoading, isError, refetch } = useActivityFeed(100);
  const navigate = useNavigate();
  const events = data?.events ?? [];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {isError ? (
        <ErrorState title="Couldn't load the audit log" onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="p-6 space-y-2 flex-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-12 bg-surface border border-line rounded-lg animate-pulse"
            />
          ))}
        </div>
      ) : events.length > 0 ? (
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-4 space-y-0">
            {events.map((event, i) => (
              <EventRow
                key={i}
                event={event}
                isLast={i === events.length - 1}
                onOpenLead={event.lead_id ? () => navigate(`/leads/${event.lead_id}`) : undefined}
              />
            ))}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={Activity}
          title="No activity yet"
          description="Actions in this workspace will appear here."
        />
      )}
    </div>
  );
}

function EventRow({
  event,
  isLast,
  onOpenLead,
}: {
  event: ActivityEvent;
  isLast: boolean;
  onOpenLead?: () => void;
}) {
  return (
    <div className="flex gap-3 min-h-[40px]">
      <div className="flex flex-col items-center pt-1.5">
        <div className="w-2 h-2 rounded-full bg-brand shrink-0" />
        {!isLast && <div className="w-px flex-1 bg-line mt-1" />}
      </div>
      <div className="flex-1 pb-4 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-soft text-muted uppercase">
            {formatEventType(event.event_type)}
          </span>
          <span className="text-[11px] text-muted">
            {new Date(event.created_at).toLocaleString()}
          </span>
          {onOpenLead && (
            <button
              onClick={onOpenLead}
              className="text-[11px] font-medium text-brand hover:text-brand-strong cursor-pointer"
            >
              {event.lead_name || "View lead"} &rarr;
            </button>
          )}
        </div>
        <p className="text-sm text-ink mt-0.5">{event.message}</p>
      </div>
    </div>
  );
}

function formatEventType(t: string) {
  return t.replace(/([a-z])([A-Z])/g, "$1 $2");
}
