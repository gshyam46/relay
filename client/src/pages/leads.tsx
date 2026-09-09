import { useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Upload,
  Plus,
  ChevronRight,
  Building2,
  Users,
  ChevronLeft,
  Mail,
  Phone,
  X,
  Loader2,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { useLeads, useCreateLead } from "@/hooks/use-leads";
import { useWorkspaceStore } from "@/stores/workspace";
import { api } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import type { Lead } from "@/types";

const PAGE_SIZE = 20;

export function LeadsPage() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  const [showAddLead, setShowAddLead] = useState(false);
  const [showImport, setShowImport] = useState(false);

  if (!org) {
    return (
      <>
        <Header title="Leads" />
        <EmptyState
          icon={Building2}
          title="No workspace selected"
          description="Select or create a workspace to manage leads."
        />
      </>
    );
  }

  return (
    <>
      <Header
        title="Leads"
        description={org.name}
        actions={
          <div className="flex gap-2">
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-line rounded-lg hover:bg-soft transition-colors cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              Import
            </button>
            <button
              onClick={() => setShowAddLead(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-brand text-white rounded-lg hover:bg-brand-strong transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add lead
            </button>
          </div>
        }
      />
      <LeadsContent />
      {showAddLead && <AddLeadDialog onClose={() => setShowAddLead(false)} />}
      {showImport && <ImportDialog onClose={() => setShowImport(false)} />}
    </>
  );
}

function AddLeadDialog({ onClose }: { onClose: () => void }) {
  const createLead = useCreateLead();
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "" });
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    setError(null);
    try {
      await createLead.mutateAsync({
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        company: form.company.trim() || undefined,
      });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create lead");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-line shadow-xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-line">
          <h2 className="text-base font-semibold text-ink">Add Lead</h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-soft cursor-pointer">
            <X className="w-4 h-4 text-muted" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <Field label="Name *" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="John Doe" />
          <Field label="Email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} placeholder="john@example.com" type="email" />
          <Field label="Phone" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} placeholder="+1234567890" />
          <Field label="Company" value={form.company} onChange={(v) => setForm((f) => ({ ...f, company: v }))} placeholder="Acme Inc" />
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium border border-line rounded-lg hover:bg-soft cursor-pointer">
              Cancel
            </button>
            <button
              type="submit"
              disabled={createLead.isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-brand text-white rounded-lg hover:bg-brand-strong transition-colors cursor-pointer disabled:opacity-50"
            >
              {createLead.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      />
    </label>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const org = useWorkspaceStore((s) => s.currentOrg)!;
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [result, setResult] = useState<{ imported: number; issues: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setStatus("uploading");
    setError(null);
    try {
      const text = await file.text();
      const previewRes = await api.post<{
        import_id: string;
        summary: { total_rows: number; valid_rows: number };
        rows: { id: string; validation_state: string }[];
      }>("/imports/csv/preview", {
        organization_id: org.id,
        filename: file.name,
        csv_text: text,
        default_phone_region: "INTERNATIONAL_ONLY",
      });
      const validRowIds = previewRes.rows
        .filter((r) => r.validation_state === "VALID")
        .map((r) => r.id);
      if (validRowIds.length === 0) {
        setError("No valid rows found in CSV. Check column headers (name, email, phone, company).");
        setStatus("error");
        return;
      }
      const commitRes = await api.post<{
        summary: { committed_rows: number; invalid_rows: number };
        issues: unknown[];
      }>(`/imports/${previewRes.import_id}/commit`, {
        organization_id: org.id,
        selected_row_ids: validRowIds,
      });
      setResult({
        imported: commitRes.summary?.committed_rows ?? 0,
        issues: commitRes.issues?.length ?? 0,
      });
      setStatus("done");
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Import failed");
      setStatus("error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-line shadow-xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-line">
          <h2 className="text-base font-semibold text-ink">Import CSV</h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-soft cursor-pointer">
            <X className="w-4 h-4 text-muted" />
          </button>
        </div>
        <div className="p-5">
          {status === "idle" && (
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-line rounded-xl p-8 text-center cursor-pointer hover:border-brand hover:bg-brand-light/30 transition-colors"
            >
              <Upload className="w-8 h-8 text-muted mx-auto mb-2" />
              <p className="text-sm font-medium text-ink">Click to select a CSV file</p>
              <p className="text-xs text-muted mt-1">CSV with name, email, phone, company columns</p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </div>
          )}
          {status === "uploading" && (
            <div className="flex flex-col items-center py-8">
              <Loader2 className="w-8 h-8 text-brand animate-spin mb-3" />
              <p className="text-sm text-ink">Importing...</p>
            </div>
          )}
          {status === "done" && result && (
            <div className="text-center py-6">
              <div className="w-12 h-12 rounded-full bg-ok-light flex items-center justify-center mx-auto mb-3">
                <Upload className="w-6 h-6 text-ok" />
              </div>
              <p className="text-sm font-medium text-ink">Import complete</p>
              <p className="text-xs text-muted mt-1">{result.imported} leads imported{result.issues > 0 ? `, ${result.issues} issues` : ""}</p>
              <button onClick={onClose} className="mt-4 px-4 py-2 text-sm font-medium bg-brand text-white rounded-lg hover:bg-brand-strong cursor-pointer">
                Done
              </button>
            </div>
          )}
          {status === "error" && (
            <div className="text-center py-6">
              <p className="text-sm text-danger font-medium">Import failed</p>
              <p className="text-xs text-muted mt-1">{error}</p>
              <button onClick={() => setStatus("idle")} className="mt-4 px-4 py-2 text-sm font-medium border border-line rounded-lg hover:bg-soft cursor-pointer">
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LeadsContent() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<"name" | "company" | "source" | "status" | "created_at">("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const { data: leads, isLoading, isError, refetch } = useLeads({ search });
  const navigate = useNavigate();

  const sorted = useMemo(() => {
    if (!leads) return [];
    return [...leads].sort((a, b) => {
      const aVal = (a[sortKey] ?? "").toString().toLowerCase();
      const bVal = (b[sortKey] ?? "").toString().toLowerCase();
      const cmp = aVal.localeCompare(bVal);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [leads, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSort = (key: string) => {
    const typedKey = key as typeof sortKey;
    if (sortKey === typedKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(typedKey);
      setSortDir("asc");
    }
    setPage(0);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Search & Summary */}
      <div className="px-6 py-3 border-b border-line bg-surface flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search leads..."
            className="w-full pl-9 pr-4 py-2 text-sm border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </div>
        {leads && (
          <span className="text-xs text-muted shrink-0">
            {leads.length} lead{leads.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Lead Table */}
      {isError ? (
        <ErrorState title="Couldn't load leads" onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="p-6 space-y-2 flex-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-14 bg-surface border border-line rounded-lg animate-pulse"
            />
          ))}
        </div>
      ) : paged.length > 0 ? (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-left">
            <thead className="sticky top-0 z-10">
              <tr className="bg-soft border-b border-line">
                <SortHeader label="Name" field="name" current={sortKey} dir={sortDir} onSort={handleSort} className="pl-6" />
                <SortHeader label="Company" field="company" current={sortKey} dir={sortDir} onSort={handleSort} />
                <th className="py-2.5 px-4 text-[11px] font-semibold text-muted uppercase tracking-wider">Contact</th>
                <SortHeader label="Source" field="source" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Status" field="status" current={sortKey} dir={sortDir} onSort={handleSort} />
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {paged.map((lead) => (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  onClick={() => navigate(`/leads/${lead.id}`)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={Users}
          title="No leads found"
          description={
            search
              ? "Try a different search term."
              : "Import a CSV or add leads manually to get started."
          }
        />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-2.5 border-t border-line bg-surface shrink-0">
          <span className="text-xs text-muted">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1.5 rounded-lg hover:bg-soft disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4 text-ink" />
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }).map((_, i) => {
              const pageNum = totalPages <= 5 ? i : Math.max(0, Math.min(page - 2, totalPages - 5)) + i;
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={cn(
                    "w-8 h-8 text-xs rounded-lg font-medium cursor-pointer",
                    pageNum === page
                      ? "bg-brand text-white"
                      : "hover:bg-soft text-ink",
                  )}
                >
                  {pageNum + 1}
                </button>
              );
            })}
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="p-1.5 rounded-lg hover:bg-soft disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              <ChevronRight className="w-4 h-4 text-ink" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortHeader({
  label,
  field,
  current,
  dir,
  onSort,
  className,
}: {
  label: string;
  field: string;
  current: string;
  dir: string;
  onSort: (key: string) => void;
  className?: string;
}) {
  const active = current === field;
  return (
    <th
      className={cn(
        "py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wider cursor-pointer select-none hover:text-ink transition-colors",
        active ? "text-ink" : "text-muted",
        className,
      )}
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && (
          <span className="text-brand text-[9px]">
            {dir === "asc" ? "▲" : "▼"}
          </span>
        )}
      </span>
    </th>
  );
}

function LeadRow({
  lead,
  onClick,
}: {
  lead: Lead;
  onClick: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className="hover:bg-soft transition-colors cursor-pointer group"
    >
      <td className="py-3 px-4 pl-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-brand-light text-brand flex items-center justify-center text-xs font-bold shrink-0">
            {(lead.name?.[0] ?? "?").toUpperCase()}
          </div>
          <span className="text-sm font-medium text-ink truncate max-w-[180px]">
            {lead.name || "Unnamed"}
          </span>
        </div>
      </td>
      <td className="py-3 px-4">
        <span className="text-sm text-muted truncate block max-w-[180px]">
          {lead.company || "—"}
        </span>
      </td>
      <td className="py-3 px-4">
        <div className="flex flex-col gap-0.5">
          {lead.email && (
            <span className="flex items-center gap-1 text-xs text-muted truncate max-w-[200px]">
              <Mail className="w-3 h-3 shrink-0" />
              {lead.email}
            </span>
          )}
          {lead.phone && (
            <span className="flex items-center gap-1 text-xs text-muted truncate max-w-[200px]">
              <Phone className="w-3 h-3 shrink-0" />
              {lead.phone}
            </span>
          )}
          {!lead.email && !lead.phone && (
            <span className="text-xs text-subtle">—</span>
          )}
        </div>
      </td>
      <td className="py-3 px-4">
        <SourceBadge source={lead.source} />
      </td>
      <td className="py-3 px-4">
        <StatusBadge status={lead.status} />
      </td>
      <td className="py-3 pr-6">
        <ChevronRight className="w-4 h-4 text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    NEW: "bg-brand-light text-brand",
    NORMALIZED: "bg-blue-50 text-blue-700",
    ACTIVE: "bg-ok-light text-ok",
    CONTACTED: "bg-blue-50 text-blue-700",
    CONVERTED: "bg-ok-light text-ok",
    OPTED_OUT: "bg-danger-light text-danger",
    FAILED: "bg-danger-light text-danger",
  };
  return (
    <span
      className={cn(
        "text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full whitespace-nowrap",
        styles[status] ?? "bg-soft text-muted",
      )}
    >
      {formatLabel(status)}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  const styles: Record<string, string> = {
    CSV: "bg-purple-50 text-purple-700",
    MANUAL: "bg-blue-50 text-blue-700",
    API: "bg-amber-50 text-amber-700",
    WHATSAPP: "bg-green-50 text-green-700",
    EMAIL: "bg-red-50 text-red-700",
    WEB: "bg-cyan-50 text-cyan-700",
  };
  return (
    <span
      className={cn(
        "text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full whitespace-nowrap",
        styles[source] ?? "bg-soft text-muted",
      )}
    >
      {formatLabel(source)}
    </span>
  );
}

function formatLabel(s: string) {
  return s
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}
