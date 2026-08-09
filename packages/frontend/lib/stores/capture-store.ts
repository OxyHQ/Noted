import { create } from "zustand";

import type { RecorderPhase, StopOutcome } from "@/lib/capture/recording";

/**
 * Which recording is running, if any, and what it looks like right now.
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
 *
 * The `live` fields exist for a sharper reason. The indicator has to be drawn in
 * TWO places — inside the drawer's scenes, so an open sidebar covers it the way
 * it covers the rest of the screen, and inside the note editor, which is a
 * sibling route painted above all of them — and two copies of the engine would
 * be two microphones fighting over one device. So `CaptureEngineHost` mounts the
 * engine once and publishes here; everything else only reads.
 */
interface CaptureState {
  /** The capture currently recording, or null. */
  captureId: string | null;
  /** The note that recording belongs to. */
  noteId: string | null;

  /** What the engine is doing. `idle` whenever nothing is recording. */
  phase: RecorderPhase;
  /** Recent input levels, for the waveform. Null until the first sample. */
  levels: number[] | null;
  /** How long the recording has been running. */
  durationMs: number;
  /**
   * What is being said right now, before it is part of the transcript. Empty
   * where the engine cannot produce it — every native build today.
   */
  partialText: string;
  /**
   * Ends the recording. Null when nothing is recording, and owned by the engine
   * host: the indicator can only ask, since it does not hold the microphone.
   */
  stop: (() => Promise<StopOutcome>) | null;

  startCapture: (captureId: string, noteId: string) => void;
  clearCapture: () => void;
  /** Called by `CaptureEngineHost` as the recording progresses. */
  publishLive: (live: {
    phase: RecorderPhase;
    levels: number[] | null;
    durationMs: number;
    partialText: string;
    stop: () => Promise<StopOutcome>;
  }) => void;
}

const IDLE = {
  phase: "idle" as RecorderPhase,
  levels: null as number[] | null,
  durationMs: 0,
  partialText: "",
  stop: null,
};

export const useCaptureStore = create<CaptureState>()((set) => ({
  captureId: null,
  noteId: null,
  ...IDLE,

  startCapture: (captureId, noteId) => set({ captureId, noteId }),
  clearCapture: () => set({ captureId: null, noteId: null, ...IDLE }),
  publishLive: (live) => set(live),
}));

/** Whether a recording is running right now. */
export function useIsRecording(): boolean {
  return useCaptureStore((s) => s.captureId !== null);
}
