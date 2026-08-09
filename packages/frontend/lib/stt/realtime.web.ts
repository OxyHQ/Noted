/**
 * Taking notes while the meeting happens, in a browser.
 *
 * ## Why this can exist at all
 *
 * A phone cannot have two recorders: the microphone is exclusive, which is why
 * whisper.cpp owns it there and writes the audio itself. A browser can. One
 * `getUserMedia` stream feeds two consumers at once — an `AudioWorklet` that
 * hands raw PCM to whisper for transcription, and a `MediaRecorder` that keeps
 * the audio. So here the recording and the transcript come from the same
 * microphone without either taking it from the other.
 *
 * That is also the correction to something this codebase said earlier: it is
 * `expo-audio` that cannot do live transcription on web, because `MediaRecorder`
 * hands back a finished blob. The platform can.
 *
 * ## How the transcript is built
 *
 * Audio is transcribed in slices as they fill, and each slice's offset is added
 * back to its timestamps. Slices are transcribed independently — whisper gets no
 * context across the seam, unlike the phone's ring buffer — so a sentence split
 * across a boundary can come back wrong on both sides. Twelve seconds is long
 * enough that this is rare and short enough to feel live, and the note is
 * rebuilt from the whole transcript each time, so a later slice can still fix
 * what an earlier one implied.
 */

import { createLogger } from '@oxyhq/core/logger';

import { appendSegments } from '@/lib/capture/captures-repo';
import { SAMPLE_RATE, transcribeSamples } from '@/lib/stt/engine.web';
import type { RealtimeOptions, RealtimeSession } from '@/lib/stt/realtime';

const logger = createLogger('NotedSTT');

/**
 * How much audio each transcription covers.
 *
 * The trade the user feels: shorter puts words on screen sooner, longer gives
 * whisper more to work with and fewer mistakes at the seams.
 */
const SLICE_SECONDS = 12;

const SLICE_SAMPLES = SLICE_SECONDS * SAMPLE_RATE;

/** The worklet, served as a static file rather than bundled. */
const PROCESSOR_URL = '/audio-processor.js';

/** The worklet emits Int16; whisper wants Float32 in −1..1. */
function toFloat32(pcm: Int16Array): Float32Array {
  const samples = new Float32Array(pcm.length);
  for (let index = 0; index < pcm.length; index += 1) {
    samples[index] = pcm[index] / 32_768;
  }
  return samples;
}

interface WorkletMessage {
  type: 'audio' | 'level';
  data?: ArrayBuffer;
  level?: number;
}

/** dBFS from the worklet's linear 0–1 level, for the shared waveform maths. */
function levelToDb(level: number): number {
  return level <= 0 ? -50 : Math.max(-50, 20 * Math.log10(level));
}

export async function startRealtimeTranscription(
  options: RealtimeOptions,
): Promise<RealtimeSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });

  // Asking for whisper's rate up front means the browser resamples once, in
  // native code, instead of this module doing it per slice in JavaScript.
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  await context.audioWorklet.addModule(PROCESSOR_URL);

  const source = context.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(context, 'audio-capture-processor');
  // Through a silent gain node to the destination: some browsers do not run a
  // worklet that is not connected to anything, and routing the microphone to
  // the speakers would be feedback.
  const silence = context.createGain();
  silence.gain.value = 0;
  source.connect(capture);
  capture.connect(silence);
  silence.connect(context.destination);

  // The audio the user keeps. The same stream, so nothing competes for the
  // microphone and the recording matches the transcript exactly.
  const recorder = new MediaRecorder(stream);
  const recordedChunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) recordedChunks.push(event.data);
  };
  recorder.start();

  let pending: Float32Array[] = [];
  let pendingLength = 0;
  let transcribedSamples = 0;
  let stopped = false;
  // One transcription at a time: whisper on a slice takes longer than a slice
  // takes to fill on a slow machine, and starting a second would fall further
  // behind on every pass.
  let inFlight: Promise<void> = Promise.resolve();

  function flush(samples: Float32Array, offsetSamples: number): void {
    inFlight = inFlight
      .then(async () => {
        const segments = await transcribeSamples(
          samples,
          options.captureId,
          options.language,
          Math.round((offsetSamples / SAMPLE_RATE) * 1000),
        );
        if (segments.length === 0) return;
        // Persisted as they stabilise: a tab closed mid-meeting keeps
        // everything understood up to that point.
        await appendSegments(segments);
        options.onTranscriptChanged?.();
      })
      .catch((error: unknown) => {
        logger.error('Live transcription failed on a slice', { error: String(error) });
        options.onError?.(String(error));
      });
  }

  capture.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
    const message = event.data;

    if (message.type === 'level' && message.level !== undefined) {
      options.onLevel?.(levelToDb(message.level));
      return;
    }
    if (message.type !== 'audio' || !message.data || stopped) return;

    pending.push(toFloat32(new Int16Array(message.data)));
    pendingLength += message.data.byteLength / 2;

    if (pendingLength < SLICE_SAMPLES) return;

    const slice = new Float32Array(pendingLength);
    let at = 0;
    for (const chunk of pending) {
      slice.set(chunk, at);
      at += chunk.length;
    }
    pending = [];
    const offset = transcribedSamples;
    transcribedSamples += pendingLength;
    pendingLength = 0;
    flush(slice, offset);
  };

  logger.info('Live browser transcription started');

  return {
    stop: async () => {
      stopped = true;

      // Whatever is left is usually where the meeting ended, which is where the
      // decisions are — so the tail is transcribed rather than dropped.
      if (pendingLength > 0) {
        const tail = new Float32Array(pendingLength);
        let at = 0;
        for (const chunk of pending) {
          tail.set(chunk, at);
          at += chunk.length;
        }
        flush(tail, transcribedSamples);
      }

      const recorded = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      recorder.stop();
      await recorded;

      capture.port.onmessage = null;
      source.disconnect();
      capture.disconnect();
      silence.disconnect();
      await context.close();
      // Released explicitly, or the browser keeps showing a recording indicator
      // for a meeting that ended.
      for (const track of stream.getTracks()) track.stop();

      await inFlight;
      logger.info('Live browser transcription stopped');

      if (recordedChunks.length === 0) return null;
      return URL.createObjectURL(new Blob(recordedChunks, { type: recorder.mimeType }));
    },
  };
}
