import { create } from "zustand";

interface UIState {
  /**
   * Whether the drawer is open. The navigator owns this; `Sidebar` mirrors it
   * here so the layout — which sits OUTSIDE the drawer's context and cannot
   * call `useDrawerStatus` — can keep the floating bottom stack from covering
   * an open drawer. On a large screen the drawer is permanent and this is
   * always true, so read it together with the breakpoint.
   */
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  shortcutsDialogOpen: boolean;

  setSidebarOpen: (open: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setShortcutsDialogOpen: (open: boolean) => void;
  toggleShortcutsDialog: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: false,
  sidebarCollapsed: false,
  shortcutsDialogOpen: false,

  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebarCollapsed: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setShortcutsDialogOpen: (open) => set({ shortcutsDialogOpen: open }),
  toggleShortcutsDialog: () =>
    set((state) => ({ shortcutsDialogOpen: !state.shortcutsDialogOpen })),
}));
