/**
 * Transcription in the Noted Desktop shell, by the `whisper.cpp` sidecar.
 *
 * The shell's webview has no WebGPU and no threads, so the in-browser Whisper the
 * web build uses would be slow WASM there (`docs/desktop-audio.mdx`). Rust runs the
 * same engine the phones do (`desktop/src-tauri/src/stt.rs`); this is the web app's
 * side of that command. It hands back the segments the rest of the app already
 * knows how to store, so nothing downstream can tell which engine produced them.
 *
 * `invoke` is injected so this runs in tests without a window.
 */

import { makeSegment, type TranscriptSegment } from '@/lib/capture/captures-repo';
import { DESKTOP_MODEL_FILES } from '@/lib/stt/desktop-model-files';
import type { SttModelId } from '@/lib/stt/models';

export { DESKTOP_MODEL_FILES };
import type { Invoke } from '@/lib/db/desktop-driver';

const SAMPLE_RATE = 16_000;

/**
 * How much audio crosses the bridge in one call.
 *
 * The samples travel as base64 text: an hour of audio in one call would be ~300 MB
 * of it, held several times over on the way. Thirty seconds is ~2.6 MB and still
 * long enough that a word cut at the seam is the exception.
 */
export const SLICE_SECONDS = 30;
const SLICE_SAMPLES = SLICE_SECONDS * SAMPLE_RATE;

/** What the desktop uses until it has a model setting of its own. Pinned to the catalogue's default by a test. */
export const DESKTOP_DEFAULT_MODEL: SttModelId = 'base';

/** The model is not on disk yet, so there is nothing to transcribe with. */
export class DesktopModelMissingError extends Error {
  constructor() {
    super('the speech model has not been downloaded on this computer');
    this.name = 'DesktopModelMissingError';
  }
}

/** Little-endian `f32` bytes as base64: what `stt_transcribe` decodes. */
export function encodeSamples(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  // In chunks: spreading a large array into `fromCharCode` overflows the stack.
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

/**
 * `whisper.cpp` takes a bare language code, or `auto` — and unlike the in-browser
 * engine it really detects the language for `auto`, so that is passed through
 * rather than guessed from the browser. `pt-BR` is `pt` to whisper; anything that
 * is not a code becomes `auto` rather than an error.
 */
export function whisperLanguage(requested: string): string {
  if (requested === 'auto') return 'auto';
  const base = requested.split(/[-_]/)[0]?.toLowerCase() ?? '';
  return /^[a-z]{2,3}$/.test(base) ? base : 'auto';
}

/** Non-speech markers whisper emits ("[BLANK_AUDIO]", "[Music]"); nobody said them. */
const NON_SPEECH = /^\[.*\]$/;

interface RustSegment {
  text: string;
  startMs: number;
  endMs: number;
}

export interface DesktopTranscription {
  captureId: string;
  language: string;
  model?: SttModelId;
  /** Added to every timestamp: a slice starts counting from zero. */
  offsetMs?: number;
  /** Names which slice, so a retried slice lands on the same ids. */
  sliceIndex?: number;
}

export function createDesktopTranscriber(getInvoke: () => Promise<Invoke>) {
  async function transcribeSlice(
    samples: Float32Array,
    request: DesktopTranscription,
    offsetMs: number,
    sliceIndex: number,
  ): Promise<TranscriptSegment[]> {
    const invoke = await getInvoke();
    let found: RustSegment[];
    try {
      found = await invoke<RustSegment[]>('stt_transcribe', {
        samples: encodeSamples(samples),
        language: whisperLanguage(request.language),
        model: DESKTOP_MODEL_FILES[request.model ?? DESKTOP_DEFAULT_MODEL],
      });
    } catch (error) {
      // The command reports a missing model with a fixed word; everything else is a
      // real failure and keeps its message.
      if (String(error) === 'model_missing' || (error as Error)?.message === 'model_missing') {
        throw new DesktopModelMissingError();
      }
      throw error;
    }

    return found
      .map((segment, index) =>
        makeSegment({
          captureId: request.captureId,
          sliceIndex,
          segmentIndex: index,
          startMs: offsetMs + segment.startMs,
          endMs: offsetMs + segment.endMs,
          text: segment.text.trim(),
        }),
      )
      .filter((segment) => segment.text !== '' && !NON_SPEECH.test(segment.text));
  }

  return {
    /** One slice of audio, as the live recorder hands them over. */
    transcribe(samples: Float32Array, request: DesktopTranscription): Promise<TranscriptSegment[]> {
      return transcribeSlice(samples, request, request.offsetMs ?? 0, request.sliceIndex ?? 0);
    },

    /**
     * A whole recording: cut into `SLICE_SECONDS` pieces, each timestamped from its
     * place in the recording, delivered to `onSegments` as it finishes.
     */
    async transcribeRecording(
      samples: Float32Array,
      request: DesktopTranscription,
      onSegments?: (segments: TranscriptSegment[]) => void,
    ): Promise<TranscriptSegment[]> {
      const all: TranscriptSegment[] = [];
      for (let start = 0, slice = 0; start < samples.length; start += SLICE_SAMPLES, slice += 1) {
        const piece = samples.subarray(start, Math.min(start + SLICE_SAMPLES, samples.length));
        const offsetMs = Math.round((start / SAMPLE_RATE) * 1000);
        const segments = await transcribeSlice(piece, request, offsetMs, slice);
        if (segments.length > 0) {
          all.push(...segments);
          onSegments?.(segments);
        }
      }
      return all;
    },
  };
}
