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

import { makeSegment, type TranscriptSegment } from '@/lib/capture/captures-repo';
import type { SttEngine, TranscribeRequest } from '@/lib/stt/engine';

const logger = createLogger('NotedSTT');

/**
 * Whisper is trained on 16 kHz mono, and expects exactly that. Anything else is
 * resampled somewhere; doing it here, once, is the cheap place.
 */
export const SAMPLE_RATE = 16_000;

/**
 * The ONNX build of whisper-base.
 *
 * `base` for the same reason the phone defaults to it: it holds Spanish proper
 * nouns together, which is most of what a meeting note is made of, and `tiny`
 * does not. Quantised, so it is tens of megabytes rather than hundreds.
 */
const MODEL_ID = 'onnx-community/whisper-base';

/**
 * Which quantisation of each half to load.
 *
 * transformers.js defaults to `q8` on WASM, and that decoder does not load: the
 * runtime refuses the graph at session creation with a failure on
 * `decoder.embed_tokens.weight_transposed_DequantizeLinear`. Whichever side is
 * at fault, it is not usable, so the decoder is pinned to `q4` — which is the
 * quantisation Hugging Face's own whisper demos use.
 *
 * The encoder stays at `q8`, because the encoder was never the problem and it is
 * 23 MB against 82 MB unquantised.
 *
 * Sizes, read from the registry: encoder q8 23 MB, decoder q4 124 MB. Fetched
 * once and then cached by the browser.
 */
/**
 * Which quantisation of each half to load, per device.
 *
 * The decoder is `q4` on both. transformers.js defaults to `q8` on WASM and
 * that decoder does not load at all: the runtime refuses the graph at session
 * creation, on `decoder.embed_tokens.weight_transposed_DequantizeLinear`.
 *
 * The encoder differs on purpose. On a GPU it is `fp32`, which is what
 * Xenova's `realtime-whisper-webgpu` uses with this exact model — the encoder is
 * where audio becomes features, so quantising it costs more accuracy than
 * quantising the decoder, and a GPU has the memory for it. On WASM it stays
 * `q8`: 23 MB against 82 MB, on the path that is already slow enough without
 * three times the weights.
 *
 * Sizes read from the registry: encoder fp32 82 MB / q8 23 MB, decoder q4
 * 124 MB. Fetched once and then cached by the browser.
 */
const DTYPES = {
  webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
  wasm: { encoder_model: 'q8', decoder_model_merged: 'q4' },
} as const;

/**
 * What to try if the pinned pair is also refused.
 *
 * Unquantised is 290 MB and always loadable. A bad first choice and a good last
 * one: a graph a particular browser will not accept is not something this code
 * can reason about, and no transcription at all is worse than a large download.
 */
const FALLBACK_DTYPES = { encoder_model: 'fp32', decoder_model_merged: 'fp32' } as const;

/** Where `scripts/copy-ort-runtime.ts` puts the WebAssembly runtime, served from `public/`. */
const ORT_RUNTIME_PATH = '/ort/';

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
      const { pipeline, env } = await import('@huggingface/transformers');

      // onnxruntime-web fetches its WebAssembly runtime by URL at load time
      // rather than through the bundler, and the build this app resolves (see
      // `metro.config.js`) carries no embedded copy — so without this it looks
      // for the runtime beside the page and gets the app's HTML instead.
      // `scripts/copy-ort-runtime.ts` puts the files here.
      const wasmBackend = env.backends.onnx.wasm;
      if (!wasmBackend) {
        // Typed as optional, and it is the only way to point the runtime at its
        // own files — so its absence is a broken transcription, not something to
        // carry on past quietly.
        throw new Error('onnxruntime-web exposes no wasm backend to configure');
      }
      wasmBackend.wasmPaths = ORT_RUNTIME_PATH;

      const device = (await hasWebGpu()) ? 'webgpu' : 'wasm';
      const dtype = DTYPES[device];
      logger.info('Loading the browser speech model', { device, dtype });

      try {
        return await pipeline('automatic-speech-recognition', MODEL_ID, { device, dtype });
      } catch (error) {
        logger.warn('The quantised model was refused; falling back to the full one', {
          error: String(error),
        });
        return pipeline('automatic-speech-recognition', MODEL_ID, {
          device,
          dtype: FALLBACK_DTYPES,
        });
      }
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
 * Which language to tell whisper it is hearing.
 *
 * On a phone, `auto` means what it says: whisper.cpp detects the language.
 * transformers.js does not — its whisper implementation carries a
 * `TODO: Implement language detection`, and an unspecified language silently
 * becomes English. A meeting held in Spanish came back transcribed as English
 * with only a console warning to show for it.
 *
 * So `auto` resolves to the language of the browser, which is a far better guess
 * than English-for-everyone, and the choice is logged so a wrong transcript has
 * a visible cause. Someone whose meetings are not in their interface language
 * can pin it in settings.
 */
function resolveLanguage(requested: string): string {
  if (requested !== 'auto') return requested;
  const browserLanguage = typeof navigator === 'undefined' ? '' : navigator.language;
  // `es-ES` and `es-419` are both `es` to whisper.
  const base = browserLanguage.split('-')[0]?.toLowerCase();
  const language = base && base.length === 2 ? base : 'en';
  logger.info('No transcription language set; using the browser language', { language });
  return language;
}

/**
 * Non-speech markers whisper emits ("[BLANK_AUDIO]", "[Music]"). Nobody said
 * them, so they are not transcript.
 */
const NON_SPEECH = /^\[.*\]$/;

function toSegments(
  chunks: readonly TimestampedChunk[],
  captureId: string,
  offsetMs = 0,
  sliceIndex = 0,
): TranscriptSegment[] {
  return chunks
    .map((chunk, index) => {
      const [start, end] = chunk.timestamp;
      return makeSegment({
        captureId,
        sliceIndex,
        segmentIndex: index,
        startMs: offsetMs + Math.round(start * SECONDS_TO_MS),
        // The final chunk of a recording has no end timestamp.
        endMs: offsetMs + Math.round((end ?? start) * SECONDS_TO_MS),
        text: chunk.text.trim(),
      });
    })
    .filter((segment) => segment.text !== '' && !NON_SPEECH.test(segment.text));
}

/**
 * Transcribe raw samples that are already in whisper's format.
 *
 * Exported for the live path, which has the microphone's own PCM in hand and no
 * file to decode: it would otherwise have to encode audio only to fetch and
 * decode it again. `offsetMs` is added to every timestamp, because a slice
 * transcribed on its own starts counting from zero and the note needs to know
 * when in the meeting it was said.
 *
 * `sliceIndex` names WHICH slice, which is what makes a segment's id stable: the
 * same slice transcribed again — a correction, a retry — lands on the rows it
 * already wrote rather than beside them.
 */
export async function transcribeSamples(
  samples: Float32Array,
  captureId: string,
  language: string,
  offsetMs: number,
  sliceIndex: number,
): Promise<TranscriptSegment[]> {
  const transcribe = await getTranscriber();
  const output = await transcribe(samples, {
    chunk_length_s: CHUNK_SECONDS,
    return_timestamps: true,
    language: resolveLanguage(language),
  });
  return toSegments(output.chunks ?? [], captureId, offsetMs, sliceIndex);
}

export function getSttEngine(): SttEngine {
  return {
    // `AudioContext` is the honest test: a context without it cannot decode a
    // recording, whatever else it supports.
    isSupported: () => typeof AudioContext !== 'undefined',

    async transcribe(request: TranscribeRequest): Promise<TranscriptSegment[]> {
      const samples = await decodeToSamples(request.audioPath);
      const transcribe = await getTranscriber();

      const language = resolveLanguage(request.language);
      const output = await transcribe(samples, {
        chunk_length_s: CHUNK_SECONDS,
        return_timestamps: true,
        language,
      });

      const segments = toSegments(output.chunks ?? [], request.captureId);
      request.onSegments?.(segments);
      logger.info('Browser transcription finished', { segments: segments.length });
      return segments;
    },
  };
}
