import { create } from "zustand";

/**
 * Which recording is running, if any.
 *
 * Deliberately NOT persisted, unlike the UI store next to it: this describes a
 * live microphone, and a microphone does not survive the process. What DOES
 * survive is the `captures` row, which is written before recording starts and
 * recovered on the next launch — so persisting this would only add a second,
 * emptier source of truth that can disagree with it.
 *
 * It exists because the control and the indicator live in different places: the
 * record button is on a screen, the recording bar is in the layout above every
 * screen, and both need to agree on one recording without one owning the other.
 */
interface CaptureState {
  /** The capture currently recording, or null. */
  captureId: string | null;
  /** The note that recording belongs to. */
  noteId: string | null;

  startCapture: (captureId: string, noteId: string) => void;
  clearCapture: () => void;
}

export const useCaptureStore = create<CaptureState>()((set) => ({
  captureId: null,
  noteId: null,

  startCapture: (captureId, noteId) => set({ captureId, noteId }),
  clearCapture: () => set({ captureId: null, noteId: null }),
}));

/** Whether a recording is running right now. */
export function useIsRecording(): boolean {
  return useCaptureStore((s) => s.captureId !== null);
}
