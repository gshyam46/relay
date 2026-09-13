import {useIsFetching} from "@tanstack/react-query";
import {LoadingScreen} from "@/components/loading-screen";
import { Suspense, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Menu, Zap } from "lucide-react";
import { Sidebar } from "./sidebar";

export function AppShell() {
  const fetching = useIsFetching();
  const [open, setOpen] = useState(false), dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null), location = useLocation();
  useEffect(() => { if (open && !dialog.current?.open) dialog.current?.showModal(); if (!open && dialog.current?.open) dialog.current.close(); }, [open]);
  useEffect(() => { setOpen(false); }, [location.pathname, location.search]);
  useEffect(() => { const media = matchMedia("(min-width: 768px)"), changed = () => { if (media.matches) setOpen(false); }; media.addEventListener("change", changed); return () => media.removeEventListener("change", changed); }, []);
  function keepFocus(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(element => element.getClientRects().length);
    const first = controls[0], last = controls.at(-1); if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function closed() { setOpen(false); if (trigger.current?.getClientRects().length) trigger.current.focus(); }
  return <div className="flex h-dvh w-full flex-col overflow-hidden md:flex-row">
    <Sidebar />
    <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 md:hidden"><a href="/app" className="inline-flex min-h-11 items-center gap-2 font-semibold text-ink"><Zap size={18} className="text-brand" aria-hidden="true" />Relay</a><button ref={trigger} type="button" aria-label="Open workspace navigation" aria-haspopup="dialog" aria-controls="mobile-workspace-navigation" aria-expanded={open} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm focus-visible:outline-2 focus-visible:outline-brand" onClick={() => setOpen(true)}><Menu size={18} aria-hidden="true" />Menu</button></div>
    <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{fetching > 0 && <div className="workspace-fetch-progress" role="progressbar" aria-label="Loading workspace data"><span/></div>}<Suspense fallback={<LoadingScreen compact />}><Outlet /></Suspense></main>
    <dialog ref={dialog} id="mobile-workspace-navigation" aria-label="Workspace navigation" className="m-0 h-dvh max-h-none w-[min(20rem,90vw)] max-w-none border-0 bg-sidebar p-0 text-sidebar-text backdrop:bg-black/50" onKeyDown={keepFocus} onCancel={event => { event.preventDefault(); setOpen(false); }} onClose={closed} onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}><Sidebar mobile onNavigate={() => setOpen(false)} /></dialog>
  </div>;
}
