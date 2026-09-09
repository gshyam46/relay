import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Brain,
  Building2,
  Search,
  Play,
  CheckCircle2,
  Clock,
  XCircle,
  Filter,
  Loader2,
  Zap,
} from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Header } from "@/components/layout/header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { useWorkspaceStore } from "@/stores/workspace";
import {
  useIntelligenceSummary,
  useRunIntelligence,
  useBulkRunIntelligence,
  type IntelligenceRow,
} from "@/hooks/use-intelligence";
import { useAttentionQueue } from "@/hooks/use-dashboard";
import { cn } from "@/lib/utils";

type StatusFilter = "ALL" | "NOT_RUN" | "PENDING" | "COMPLETED" | "FAILED";

const STATUS_CHART_COLORS: Record<string, string> = {
  "Not analyzed": "#94a3b8",
  Analyzing: "#f59e0b",
  Analyzed: "#0f766e",
  Failed: "#ef4444",
};

export function IntelligencePage() {
  const org = useWorkspaceStore((s) => s.currentOrg);

  if (!org) {
    return (
      <>
        <Header title="Intelligence" />
        <EmptyState
          icon={Building2}
          title="No workspace selected"
          description="Select or create a workspace first."
        />
      </>
    );
  }

  return <IntelligenceWithOrg />;
}

function IntelligenceWithOrg() {
  const org = useWorkspaceStore((s) => s.currentOrg)!;
  const { data, isLoading, isError, refetch } = useIntelligenceSummary();
  const { data: attention } = useAttentionQueue();
  const runIntel = useRunIntelligence();
  const bulkRun = useBulkRunIntelligence();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const navigate = useNavigate();

  const filtered = useMemo(() => {
    if (!data?.leads) return [];
    let rows = data.leads;
    if (statusFilter !== "ALL") {
      rows = rows.filter((r) => r.intelligence_status === statusFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.name?.toLowerCase().includes(q) ||
          r.email?.toLowerCase().includes(q) ||
          r.company?.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [data, search, statusFilter]);

  const totals = data?.totals;

  const handleRunOne = async (leadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRunningIds((prev) => new Set(prev).add(leadId));
    try {
      await runIntel.mutateAsync(leadId);
    } finally {
      setRunningIds((prev) => {
        const next = new Set(prev);
        next.delete(leadId);
        return next;
      });
    }
  };

  const handleRunAllPending = async () => {
    if (bulkRunning) return;
    setBulkRunning(true);
    setBulkResult(null);
    try {
      const result = await bulkRun.mutateAsync(undefined);
      setBulkResult(
        `Analyzed ${result.processed} lead${result.processed !== 1 ? "s" : ""} — ${result.succeeded} succeeded${result.failed ? `, ${result.failed} failed` : ""}${result.remaining ? `, ${result.remaining} remaining (run again to continue)` : ""}.`,
      );
    } catch (err: unknown) {
      setBulkResult(err instanceof Error ? err.message : "Bulk analysis failed");
    } finally {
      setBulkRunning(false);
      setTimeout(() => setBulkResult(null), 8000);
    }
  };

  const handleAnalyzeSelected = async () => {
    if (selected.size === 0 || bulkRunning) return;
    setBulkRunning(true);
    setBulkResult(null);
    try {
      const result = await bulkRun.mutateAsync(Array.from(selected));
      setBulkResult(
        `Analyzed ${result.processed} selected lead${result.processed !== 1 ? "s" : ""} — ${result.succeeded} succeeded${result.failed ? `, ${result.failed} failed` : ""}.`,
      );
      setSelected(new Set());
    } catch (err: unknown) {
      setBulkResult(err instanceof Error ? err.message : "Bulk analysis failed");
    } finally {
      setBulkRunning(false);
      setTimeout(() => setBulkResult(null), 8000);
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

  const toggleSelectAll = () => {
    setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((r) => r.lead_id))));
  };

  const statusBreakdown = useMemo(() => {
    if (!totals) return [];
    return [
      { name: "Not analyzed", value: totals.not_run },
      { name: "Analyzing", value: totals.pending },
      { name: "Analyzed", value: totals.completed },
      { name: "Failed", value: totals.failed },
    ].filter((d) => d.value > 0);
  }, [totals]);

  return (
    <>
      <Header
        title="Intelligence"
        description={org.name}
        actions={
          <button
            onClick={handleRunAllPending}
            disabled={bulkRunning || !totals?.not_run}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-brand text-white rounded-lg hover:bg-brand-strong transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {bulkRunning ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {bulkRunning ? "Analyzing..." : `Analyze eligible leads${totals?.not_run ? ` (${totals.not_run})` : ""}`}
          </button>
        }
      />
      {bulkResult && (
        <div className="mx-6 mt-4 px-4 py-2.5 rounded-lg text-sm font-medium bg-brand-light text-brand">
          {bulkResult}
        </div>
      )}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Summary Cards */}
        {totals && (
          <div className="px-6 py-4 border-b border-line bg-surface space-y-3">
            <div className="flex items-start gap-6 flex-wrap">
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 flex-1 min-w-[320px]">
                <StatCard label="Total leads" value={totals.total} />
                <StatCard label="Not analyzed" value={totals.not_run} color="text-muted" />
                <StatCard label="Analyzing" value={totals.pending} color="text-warn" />
                <StatCard label="Analyzed" value={totals.completed} color="text-ok" />
                <StatCard label="Failed" value={totals.failed} color="text-danger" />
                <StatCard label="Recommendations ready" value={totals.with_recommendation} color="text-brand" />
                <StatCard label="Action ready" value={totals.with_nba} color="text-brand" />
              </div>
              {statusBreakdown.length > 0 && (
                <div className="flex items-center gap-3 shrink-0">
                  <ResponsiveContainer width={72} height={72}>
                    <PieChart>
                      <Pie data={statusBreakdown} cx="50%" cy="50%" innerRadius={20} outerRadius={34} paddingAngle={2} dataKey="value" stroke="none">
                        {statusBreakdown.map((d) => (
                          <Cell key={d.name} fill={STATUS_CHART_COLORS[d.name]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #d9e1e7" }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-0.5">
                    <p className="text-[10px] font-semibold text-muted uppercase tracking-wide mb-1">Analysis status</p>
                    {statusBreakdown.map((d) => (
                      <div key={d.name} className="flex items-center gap-1.5 text-[11px]">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_CHART_COLORS[d.name] }} />
                        <span className="text-muted">{d.name}</span>
                        <span className="font-semibold text-ink">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {attention && attention.total > 0 && (
              <div className="flex items-center gap-3 flex-wrap pt-1">
                <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">Needs attention:</span>
                {(["HIGH", "MEDIUM", "LOW"] as const).map((p) => {
                  const count = attention.items.filter((i) => i.priority === p).length;
                  if (count === 0) return null;
                  const style =
                    p === "HIGH" ? "bg-danger-light text-danger" : p === "MEDIUM" ? "bg-warn-light text-warn" : "bg-soft text-muted";
                  return (
                    <span key={p} className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", style)}>
                      {count} {formatLabel(p)}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        <div className="px-6 py-3 border-b border-line bg-surface flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leads..."
              className="w-full pl-9 pr-4 py-2 text-sm border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-muted" />
            {(["ALL", "NOT_RUN", "COMPLETED", "PENDING", "FAILED"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded-full transition-colors cursor-pointer",
                  statusFilter === s
                    ? "bg-brand text-white"
                    : "bg-soft text-muted hover:text-ink",
                )}
              >
                {s === "ALL" ? "All" : formatLabel(s)}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted ml-auto shrink-0">
            {filtered.length} lead{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {selected.size > 0 && (
          <div className="px-6 py-2.5 border-b border-line bg-brand-light/40 flex items-center gap-3">
            <span className="text-xs font-medium text-ink">{selected.size} selected</span>
            <button
              onClick={handleAnalyzeSelected}
              disabled={bulkRunning}
              className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-white bg-brand rounded-md hover:bg-brand-strong transition-colors cursor-pointer disabled:opacity-50"
            >
              {bulkRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              Analyze selected
            </button>
          </div>
        )}

        {/* Table */}
        {isError ? (
          <ErrorState title="Couldn't load intelligence" onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-6 space-y-2 flex-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-14 bg-surface border border-line rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filtered.length > 0 ? (
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-left">
              <thead className="sticky top-0 z-10">
                <tr className="bg-soft border-b border-line">
                  <th className="w-10 pl-6">
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && selected.size === filtered.length}
                      onChange={toggleSelectAll}
                      className="cursor-pointer"
                    />
                  </th>
                  <th className="py-2.5 px-4 text-[11px] font-semibold text-muted uppercase tracking-wider">Lead</th>
                  <th className="py-2.5 px-4 text-[11px] font-semibold text-muted uppercase tracking-wider">Analysis</th>
                  <th className="py-2.5 px-4 text-[11px] font-semibold text-muted uppercase tracking-wider">Recommendation</th>
                  <th className="py-2.5 px-4 text-[11px] font-semibold text-muted uppercase tracking-wider">Next Step</th>
                  <th className="py-2.5 px-4 text-[11px] font-semibold text-muted uppercase tracking-wider">Last Analyzed</th>
                  <th className="py-2.5 px-4 text-[11px] font-semibold text-muted uppercase tracking-wider w-20">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((row) => (
                  <IntelRow
                    key={row.lead_id}
                    row={row}
                    running={runningIds.has(row.lead_id)}
                    checked={selected.has(row.lead_id)}
                    onToggle={() => toggleSelected(row.lead_id)}
                    onRun={(e) => handleRunOne(row.lead_id, e)}
                    onClick={() => navigate(`/leads/${row.lead_id}?tab=intelligence`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={Brain}
            title="No leads match"
            description={
              search || statusFilter !== "ALL"
                ? "Try adjusting your filters."
                : "Import leads to get started with intelligence analysis."
            }
          />
        )}
      </div>
    </>
  );
}

function IntelRow({
  row,
  running,
  checked,
  onToggle,
  onRun,
  onClick,
}: {
  row: IntelligenceRow;
  running: boolean;
  checked: boolean;
  onToggle: () => void;
  onRun: (e: React.MouseEvent) => void;
  onClick: () => void;
}) {
  return (
    <tr onClick={onClick} className="hover:bg-soft transition-colors cursor-pointer group">
      <td className="pl-6" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={onToggle} className="cursor-pointer" />
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-brand-light text-brand flex items-center justify-center text-xs font-bold shrink-0">
            {(row.name?.[0] ?? "?").toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink truncate max-w-[160px]">{row.name || "Unnamed"}</p>
            {row.company && <p className="text-[11px] text-muted truncate max-w-[160px]">{row.company}</p>}
          </div>
        </div>
      </td>
      <td className="py-3 px-4"><IntelStatusBadge status={row.intelligence_status} /></td>
      <td className="py-3 px-4"><IntelStatusBadge status={row.recommendation_status} /></td>
      <td className="py-3 px-4">
        {row.nba_title || row.nba_action_type ? (
          <div className="flex items-center gap-1.5">
            {row.nba_status && <IntelStatusBadge status={row.nba_status} />}
            <span className="text-xs text-ink truncate block max-w-[140px]">
              {row.nba_title || formatLabel(row.nba_action_type || "")}
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted">—</span>
        )}
      </td>
      <td className="py-3 px-4">
        <span className="text-xs text-muted">
          {row.intelligence_at
            ? new Date(row.intelligence_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
            : "—"}
        </span>
      </td>
      <td className="py-3 px-4">
        <button
          onClick={onRun}
          disabled={running}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-brand bg-brand-light rounded-md hover:bg-brand-muted transition-colors cursor-pointer disabled:opacity-50"
        >
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
          {running ? "Running" : "Run"}
        </button>
      </td>
    </tr>
  );
}

function IntelStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
    NOT_RUN: { label: "Not run", className: "bg-soft text-muted", icon: Clock },
    PENDING: { label: "Pending", className: "bg-warn-light text-warn", icon: Clock },
    COMPLETED: { label: "Done", className: "bg-ok-light text-ok", icon: CheckCircle2 },
    FAILED: { label: "Failed", className: "bg-danger-light text-danger", icon: XCircle },
  };
  const entry = map[status] ?? { label: status, className: "bg-soft text-muted", icon: Clock };
  const Icon = entry.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full", entry.className)}>
      <Icon className="w-3 h-3" />
      {entry.label}
    </span>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-page border border-line rounded-lg px-3 py-2.5 text-center">
      <p className={cn("text-lg font-bold", color ?? "text-ink")}>{value}</p>
      <p className="text-[10px] text-muted uppercase tracking-wide">{label}</p>
    </div>
  );
}

function formatLabel(s: string) {
  return s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
