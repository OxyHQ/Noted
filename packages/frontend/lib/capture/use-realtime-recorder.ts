/**
 * Recording that transcribes as it goes — the neutral build.
 *
 * Metro resolves `use-realtime-recorder.native.ts` on a device. This file is
 * what everything else gets: a browser, `tsc`, any bundler that does not know
 * the platform convention. It must not import whisper.rn, which is a native
 * library — doing so would break the web bundle and typechecking alike.
 *
 * It is inert rather than absent, so the caller can hold the hook
 * unconditionally and let `enabled` decide. React does not allow a hook to be
 * called conditionally, and "which engine records" is exactly a condition.
 */

import type { Recorder } from '@/lib/capture/recording';
import type { SttModelId } from '@/lib/stt/models';

export interface RealtimeRecorderOptions {
  model: SttModelId;
  /** BCP-47 code, or `auto`. */
  language: string;
  notification: { title: string; body: string };
}

export function useRealtimeRecorder(
  _captureId: string,
  _noteId: string,
  _enabled: boolean,
  _options: RealtimeRecorderOptions,
): Recorder {
  return {
    phase: 'idle',
    levels: null,
    durationMs: 0,
    partialText: '',
    stop: () => Promise.resolve('noop'),
  };
}

/** Whether this build can record and transcribe at the same time. */
export function isRealtimeCaptureSupported(): boolean {
  return false;
}

/** Never, here: without whisper.cpp there is nothing for a model to drive. */
export function isModelReady(): boolean {
  return false;
}
