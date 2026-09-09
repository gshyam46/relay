import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Organization } from "@/types";

interface WorkspaceState {
  currentOrg: Organization | null;
  setCurrentOrg: (org: Organization | null) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      currentOrg: null,
      setCurrentOrg: (org) => set({ currentOrg: org }),
      sidebarCollapsed: false,
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    {
      name: "relay-workspace",
      partialize: (state) => ({
        currentOrg: state.currentOrg,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    },
  ),
);
