/**
 * Transcription on the device, with whisper.cpp.
 *
 * Nothing leaves the phone: the audio is read from local storage, the model is a
 * file this app downloaded, and the transcript is written straight to SQLite. A
 * meeting recording is about as private as a document gets, and the cheapest way
 * to keep it private is for it never to be uploaded.
 */

// `whisper.rn/index`, not `whisper.rn`: the package's `exports` map declares
// only `./*` and `./*/`, with no `"."` entry, so the bare specifier does not
// resolve under `moduleResolution: bundler`. The subpath is the package's own
// supported entry, not a workaround around it.
import { initWhisper, type WhisperContext } from 'whisper.rn/index';
import { Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { createLogger } from '@oxyhq/core/logger';

import type { TranscriptSegment } from '@/lib/capture/captures-repo';
import { newNoteId } from '@/lib/db/ids';
import { isModelPresent, modelFile, STT_MODELS, type SttModelId } from '@/lib/stt/models';
import type { SttEngine, TranscribeRequest } from '@/lib/stt/engine';

const logger = createLogger('NotedSTT');

/**
 * How many CPU threads whisper.cpp may use.
 *
 * Four rather than "all of them": the recording being transcribed is often still
 * being made, and a phone whose every core is busy stops feeding the microphone
 * smoothly. Leaving headroom is what keeps the capture intact.
 */
const THREADS = 4;

/**
 * One loaded model at a time.
 *
 * Loading is measured in seconds and hundreds of megabytes of RAM, so the
 * context is kept between recordings and only rebuilt when the chosen model
 * changes.
 */
let context: WhisperContext | null = null;
let loadedModel: SttModelId | null = null;

async function getContext(model: SttModelId): Promise<WhisperContext> {
  if (context && loadedModel === model) return context;

  if (context) {
    await context.release();
    context = null;
    loadedModel = null;
  }

  const definition = STT_MODELS[model];
  if (!isModelPresent(definition)) {
    throw new Error(`speech model ${model} is not downloaded`);
  }

  context = await initWhisper({
    filePath: modelFile(definition).uri,
    // Core ML on iOS runs the encoder on the Neural Engine, which is the
    // difference between keeping up with speech and falling behind it. It is
    // ignored when the companion model is absent, so this is safe to ask for.
    useCoreMLIos: Platform.OS === 'ios',
    useGpu: Platform.OS === 'ios',
  });
  loadedModel = model;
  logger.info('Speech model loaded', { model });
  return context;
}

/** whisper.cpp reports times in centiseconds. */
const CENTISECONDS_TO_MS = 10;

interface WhisperSegment {
  text: string;
  t0: number;
  t1: number;
}

function toSegments(
  segments: readonly WhisperSegment[],
  captureId: string,
): TranscriptSegment[] {
  return segments
    .map((segment) => ({
      id: newNoteId(),
      captureId,
      startMs: segment.t0 * CENTISECONDS_TO_MS,
      endMs: segment.t1 * CENTISECONDS_TO_MS,
      text: segment.text.trim(),
      confidence: null,
      speakerHint: null,
    }))
    // whisper emits bracketed markers for non-speech ("[BLANK_AUDIO]",
    // "[Music]"). They are not something anybody said, so they are not
    // transcript.
    .filter((segment) => segment.text !== '' && !/^\[.*\]$/.test(segment.text));
}

export function getSttEngine(): SttEngine {
  return {
    isSupported: () => true,

    async transcribe(request: TranscribeRequest): Promise<TranscriptSegment[]> {
      const whisper = await getContext(request.model);
      const audioUri = `${Paths.document.uri}${request.audioPath}`;

      const { promise } = whisper.transcribe(audioUri, {
        language: request.language === 'auto' ? undefined : request.language,
        maxThreads: THREADS,
        // Reported as they are recognised so a long recording shows its
        // transcript filling in rather than a spinner.
        onNewSegments: request.onSegments
          ? (result) => request.onSegments?.(toSegments(result.segments, request.captureId))
          : undefined,
      });

      const result = await promise;
      return toSegments(result.segments, request.captureId);
    },
  };
}

/** Release the loaded model (low memory, sign-out). */
export async function releaseSttEngine(): Promise<void> {
  if (!context) return;
  await context.release();
  context = null;
  loadedModel = null;
}
