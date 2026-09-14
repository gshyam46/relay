import { AlertTriangle, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = "Couldn't load this",
  description = "Something went wrong reaching the server. Check your connection and try again.",
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-20 px-6 text-center",
        className,
      )}
    >
      <div className="w-10 h-10 rounded-full border border-danger/20 bg-danger-light flex items-center justify-center mb-5">
        <AlertTriangle className="w-4.5 h-4.5 text-danger" strokeWidth={1.6} aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold tracking-tight text-ink mb-2">{title}</h3>
      <p className="text-sm leading-6 text-muted max-w-sm">{description}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-6 flex min-h-11 items-center gap-2 px-4 py-2.5 text-xs font-semibold border border-line rounded-md hover:bg-soft transition-colors cursor-pointer"
        >
          <RotateCw className="w-3.5 h-3.5" />
          Retry
        </button>
      )}
    </div>
  );
}
