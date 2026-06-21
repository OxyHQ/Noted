import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NoteView } from "@/lib/types/note";

export type ViewMode = "grid" | "list";

interface NotesUIState {
  /** Card layout for the home/archive/trash lists. Persisted. */
  viewMode: ViewMode;
  /** Which collection the home screen shows. */
  activeView: NoteView;
  /** Label id the home screen is filtered to, if any. */
  activeLabel: string | null;
  /** Live search text applied to the active list. */
  searchQuery: string;
  /** Whether multi-select mode is active. */
  selectionMode: boolean;
  /** Currently selected note ids (multi-select). */
  selectedIds: Set<string>;

  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
  setActiveView: (view: NoteView) => void;
  setActiveLabel: (labelId: string | null) => void;
  setSearchQuery: (q: string) => void;

  enterSelection: (id: string) => void;
  toggleSelected: (id: string) => void;
  clearSelection: () => void;
  isSelected: (id: string) => boolean;
}

export const useNotesUIStore = create<NotesUIState>()(
  persist(
    (set, get) => ({
      viewMode: "grid",
      activeView: "active",
      activeLabel: null,
      searchQuery: "",
      selectionMode: false,
      selectedIds: new Set<string>(),

      setViewMode: (viewMode) => set({ viewMode }),
      toggleViewMode: () =>
        set((s) => ({ viewMode: s.viewMode === "grid" ? "list" : "grid" })),
      setActiveView: (activeView) => set({ activeView }),
      setActiveLabel: (activeLabel) => set({ activeLabel }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),

      enterSelection: (id) =>
        set({ selectionMode: true, selectedIds: new Set<string>([id]) }),

      toggleSelected: (id) =>
        set((s) => {
          const next = new Set(s.selectedIds);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return {
            selectedIds: next,
            selectionMode: next.size > 0,
          };
        }),

      clearSelection: () =>
        set({ selectionMode: false, selectedIds: new Set<string>() }),

      isSelected: (id) => get().selectedIds.has(id),
    }),
    {
      name: "notes-ui-storage",
      storage: createJSONStorage(() => AsyncStorage),
      // Only the layout preference is durable; selection + filters are ephemeral.
      partialize: (state) => ({ viewMode: state.viewMode }),
    }
  )
);
