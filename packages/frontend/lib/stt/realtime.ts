/**
 * Transcribing while the recording happens — the neutral build.
 *
 * Metro resolves `realtime.native.ts` on a device. This file is what a browser,
 * `tsc` and any non-Metro bundler get, so it must not import whisper.rn: that is
 * a native library, and pulling it in here would break the web bundle and
 * typechecking alike.
 *
 * The contract lives here so both sides are declared once, and calling it fails
 * loudly rather than silently doing nothing — a caller that reaches this has
 * already decided the platform supports live capture, and a quiet no-op would
 * turn that mistake into a recording with no transcript and no explanation.
 */

import type { SttModelId } from '@/lib/stt/models';

export interface RealtimeSession {
  /**
   * Stop, and report where the recording ended up.
   *
   * The path is returned rather than assumed because the two platforms differ:
   * a phone is told where to write and writes there, while a browser produces a
   * blob whose URL exists only once the recording is finished.
   */
  stop: () => Promise<string | null>;
}

export interface RealtimeOptions {
  captureId: string;
  model: SttModelId;
  /** BCP-47 code, or `auto`. */
  language: string;
  /** Where the recording is saved, relative to the document directory. */
  audioPath: string;
  /** Called after new segments are persisted, so the caller can restructure. */
  onTranscriptChanged?: () => void;
  /** Loudness in dBFS, for the waveform. Called on the audio stream's schedule. */
  onLevel?: (db: number) => void;
  onError?: (message: string) => void;
}

export function startRealtimeTranscription(_options: RealtimeOptions): Promise<RealtimeSession> {
  return Promise.reject(
    new Error('live transcription needs a native build; this platform has no whisper.cpp'),
  );
}
