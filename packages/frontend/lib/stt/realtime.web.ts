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
 * ## How the transcript is built: settled text and text still being said
 *
 * Two loops over the same audio, because a transcript and a live display want
 * opposite things.
 *
 * The **committed** loop is the transcript. Audio is transcribed in slices as
 * they fill and each slice's offset is added back to its timestamps. Slices are
 * transcribed independently — whisper gets no context across the seam, unlike
 * the phone's ring buffer — so a sentence split across a boundary can come back
 * wrong on both sides. Twelve seconds is long enough that this is rare, and the
 * note is rebuilt from the whole transcript each time, so a later slice can
 * still fix what an earlier one implied.
 *
 * The **partial** loop is what the person watching sees. It re-transcribes
 * everything said since the last commit, over and over, as fast as the machine
 * manages, and hands back a string that is replaced rather than appended to.
 * Nothing is stored. This is the shape Xenova's `realtime-whisper-webgpu` demo
 * uses for its whole display: keep reading the recent audio again and show the
 * latest reading. Waiting for a slice to settle before showing anything is what
 * made this feel like it transcribed in jumps, because it did.
 *
 * One transcription runs at a time, and a partial is DROPPED rather than queued
 * when the model is busy — the same choice the demo makes with its `processing`
 * flag. Queueing them would mean falling further behind on every pass and
 * showing text from a moment that has gone. And once a slice is ready to commit
 * no further partials start, so the settled transcript can never be starved by
 * the provisional one.
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

/**
 * How much new speech is worth re-reading the current slice for.
 *
 * The floor under the partial loop. Without it every 128-sample block from the
 * worklet would ask for a transcription, and the answer would be the previous
 * one with nothing added — work that costs a pass of the model and changes
 * nothing on screen.
 */
const PARTIAL_MIN_NEW_SAMPLES = SAMPLE_RATE / 2;

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
  let busy = false;
  let partialAtSamples = 0;
  /** Whatever is running, so `stop` can wait for it. */
  let inFlight: Promise<void> = Promise.resolve();

  /** Everything heard since the last commit, as one buffer. */
  function pendingSamples(): Float32Array {
    const samples = new Float32Array(pendingLength);
    let at = 0;
    for (const chunk of pending) {
      samples.set(chunk, at);
      at += chunk.length;
    }
    return samples;
  }

  function run(work: () => Promise<void>): void {
    busy = true;
    inFlight = work()
      .catch((error: unknown) => {
        logger.error('Live transcription failed', { error: String(error) });
        options.onError?.(String(error));
      })
      .finally(() => {
        busy = false;
      });
  }

  /** Settle a span: transcribe it once, keep it, and start the next span. */
  function commit(samples: Float32Array, offsetSamples: number): void {
    run(async () => {
      const segments = await transcribeSamples(
        samples,
        options.captureId,
        options.language,
        Math.round((offsetSamples / SAMPLE_RATE) * 1000),
      );
      // The provisional text covered exactly this span, and the span is settled
      // now — leaving it up would show the same words twice, once as a guess.
      options.onPartial?.('');
      if (segments.length === 0) return;
      // Persisted as they stabilise: a tab closed mid-meeting keeps everything
      // understood up to that point.
      await appendSegments(segments);
      options.onTranscriptChanged?.();
    });
  }

  /** Re-read the unsettled span, for the screen only. */
  function refreshPartial(samples: Float32Array): void {
    run(async () => {
      const segments = await transcribeSamples(samples, options.captureId, options.language, 0);
      if (stopped) return;
      options.onPartial?.(segments.map((segment) => segment.text).join(' ').trim());
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

    // Nothing starts while something runs. Both branches below are reached again
    // on the next block of audio, a few milliseconds later.
    if (busy) return;

    if (pendingLength >= SLICE_SAMPLES) {
      const slice = pendingSamples();
      pending = [];
      const offset = transcribedSamples;
      transcribedSamples += pendingLength;
      pendingLength = 0;
      partialAtSamples = 0;
      commit(slice, offset);
      return;
    }

    if (pendingLength - partialAtSamples < PARTIAL_MIN_NEW_SAMPLES) return;
    partialAtSamples = pendingLength;
    refreshPartial(pendingSamples());
  };

  logger.info('Live browser transcription started');

  return {
    stop: async () => {
      stopped = true;

      // Whatever is left is usually where the meeting ended, which is where the
      // decisions are — so the tail is transcribed rather than dropped. It waits
      // for any partial still running, which would otherwise have the model.
      if (pendingLength > 0) {
        const tail = pendingSamples();
        const offset = transcribedSamples;
        await inFlight;
        commit(tail, offset);
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
