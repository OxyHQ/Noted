/**
 * Transcription in a browser, with transformers.js.
 *
 * Same promise as the phone: the audio never leaves the machine. The model is
 * ONNX rather than whisper.cpp — a browser cannot load a native library — and it
 * runs on WebGPU where that exists and on WASM where it does not.
 *
 * ## What is deliberately different from the phone
 *
 * The phone transcribes WHILE recording, streaming PCM into whisper.cpp. A
 * browser tab cannot: `expo-audio` records through `MediaRecorder`, which hands
 * back a finished blob rather than a live sample stream. So here the recording
 * is transcribed when it stops. The note still writes itself, a moment later
 * rather than as people speak.
 *
 * ## Why the import is dynamic
 *
 * transformers.js and its ONNX runtime are megabytes of JavaScript. Loading them
 * in the entry bundle would make every page load slower for every user,
 * including everyone who never records anything. They are fetched the first time
 * somebody actually transcribes.
 */

import { createLogger } from '@oxyhq/core/logger';

import type { TranscriptSegment } from '@/lib/capture/captures-repo';
import { newNoteId } from '@/lib/db/ids';
import type { SttEngine, TranscribeRequest } from '@/lib/stt/engine';

const logger = createLogger('NotedSTT');

/**
 * Whisper is trained on 16 kHz mono, and expects exactly that. Anything else is
 * resampled somewhere; doing it here, once, is the cheap place.
 */
const SAMPLE_RATE = 16_000;

/**
 * The ONNX build of whisper-base.
 *
 * `base` for the same reason the phone defaults to it: it holds Spanish proper
 * nouns together, which is most of what a meeting note is made of, and `tiny`
 * does not. Quantised, so it is tens of megabytes rather than hundreds.
 */
const MODEL_ID = 'onnx-community/whisper-base';

/** Transcribed in chunks this long, with whisper's usual overlap between them. */
const CHUNK_SECONDS = 30;

/** whisper's timestamps arrive in seconds. */
const SECONDS_TO_MS = 1000;

interface TimestampedChunk {
  text: string;
  timestamp: [number, number | null];
}

/**
 * One loaded pipeline per page.
 *
 * Building it downloads and compiles the model, which is seconds and a lot of
 * memory, so a second recording in the same session reuses it.
 */
let pipelinePromise: Promise<unknown> | null = null;

async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    // A browser that exposes `navigator.gpu` and then refuses to hand out an
    // adapter (a blocklisted driver, a headless context) must fall back rather
    // than fail the transcription.
    return false;
  }
}

interface TranscriberOutput {
  text?: string;
  chunks?: TimestampedChunk[];
}

type Transcriber = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<TranscriberOutput>;

async function getTranscriber(): Promise<Transcriber> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      const device = (await hasWebGpu()) ? 'webgpu' : 'wasm';
      logger.info('Loading the browser speech model', { device });
      return pipeline('automatic-speech-recognition', MODEL_ID, { device });
    })().catch((error: unknown) => {
      // Cleared so a later attempt can retry: the usual cause is a network
      // failure fetching the weights, which is not permanent.
      pipelinePromise = null;
      throw error;
    });
  }
  return pipelinePromise as Promise<Transcriber>;
}

/**
 * Decode a recording into the mono 16 kHz samples whisper wants.
 *
 * `decodeAudioData` handles whatever container `MediaRecorder` produced, and
 * `OfflineAudioContext` does the resampling — asking the browser to do it is
 * both faster and more correct than resampling by hand.
 */
async function decodeToSamples(audioPath: string): Promise<Float32Array> {
  const response = await fetch(audioPath);
  const encoded = await response.arrayBuffer();

  const decodeContext = new AudioContext();
  try {
    const decoded = await decodeContext.decodeAudioData(encoded);
    const frames = Math.ceil((decoded.duration * SAMPLE_RATE) | 0) || 1;
    const offline = new OfflineAudioContext(1, frames, SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const resampled = await offline.startRendering();
    return resampled.getChannelData(0);
  } finally {
    // Browsers cap how many AudioContexts a page may hold, and a recording per
    // meeting would reach it in an afternoon.
    await decodeContext.close();
  }
}

/**
 * Non-speech markers whisper emits ("[BLANK_AUDIO]", "[Music]"). Nobody said
 * them, so they are not transcript.
 */
const NON_SPEECH = /^\[.*\]$/;

function toSegments(
  chunks: readonly TimestampedChunk[],
  captureId: string,
): TranscriptSegment[] {
  return chunks
    .map((chunk) => {
      const [start, end] = chunk.timestamp;
      return {
        id: newNoteId(),
        captureId,
        startMs: Math.round(start * SECONDS_TO_MS),
        // The final chunk of a recording has no end timestamp.
        endMs: Math.round((end ?? start) * SECONDS_TO_MS),
        text: chunk.text.trim(),
        confidence: null,
        speakerHint: null,
      };
    })
    .filter((segment) => segment.text !== '' && !NON_SPEECH.test(segment.text));
}

export function getSttEngine(): SttEngine {
  return {
    // `AudioContext` is the honest test: a context without it cannot decode a
    // recording, whatever else it supports.
    isSupported: () => typeof AudioContext !== 'undefined',

    async transcribe(request: TranscribeRequest): Promise<TranscriptSegment[]> {
      const samples = await decodeToSamples(request.audioPath);
      const transcribe = await getTranscriber();

      const output = await transcribe(samples, {
        chunk_length_s: CHUNK_SECONDS,
        return_timestamps: true,
        language: request.language === 'auto' ? undefined : request.language,
      });

      const segments = toSegments(output.chunks ?? [], request.captureId);
      request.onSegments?.(segments);
      logger.info('Browser transcription finished', { segments: segments.length });
      return segments;
    },
  };
}
