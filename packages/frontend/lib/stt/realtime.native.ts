/**
 * Taking notes while the meeting is still happening.
 *
 * The microphone feeds raw PCM straight into whisper.cpp, which transcribes in
 * slices as they fill. Each stabilised slice is written to SQLite, and the note
 * is rebuilt from what exists so far — so a person can put the phone down and
 * watch their notes appear rather than waiting for the end.
 *
 * ## Why this owns the microphone instead of `expo-audio`
 *
 * Two recorders cannot share one microphone. Real-time transcription needs raw
 * samples as they arrive, and `expo-audio` only offers a finished file, so the
 * PCM stream becomes the single source and writes the WAV itself
 * (`audioOutputPath`). `expo-audio` is still used for the permission prompt,
 * which is all it is asked for here.
 */

import { initWhisper, type WhisperContext } from 'whisper.rn/index';
// The `/index` suffix is required: whisper.rn's exports map declares `./*` and
// `./*/`, and the bare directory specifier matches neither.
import {
  RealtimeTranscriber,
  type RealtimeTranscribeEvent,
} from 'whisper.rn/realtime-transcription/index';
import { AudioPcmStreamAdapter } from 'whisper.rn/realtime-transcription/adapters/AudioPcmStreamAdapter';
import { Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { createLogger } from '@oxyhq/core/logger';

import { appendSegments, type TranscriptSegment } from '@/lib/capture/captures-repo';
import { newNoteId } from '@/lib/db/ids';
import { isModelPresent, modelFile, STT_MODELS, type SttModelId } from '@/lib/stt/models';

const logger = createLogger('NotedSTT');

/**
 * Whisper wants 16 kHz mono 16-bit — the format its models were trained on.
 * Anything else is resampled somewhere, and doing it here avoids that cost.
 */
const AUDIO_CONFIG = { sampleRate: 16_000, channels: 1, bitsPerSample: 16 } as const;

/**
 * How much audio each transcription covers.
 *
 * The trade the user feels: shorter slices put words on screen sooner, longer
 * ones give whisper more context and fewer mistakes at the seams. Twelve seconds
 * is short enough to feel live and long enough to hold a sentence.
 */
const SLICE_SECONDS = 12;

/** Threads left to whisper, keeping cores free for the audio thread. */
const THREADS = 4;

export interface RealtimeSession {
  stop: () => Promise<void>;
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
  onError?: (message: string) => void;
}

let context: WhisperContext | null = null;
let loadedModel: SttModelId | null = null;

async function getContext(model: SttModelId): Promise<WhisperContext> {
  if (context && loadedModel === model) return context;
  if (context) {
    await context.release();
    context = null;
  }

  const definition = STT_MODELS[model];
  if (!isModelPresent(definition)) throw new Error(`speech model ${model} is not downloaded`);

  context = await initWhisper({
    filePath: modelFile(definition).uri,
    useCoreMLIos: Platform.OS === 'ios',
    useGpu: Platform.OS === 'ios',
  });
  loadedModel = model;
  return context;
}

/** whisper.cpp reports segment times in centiseconds. */
const CENTISECONDS_TO_MS = 10;

interface WhisperSegment {
  text: string;
  t0: number;
  t1: number;
}

/**
 * Non-speech markers whisper emits ("[BLANK_AUDIO]", "[Music]"). Nobody said
 * them, so they are not transcript.
 */
const NON_SPEECH = /^\[.*\]$/;

function toSegments(
  segments: readonly WhisperSegment[],
  captureId: string,
  offsetMs: number,
): TranscriptSegment[] {
  return segments
    .map((segment) => ({
      id: newNoteId(),
      captureId,
      // Slice times restart at zero, so each slice's offset in the recording is
      // added back — without it every paragraph would look simultaneous and the
      // grouping by silence would collapse.
      startMs: offsetMs + segment.t0 * CENTISECONDS_TO_MS,
      endMs: offsetMs + segment.t1 * CENTISECONDS_TO_MS,
      text: segment.text.trim(),
      confidence: null,
      speakerHint: null,
    }))
    .filter((segment) => segment.text !== '' && !NON_SPEECH.test(segment.text));
}

/**
 * Start transcribing as the meeting runs.
 *
 * Resolves once the microphone is open and whisper is loaded; the session keeps
 * running until `stop()`.
 */
export async function startRealtimeTranscription(
  options: RealtimeOptions,
): Promise<RealtimeSession> {
  const whisperContext = await getContext(options.model);
  const audioStream = new AudioPcmStreamAdapter();

  const transcriber = new RealtimeTranscriber(
    { whisperContext, audioStream },
    {
      audioSliceSec: SLICE_SECONDS,
      audioOutputPath: `${Paths.document.uri}${options.audioPath}`,
      audioStreamConfig: AUDIO_CONFIG,
      // Each slice is prompted with the previous one's text, so whisper carries
      // context across the seam instead of restarting cold every twelve seconds.
      promptPreviousSlices: true,
      transcribeOptions: {
        language: options.language === 'auto' ? undefined : options.language,
        maxThreads: THREADS,
      },
    },
    {
      onTranscribe: (event: RealtimeTranscribeEvent) => {
        const slice = event.sliceIndex ?? 0;
        const segments = toSegments(
          event.data?.segments ?? [],
          options.captureId,
          slice * SLICE_SECONDS * 1000,
        );
        if (segments.length === 0) return;
        // Persisted as they stabilise rather than at the end: a meeting that
        // ends in a crash keeps everything understood up to that point.
        void appendSegments(segments)
          .then(() => options.onTranscriptChanged?.())
          .catch((error: unknown) => {
            logger.error('Could not store transcript segments', { error: String(error) });
          });
      },
      onError: (message: string) => {
        logger.error('Realtime transcription failed', { error: message });
        options.onError?.(message);
      },
    },
  );

  await transcriber.start();
  logger.info('Realtime transcription started', { model: options.model });

  return {
    stop: async () => {
      await transcriber.stop();
      logger.info('Realtime transcription stopped');
    },
  };
}
