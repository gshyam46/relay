import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-20 px-6 text-center",
        className,
      )}
    >
      <div className="w-10 h-10 rounded-full border border-line flex items-center justify-center mb-5">
        <Icon className="w-4.5 h-4.5 text-brand" strokeWidth={1.6} aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold tracking-tight text-ink mb-2">{title}</h3>
      <p className="text-sm leading-6 text-muted max-w-sm">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
