import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  trend?: { value: number; label: string };
  accent?: "default" | "ok" | "warn" | "danger";
  className?: string;
}

const accentStyles = {
  default: "text-brand",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
};

export function KpiCard({
  label,
  value,
  icon: Icon,
  trend,
  accent = "default",
  className,
}: KpiCardProps) {
  return (
    <div
      className={cn(
        "bg-surface border border-line rounded-lg p-5 flex min-w-0 flex-col gap-5",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium leading-relaxed text-muted">
          {label}
        </span>
        <div
          className={cn(
            "w-6 h-6 shrink-0 flex items-center justify-center",
            accentStyles[accent],
          )}
        >
          <Icon className="w-4 h-4" strokeWidth={1.6} aria-hidden="true" />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <span className="text-[32px] font-medium tracking-[-0.055em] tabular-nums text-ink leading-none">
          {value}
        </span>
        {trend && (
          <span
            className={cn(
              "text-xs font-medium pb-0.5",
              trend.value >= 0 ? "text-ok" : "text-danger",
            )}
          >
            {trend.value >= 0 ? "+" : ""}
            {trend.value} {trend.label}
          </span>
        )}
      </div>
    </div>
  );
}
