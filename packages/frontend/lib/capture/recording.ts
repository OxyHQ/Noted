/**
 * What a recorder is, and how its levels are drawn.
 *
 * Two engines record: `expo-audio` writes a compressed file and reports a meter,
 * and on a device with a speech model whisper.rn owns the microphone instead,
 * streaming raw PCM so it can transcribe while the meeting runs. They produce
 * the same thing for the user — a waveform, a timer, a saved recording — so the
 * contract and the level maths live here rather than being written twice and
 * drifting into two different-looking waveforms.
 *
 * Pure on purpose: no audio library, no React, so the arithmetic is testable.
 */

/** How many bars the waveform keeps. */
export const WAVEFORM_BARS = 48;

/**
 * Quietest level mapped to an empty bar, in dBFS. Below this is room tone rather
 * than speech, and drawing it makes silence look like it is being recorded.
 */
export const METERING_FLOOR_DB = -50;

export type RecorderPhase =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'saving'
  | 'saved'
  /** The user declined the microphone, or the system withheld it. */
  | 'denied'
  /**
   * Anything else went wrong. Deliberately NOT reported as a permission problem:
   * a message that names a cause it does not know sends the user to fix a
   * setting that was never the issue.
   */
  | 'error';

export type StopOutcome = 'saved' | 'failed' | 'noop';

export interface Recorder {
  phase: RecorderPhase;
  /** Recent levels, 0–1, oldest first. Null until the first sample. */
  levels: number[] | null;
  durationMs: number;
  stop: () => Promise<StopOutcome>;
}

/** Map a meter reading in dBFS onto the 0–1 height of a bar. */
export function dbToLevel(db: number): number {
  return Math.min(1, Math.max(0, (db - METERING_FLOOR_DB) / -METERING_FLOOR_DB));
}

/**
 * The loudness of a block of 16-bit PCM, as dBFS.
 *
 * Read through a `DataView` rather than an `Int16Array` view: the byte offset of
 * a chunk handed over by the native stream is not guaranteed to be even, and a
 * typed-array view on an odd offset throws.
 *
 * @returns `METERING_FLOOR_DB` for silence, so callers never see `-Infinity`.
 */
export function pcmToDb(bytes: Uint8Array): number {
  const sampleCount = Math.floor(bytes.byteLength / 2);
  if (sampleCount === 0) return METERING_FLOOR_DB;

  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
  let sumOfSquares = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = view.getInt16(index * 2, true) / 32_768;
    sumOfSquares += sample * sample;
  }

  const rms = Math.sqrt(sumOfSquares / sampleCount);
  if (rms <= 0) return METERING_FLOOR_DB;
  return Math.max(METERING_FLOOR_DB, 20 * Math.log10(rms));
}

/** Append a level, keeping the window a fixed width so the waveform scrolls. */
export function pushLevel(levels: number[] | null, level: number): number[] {
  return [...(levels ?? Array<number>(WAVEFORM_BARS).fill(0)).slice(1), level];
}
