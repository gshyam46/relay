import {
  Users,
  UserCheck,
  Sparkles,
  ClipboardCheck,
  Clock,
  Building2,
  ArrowRight,
  TrendingUp,
  BarChart3,
  Brain,
  CalendarDays,
  Zap,
  Loader2,
  AlertCircle,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { useNavigate } from "react-router-dom";
import { Header } from "@/components/layout/header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { useDashboardData, useAttentionQueue } from "@/hooks/use-dashboard";
import { useBulkRunIntelligence } from "@/hooks/use-intelligence";
import { useWorkspaceStore } from "@/stores/workspace";
import { cn } from "@/lib/utils";
import { useState } from "react";

const CHART_COLORS = [
  "#0f766e",
  "#0ea5e9",
  "#8b5cf6",
  "#f59e0b",
  "#ef4444",
  "#10b981",
  "#6366f1",
  "#ec4899",
];

export function DashboardPage() {
  const org = useWorkspaceStore((s) => s.currentOrg);

  if (!org) {
    return (
      <>
        <Header title="Dashboard" />
        <EmptyState
          icon={Building2}
          title="No workspace selected"
          description="Select or create a workspace to see your dashboard."
        />
      </>
    );
  }

  return (
    <>
      <Header title="Dashboard" description={org.name} actions={<AnalyzeEligibleButton />} />
      <DashboardContent />
    </>
  );
}

function AnalyzeEligibleButton() {
  const bulkRun = useBulkRunIntelligence();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleClick = async () => {
    if (running) return;
    setRunning(true);
    setMessage(null);
    try {
      const result = await bulkRun.mutateAsync(undefined);
      setMessage(`Analyzed ${result.processed} lead${result.processed !== 1 ? "s" : ""}.`);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Bulk analysis failed");
    } finally {
      setRunning(false);
      setTimeout(() => setMessage(null), 6000);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {message && <span className="text-xs text-muted hidden sm:inline">{message}</span>}
      <button
        onClick={handleClick}
        disabled={running}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-brand text-white rounded-lg hover:bg-brand-strong transition-colors cursor-pointer disabled:opacity-50"
      >
        {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
        {running ? "Analyzing..." : "Analyze eligible leads"}
      </button>
    </div>
  );
}

function DashboardContent() {
  const { data, isLoading, isError, refetch } = useDashboardData();
  const { data: attention, isError: attentionError, refetch: refetchAttention } = useAttentionQueue();
  const navigate = useNavigate();

  if (isError) {
    return (
      <ErrorState
        title="Couldn't load the dashboard"
        description="We couldn't reach the server for your metrics. Check your connection and try again."
        onRetry={() => refetch()}
      />
    );
  }

  if (isLoading || !data) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="bg-surface border border-line rounded-xl p-4 h-[100px] animate-pulse"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="bg-surface border border-line rounded-xl h-64 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  const m = data;
  const conversionRate =
    m.leads.total > 0
      ? ((m.leads.converted_count / m.leads.total) * 100).toFixed(1)
      : "0.0";

  const sourceData = m.sources.map(({ source, count }) => ({
    name: formatLabel(source),
    value: count,
  }));

  const statusData = m.statuses.map(({ status, count }) => ({
    name: formatLabel(status),
    value: count,
  }));

  const trendData = fillDailyGaps(m.daily_leads);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <MetricCard
          label="Total Leads"
          value={m.leads.total}
          icon={Users}
          sublabel={`${m.leads.new_last_7d} this week`}
        />
        <MetricCard
          label="Active"
          value={m.leads.active_count}
          icon={UserCheck}
          accent="ok"
          sublabel={`${m.leads.total > 0 ? ((m.leads.active_count / m.leads.total) * 100).toFixed(0) : 0}% of total`}
        />
        <MetricCard
          label="Converted"
          value={m.leads.converted_count}
          icon={TrendingUp}
          accent="ok"
          sublabel={`${conversionRate}% rate`}
        />
        <MetricCard
          label="Pending Review"
          value={m.pending_approvals}
          icon={ClipboardCheck}
          accent={m.pending_approvals > 0 ? "warn" : "default"}
          sublabel={m.pending_approvals > 0 ? "Needs action" : "All clear"}
        />
        <MetricCard
          label="Follow-ups Due"
          value={m.follow_ups_due}
          icon={Clock}
          accent={m.follow_ups_due > 0 ? "warn" : "default"}
          sublabel={m.follow_ups_due > 0 ? "Overdue" : "All caught up"}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Lead Trend */}
        <div className="bg-surface border border-line rounded-xl p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-brand" />
              Lead Activity (30 days)
            </h3>
            <span className="text-xs text-muted">
              {m.leads.new_last_30d} leads this month
            </span>
          </div>
          {trendData.length > 1 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0f766e" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#0f766e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#d9e1e7" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#5d6b75" }}
                  axisLine={{ stroke: "#d9e1e7" }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#5d6b75" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                  width={30}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: "1px solid #d9e1e7",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#0f766e"
                  strokeWidth={2}
                  fill="url(#areaGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center">
              <p className="text-sm text-muted">
                Lead trend will appear as data accumulates
              </p>
            </div>
          )}
        </div>

        {/* Lead Sources Donut */}
        <div className="bg-surface border border-line rounded-xl p-5">
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-brand" />
            Lead Sources
          </h3>
          {sourceData.length > 0 ? (
            <div className="flex flex-col items-center">
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={sourceData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                  >
                    {sourceData.map((_, i) => (
                      <Cell
                        key={i}
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: "1px solid #d9e1e7",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-2">
                {sourceData.map((item, i) => (
                  <div
                    key={item.name}
                    className="flex items-center gap-1.5 text-xs"
                  >
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{
                        backgroundColor:
                          CHART_COLORS[i % CHART_COLORS.length],
                      }}
                    />
                    <span className="text-muted">{item.name}</span>
                    <span className="font-semibold text-ink">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted py-8 text-center">
              No lead data yet
            </p>
          )}
        </div>
      </div>

      {/* Bottom Row: Pipeline + Attention Queue + Intelligence */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Pipeline Status */}
        <div className="bg-surface border border-line rounded-xl p-5">
          <h3 className="text-sm font-semibold text-ink mb-4">
            Pipeline Status
          </h3>
          {statusData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={statusData} barSize={24} layout="vertical">
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#d9e1e7"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: "#5d6b75" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  tick={{ fontSize: 11, fill: "#5d6b75" }}
                  axisLine={false}
                  tickLine={false}
                  width={80}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: "1px solid #d9e1e7",
                  }}
                />
                <Bar
                  dataKey="value"
                  fill="#0f766e"
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted py-8 text-center">
              No pipeline data yet
            </p>
          )}
        </div>

        {/* Needs Attention */}
        <div className="bg-surface border border-line rounded-xl flex flex-col">
          <div className="flex items-center justify-between px-5 py-3 border-b border-line shrink-0">
            <h3 className="text-sm font-semibold text-ink">Needs Attention</h3>
            {attention && attention.total > 0 && (
              <span className="text-[10px] font-semibold text-warn bg-warn-light px-2 py-0.5 rounded-full">
                {attention.total} {attention.total === 1 ? "lead" : "leads"}
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-line">
            {attentionError ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-muted mb-2">Couldn't load this list.</p>
                <button
                  onClick={() => refetchAttention()}
                  className="text-xs font-medium text-brand hover:text-brand-strong cursor-pointer"
                >
                  Retry
                </button>
              </div>
            ) : attention && attention.items.length > 0 ? (
              attention.items.slice(0, 6).map((item) => (
                <button
                  key={item.lead_id}
                  onClick={() => navigate(`/leads/${item.lead_id}?tab=${tabForAttentionReason(item.reason)}`)}
                  className="flex items-center justify-between w-full px-5 py-2.5 text-left hover:bg-soft transition-colors cursor-pointer"
                >
                  <div className="min-w-0 flex-1 mr-3">
                    <p className="text-sm font-medium text-ink truncate">
                      {item.name || item.email || item.phone || "Unnamed"}
                    </p>
                    <p className="text-[11px] text-muted truncate flex items-center gap-1">
                      <AlertCircle className="w-3 h-3 shrink-0 text-warn" />
                      {item.reason}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <PriorityDot priority={item.priority} />
                    <ArrowRight className="w-3 h-3 text-muted" />
                  </div>
                </button>
              ))
            ) : (
              <p className="px-5 py-8 text-sm text-muted text-center">
                Nothing needs attention right now
              </p>
            )}
          </div>
          {attention && attention.total > 6 && (
            <div className="px-5 py-2.5 border-t border-line shrink-0">
              <button
                onClick={() => navigate("/leads")}
                className="text-xs font-medium text-brand hover:text-brand-strong transition-colors cursor-pointer"
              >
                View all {attention.total} leads needing attention &rarr;
              </button>
            </div>
          )}
        </div>

        {/* Intelligence & Follow-ups Summary */}
        <div className="space-y-4">
          <div className="bg-surface border border-line rounded-xl p-5">
            <h3 className="text-sm font-semibold text-ink flex items-center gap-2 mb-3">
              <Brain className="w-4 h-4 text-brand" />
              Intelligence
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-page rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-ink">
                  {m.intelligence.total_snapshots}
                </p>
                <p className="text-[11px] text-muted mt-0.5">Total Runs</p>
              </div>
              <div className="bg-page rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-brand">
                  {m.intelligence.completed}
                </p>
                <p className="text-[11px] text-muted mt-0.5">Completed</p>
              </div>
            </div>
            {m.intelligence.pending > 0 && (
              <p className="text-xs text-warn mt-2 text-center">
                {m.intelligence.pending} pending analysis
              </p>
            )}
          </div>

          <div className="bg-surface border border-line rounded-xl p-5">
            <h3 className="text-sm font-semibold text-ink flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-brand" />
              Quick Stats
            </h3>
            <div className="space-y-2.5">
              <StatRow
                label="New this week"
                value={m.leads.new_last_7d}
                total={m.leads.total}
              />
              <StatRow
                label="Opted out"
                value={m.leads.opted_out_count}
                total={m.leads.total}
              />
              <StatRow
                label="Conversion rate"
                value={m.leads.converted_count}
                total={m.leads.total}
                showPercent
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  accent = "default",
  sublabel,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  accent?: "default" | "ok" | "warn" | "danger";
  sublabel?: string;
}) {
  const ring: Record<string, string> = {
    default: "border-line",
    ok: "border-emerald-200",
    warn: "border-amber-200",
    danger: "border-red-200",
  };
  const iconBg: Record<string, string> = {
    default: "bg-brand-light text-brand",
    ok: "bg-ok-light text-ok",
    warn: "bg-warn-light text-warn",
    danger: "bg-danger-light text-danger",
  };

  return (
    <div
      className={cn(
        "bg-surface border rounded-xl p-4 flex flex-col justify-between min-h-[100px]",
        ring[accent],
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          {label}
        </span>
        <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center", iconBg[accent])}>
          <Icon className="w-3.5 h-3.5" />
        </div>
      </div>
      <div>
        <p className="text-2xl font-bold text-ink leading-tight">{value}</p>
        {sublabel && (
          <p className="text-[11px] text-muted mt-0.5">{sublabel}</p>
        )}
      </div>
    </div>
  );
}

function StatRow({
  label,
  value,
  total,
  showPercent,
}: {
  label: string;
  value: number;
  total: number;
  showPercent?: boolean;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-muted">{label}</span>
        <span className="font-semibold text-ink">
          {showPercent ? `${pct.toFixed(1)}%` : value}
        </span>
      </div>
      <div className="w-full h-1.5 bg-page rounded-full overflow-hidden">
        <div
          className="h-full bg-brand rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

function PriorityDot({ priority }: { priority: "HIGH" | "MEDIUM" | "LOW" }) {
  const styles: Record<string, string> = {
    HIGH: "bg-danger-light text-danger",
    MEDIUM: "bg-warn-light text-warn",
    LOW: "bg-soft text-muted",
  };
  return (
    <span className={cn("text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full whitespace-nowrap", styles[priority])}>
      {priority}
    </span>
  );
}

function formatLabel(s: string) {
  return s
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

function tabForAttentionReason(reason: string): "intelligence" | "outbound" {
  const outboundReasons = ["Recommendation ready for review", "Outbound action failed", "Follow-up due", "Reply needs human review"];
  return outboundReasons.includes(reason) ? "outbound" : "intelligence";
}

function fillDailyGaps(daily: { day: string; count: number }[]) {
  if (daily.length === 0) return [];

  const map = new Map(daily.map((d) => [d.day, d.count]));
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 29);

  const result: { day: string; label: string; count: number }[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    result.push({
      day: iso,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      count: map.get(iso) ?? 0,
    });
  }
  return result;
}
