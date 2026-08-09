import { create } from "zustand";

/** How long the undo snackbar stays before auto-dismissing. */
const UNDO_TIMEOUT_MS = 5000;

/**
 * The one undo offer on screen, if any.
 *
 * It lives in a store for the same reason the capture store does: the action
 * that offers the undo happens on a screen, but the snackbar is drawn by the
 * layout, stacked above the record button so the two cannot cover each other.
 * A screen-owned snackbar sits inside the navigator and loses to that button on
 * every paint, whatever z-index it asks for.
 *
 * Not persisted: an undo that outlived a reload would offer to reverse
 * something the user finished with several minutes ago.
 */
interface UndoState {
  /** What was done, e.g. "Note archived". */
  message: string | null;
  /** Reverses it. Null whenever there is nothing to undo. */
  onUndo: (() => void) | null;

  showUndo: (message: string, onUndo: () => void) => void;
  dismissUndo: () => void;
}

/**
 * Module scope rather than store state: it is not rendered, and keeping it out
 * of the state means a running countdown never re-renders anything.
 */
let timer: ReturnType<typeof setTimeout> | null = null;

function clearTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

export const useUndoStore = create<UndoState>()((set) => ({
  message: null,
  onUndo: null,

  showUndo: (message, onUndo) => {
    // A second action replaces the first: one offer at a time, and its timer
    // starts over rather than inheriting whatever was left of the last one.
    clearTimer();
    set({ message, onUndo });
    timer = setTimeout(() => {
      timer = null;
      set({ message: null, onUndo: null });
    }, UNDO_TIMEOUT_MS);
  },

  dismissUndo: () => {
    clearTimer();
    set({ message: null, onUndo: null });
  },
}));
