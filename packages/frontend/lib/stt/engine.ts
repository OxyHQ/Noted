/**
 * The speech-to-text engine, as the rest of the app sees it.
 *
 * Platform-split: Metro resolves `engine.native.ts` on a device and
 * `engine.web.ts` in a browser. This neutral file is what a non-Metro resolver
 * (tsc, a bundler that does not know the convention) gets, so it must not import
 * anything native — importing `whisper.rn` here would break the web build and
 * typechecking alike.
 */

import type { TranscriptSegment } from '@/lib/capture/captures-repo';
import type { SttModelId } from '@/lib/stt/models';

export interface TranscribeRequest {
  /** Absolute path to the recorded audio. */
  audioPath: string;
  captureId: string;
  model: SttModelId;
  /** BCP-47-ish hint, or `auto` to let the model decide. */
  language: string;
  /** Segments as they are recognised, so a long recording shows progress. */
  onSegments?: (segments: TranscriptSegment[]) => void;
}

export interface SttEngine {
  /** Whether this build can transcribe at all. */
  isSupported(): boolean;
  /**
   * Transcribe a recording.
   *
   * @returns every segment, in time order. The same segments are delivered to
   *   `onSegments` as they arrive; the return value is the complete set, so a
   *   caller that ignores the callback still gets everything.
   */
  transcribe(request: TranscribeRequest): Promise<TranscriptSegment[]>;
}

/** The engine for this platform. */
export function getSttEngine(): SttEngine {
  return {
    isSupported: () => false,
    transcribe: () =>
      Promise.reject(new Error('speech-to-text is not available on this platform')),
  };
}
