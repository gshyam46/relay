import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Brain,
  Send,
  Activity,
  MessageSquare,
  Settings,
  ChevronLeft,
  ChevronRight,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/leads", icon: Users, label: "Leads" },
  { to: "/intelligence", icon: Brain, label: "Intelligence" },
  { to: "/outbound", icon: Send, label: "Outbound" },
  { to: "/conversations", icon: MessageSquare, label: "Conversations" },
  { to: "/activity", icon: Activity, label: "Activity" },
];

const bottomItems = [
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const collapsed = useWorkspaceStore((s) => s.sidebarCollapsed);
  const toggle = useWorkspaceStore((s) => s.toggleSidebar);
  const location = useLocation();

  return (
    <aside
      className={cn(
        "flex flex-col bg-sidebar text-sidebar-text h-screen sticky top-0 transition-all duration-200 ease-in-out border-r border-sidebar-accent",
        collapsed ? "w-16" : "w-60",
      )}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 px-4 h-14 border-b border-sidebar-accent">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-brand text-white shrink-0">
          <Zap className="w-4 h-4" />
        </div>
        {!collapsed && (
          <span className="font-semibold text-sm tracking-tight truncate">
            Relay
          </span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col gap-1 px-2 py-3">
        {navItems.map((item) => {
          const active =
            item.to === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(item.to);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-white"
                  : "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-text",
                collapsed && "justify-center px-0",
              )}
            >
              <item.icon className="w-4.5 h-4.5 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="flex flex-col gap-1 px-2 pb-3 border-t border-sidebar-accent pt-2">
        {bottomItems.map((item) => {
          const active = location.pathname.startsWith(item.to);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-white"
                  : "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-text",
                collapsed && "justify-center px-0",
              )}
            >
              <item.icon className="w-4.5 h-4.5 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          );
        })}

        <button
          onClick={toggle}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-text transition-colors cursor-pointer justify-center"
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </div>
    </aside>
  );
}
