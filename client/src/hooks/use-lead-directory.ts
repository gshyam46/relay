import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { api } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";
import type { DirectoryFilters, LeadDirectory } from "@/types/lead-data";
export interface DirectoryView extends DirectoryFilters { selected: string[]; cursors: (string | null)[]; page: number }
const empty: DirectoryView = { search: "", source: "", status: "", archive: "ACTIVE", selected: [], cursors: [null], page: 0 };
// In-memory, workspace-scoped view state retains explicit selection while navigating.
// It is not persisted or treated as authority for the export's actual records.
const useViews = create<{ views: Record<string, DirectoryView>; change: (org: string, update: (current: DirectoryView) => DirectoryView) => void }>(set => ({ views: {}, change: (org, update) => set(state => ({ views: { ...state.views, [org]: update(state.views[org] || empty) } })) }));
export function useLeadDirectory() {
  const org = useWorkspaceStore(s => s.currentOrg), orgId = org?.id || "";
  const view = useViews(s => s.views[orgId] || empty), change = useViews(s => s.change);
  const cursor = view.cursors[view.page] || null;
  const params = new URLSearchParams({ archive: view.archive, limit: "50" });
  for (const key of ["search", "source", "status"] as const) if (view[key]) params.set(key, view[key]);
  if (cursor) params.set("cursor", cursor);
  const query = useQuery({ queryKey: ["lead-directory", orgId, view.search, view.source, view.status, view.archive, cursor], queryFn: () => api.get<LeadDirectory>("/leads/directory?" + params), enabled: !!org, retry: false });
  return { query, view,
    filters: (fields: Partial<DirectoryFilters>) => change(orgId, previous => ({ ...previous, ...fields, page: 0, cursors: [null] })),
    select: (ids: string[], checked: boolean) => change(orgId, previous => { const next = checked ? [...new Set([...previous.selected, ...ids])] : previous.selected.filter(id => !ids.includes(id)); return next.length <= 1000 ? { ...previous, selected: next } : previous; }),
    clear: () => change(orgId, previous => ({ ...previous, selected: [] })),
    previous: () => change(orgId, previous => ({ ...previous, page: Math.max(0, previous.page - 1) })),
    next: () => { if (query.data?.next_cursor) change(orgId, previous => ({ ...previous, page: previous.page + 1, cursors: [...previous.cursors.slice(0, previous.page + 1), query.data!.next_cursor] })); },
  };
}
