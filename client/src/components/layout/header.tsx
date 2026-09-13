import { useState } from "react";
import { Building2, ChevronDown, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace";
import { useMe, useLogout } from "@/hooks/use-auth";

interface HeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function Header({ title, description, actions }: HeaderProps) {
  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-4">
        <div>
          <h1 className="text-base font-semibold text-ink leading-tight">
            {title}
          </h1>
          {description && (
            <p className="text-xs text-muted mt-0.5">{description}</p>
          )}
        </div>
      </div>
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3">
        {actions}
        <WorkspaceMenu />
      </div>
    </header>
  );
}

// One workspace per account — this is no longer a switcher, just the current workspace's name
// with sign-out. See docs/TASKS.md M10 notes on why the old multi-workspace picker was removed.
function WorkspaceMenu() {
  const [open, setOpen] = useState(false);
  const currentOrg = useWorkspaceStore((s) => s.currentOrg);
  const { data: me } = useMe();
  const logout = useLogout();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-lg border border-line text-sm hover:bg-soft transition-colors cursor-pointer",
          open && "bg-soft",
        )}
      >
        <Building2 className="w-3.5 h-3.5 text-muted" />
        <span className="max-w-[140px] truncate text-ink font-medium">
          {currentOrg?.name ?? "Workspace"}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-muted" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-56 bg-surface border border-line rounded-xl shadow-lg z-50 overflow-hidden">
            <div className="px-3 py-2.5 border-b border-line">
              <p className="text-sm font-medium text-ink truncate">{me?.user.name}</p>
              <p className="text-xs text-muted truncate">{me?.user.email}</p>
            </div>
            <button
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-danger hover:bg-danger-light transition-colors cursor-pointer disabled:opacity-50"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
