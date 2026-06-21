import { create } from "zustand";

/**
 * Small app-wide ephemeral UI state that doesn't belong to a feature store.
 * Notes-specific UI lives in `notes-ui-store.ts`; sidebar/layout lives in
 * `ui-store.ts`.
 */
interface StoreState {
  /** Vertical scroll position of the active list, used for header effects. */
  scrollY: number;
  setScrollY: (value: number) => void;

  /** Request the quick-capture composer on the home screen to focus. */
  composerFocusRequest: number;
  requestComposerFocus: () => void;
}

export const useStore = create<StoreState>((set) => ({
  scrollY: 0,
  setScrollY: (value: number) => set({ scrollY: value }),

  composerFocusRequest: 0,
  requestComposerFocus: () =>
    set((s) => ({ composerFocusRequest: s.composerFocusRequest + 1 })),
}));
