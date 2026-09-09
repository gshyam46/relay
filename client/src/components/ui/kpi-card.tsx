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
  default: "bg-brand-light text-brand",
  ok: "bg-ok-light text-ok",
  warn: "bg-warn-light text-warn",
  danger: "bg-danger-light text-danger",
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
        "bg-surface border border-line rounded-xl p-4 flex flex-col gap-3",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted uppercase tracking-wider">
          {label}
        </span>
        <div
          className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center",
            accentStyles[accent],
          )}
        >
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold text-ink leading-none">
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
