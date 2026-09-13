import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Users, FileInput, Brain, Send, Activity, MessageSquare, Settings, ChevronLeft, ChevronRight, Zap, X } from "lucide-react";
import { useMe } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace";

const navItems = [
  { to: "/app", icon: LayoutDashboard, label: "Dashboard" }, { to: "/leads", icon: Users, label: "Leads" },
  { to: "/imports", icon: FileInput, label: "Imports" }, { to: "/intelligence", icon: Brain, label: "Intelligence" },
  { to: "/outbound", icon: Send, label: "Outbound" }, { to: "/conversations", icon: MessageSquare, label: "Conversations" },
  { to: "/activity", icon: Activity, label: "Activity" },
];
export function Sidebar({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void } = {}) {
  const savedCollapse = useWorkspaceStore(state => state.sidebarCollapsed), toggle = useWorkspaceStore(state => state.toggleSidebar), collapsed = !mobile && savedCollapse;
  const location = useLocation(), { data: me } = useMe();
  const navigation = me?.user.role === "OWNER" ? [...navItems, { to: "/workflows", icon: Zap, label: "Workflows" }, { to: "/event-recovery", icon: Activity, label: "Event recovery" }] : navItems;
  function link(item: typeof navItems[number]) {
    const active = location.pathname === item.to || location.pathname.startsWith(item.to + "/");
    return <NavLink key={item.to} to={item.to} aria-label={item.label} title={collapsed ? item.label : undefined} onClick={onNavigate} className={cn("flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-white", active ? "bg-sidebar-accent text-white" : "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-text", collapsed && "justify-center px-0")}><item.icon className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />{!collapsed && <span className="truncate">{item.label}</span>}</NavLink>;
  }
  return <aside aria-label={mobile ? "Mobile workspace sidebar" : "Workspace sidebar"} className={cn("h-dvh shrink-0 flex-col border-r border-sidebar-accent bg-sidebar text-sidebar-text", mobile ? "flex w-full" : "sticky top-0 hidden transition-[width] duration-200 motion-reduce:transition-none md:flex", !mobile && (collapsed ? "w-16" : "w-60"))}>
    <div className="flex min-h-16 shrink-0 items-center gap-3 border-b border-sidebar-accent px-4 py-2"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-white"><Zap className="h-4 w-4" aria-hidden="true" /></div>{!collapsed && <div className="min-w-0 flex-1"><span className="block text-sm font-semibold tracking-tight">Relay</span><span className="block text-[10px] leading-4 text-sidebar-muted">AI Lead Intelligence &amp; Outbound Automation</span></div>}{mobile && <button type="button" autoFocus aria-label="Close workspace navigation" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-white" onClick={onNavigate}><X size={20} aria-hidden="true" /></button>}</div>
    <nav aria-label="Workspace pages" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-3">{navigation.map(link)}</nav>
    <div className="flex shrink-0 flex-col gap-1 border-t border-sidebar-accent px-2 pb-3 pt-2">{link({ to: "/settings", icon: Settings, label: "Settings" })}{!mobile && <button type="button" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={toggle} className="flex min-h-11 items-center justify-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-text focus-visible:outline-2 focus-visible:outline-white">{collapsed ? <ChevronRight className="h-4 w-4" aria-hidden="true" /> : <ChevronLeft className="h-4 w-4" aria-hidden="true" />}</button>}</div>
  </aside>;
}
