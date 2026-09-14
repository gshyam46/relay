import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Users, FileInput, ScanLine, Send, Activity, MessageSquare, Settings, ChevronLeft, ChevronRight, Workflow, X } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { useMe } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace";

const navItems = [
  { to: "/app", icon: LayoutDashboard, label: "Dashboard" }, { to: "/leads", icon: Users, label: "Leads" },
  { to: "/imports", icon: FileInput, label: "Imports" }, { to: "/intelligence", icon: ScanLine, label: "Intelligence" },
  { to: "/outbound", icon: Send, label: "Outbound" }, { to: "/conversations", icon: MessageSquare, label: "Conversations" },
  { to: "/activity", icon: Activity, label: "Activity" },
];
export function Sidebar({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void } = {}) {
  const savedCollapse = useWorkspaceStore(state => state.sidebarCollapsed), toggle = useWorkspaceStore(state => state.toggleSidebar), collapsed = !mobile && savedCollapse;
  const location = useLocation(), { data: me } = useMe();
  const navigation = me?.user.role === "OWNER" ? [...navItems, { to: "/workflows", icon: Workflow, label: "Workflows" }, { to: "/event-recovery", icon: Activity, label: "Event recovery" }] : navItems;
  function link(item: typeof navItems[number]) {
    const active = location.pathname === item.to || location.pathname.startsWith(item.to + "/");
    return <NavLink key={item.to} to={item.to} aria-label={item.label} title={collapsed ? item.label : undefined} onClick={onNavigate} className={cn("relative flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand", active ? "bg-brand-light text-brand-strong before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-full before:bg-brand" : "text-sidebar-muted hover:bg-soft hover:text-ink", collapsed && "justify-center px-0")}><item.icon className="h-4.5 w-4.5 shrink-0" strokeWidth={1.7} aria-hidden="true" />{!collapsed && <span className="truncate">{item.label}</span>}</NavLink>;
  }
  return <aside aria-label={mobile ? "Mobile workspace sidebar" : "Workspace sidebar"} className={cn("h-dvh shrink-0 flex-col border-r border-line bg-sidebar text-sidebar-text", mobile ? "flex w-full" : "sticky top-0 hidden transition-[width] duration-200 motion-reduce:transition-none md:flex", !mobile && (collapsed ? "w-[72px]" : "w-60"))}>
    <div className={cn("flex min-h-24 shrink-0 items-center gap-3 px-5 py-5", collapsed && "justify-center px-0")}><BrandMark className="h-8 w-8 shrink-0 text-brand" />{!collapsed && <div className="min-w-0 flex-1"><span className="block text-[23px] font-semibold leading-none tracking-[-0.06em]">Relay<span className="text-brand">.</span></span></div>}{mobile && <button type="button" autoFocus aria-label="Close workspace navigation" className="flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-soft focus-visible:outline-2 focus-visible:outline-brand" onClick={onNavigate}><X size={20} aria-hidden="true" /></button>}</div>
    {!collapsed && <p className="mx-5 mb-5 border-b border-line pb-5 text-[10px] leading-relaxed text-sidebar-muted">AI Lead Intelligence<br />&amp; Outbound Automation</p>}
    <nav aria-label="Workspace pages" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-5">{!collapsed && <span className="px-3 pb-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted">Workspace</span>}{navigation.map(link)}</nav>
    <div className="mx-3 flex shrink-0 flex-col gap-1 border-t border-line pb-3 pt-3">{link({ to: "/settings", icon: Settings, label: "Settings" })}{!mobile && <button type="button" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={toggle} className="flex min-h-11 items-center justify-center gap-3 rounded-md px-3 py-2 text-xs text-sidebar-muted transition-colors hover:bg-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-brand">{collapsed ? <ChevronRight className="h-4 w-4" aria-hidden="true" /> : <><ChevronLeft className="h-4 w-4" aria-hidden="true" /><span>Collapse sidebar</span></>}</button>}</div>
  </aside>;
}
