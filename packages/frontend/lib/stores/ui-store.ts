import { create } from "zustand";

interface UIState {
  sidebarCollapsed: boolean;
  shortcutsDialogOpen: boolean;

  toggleSidebarCollapsed: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setShortcutsDialogOpen: (open: boolean) => void;
  toggleShortcutsDialog: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  shortcutsDialogOpen: false,

  toggleSidebarCollapsed: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setShortcutsDialogOpen: (open) => set({ shortcutsDialogOpen: open }),
  toggleShortcutsDialog: () =>
    set((state) => ({ shortcutsDialogOpen: !state.shortcutsDialogOpen })),
}));
