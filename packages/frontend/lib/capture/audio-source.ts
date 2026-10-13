/**
 * Where a recording's audio comes from.
 *
 * Until now the browser recorder asked for the microphone itself. Desktop needs
 * the machine's own sound as well (the other half of a call), and that must not
 * become a second recorder: it has to be one more place the one recorder gets a
 * stream from. This is that place — `docs/desktop-audio.mdx` explains why.
 *
 * A source hands back a `MediaStream`, because the recorder already knows what to
 * do with one: it feeds an AudioWorklet for transcription and a MediaRecorder for
 * the kept audio from the SAME stream, so the recording and the transcript can
 * never disagree. A desktop source that arrives as PCM chunks from Rust becomes a
 * `MediaStream` through a `MediaStreamAudioDestinationNode`, and from there
 * nothing below this file knows or cares.
 */

export type AudioSourceId = 'microphone' | 'system' | 'mixed';

export interface OpenedAudio {
  stream: MediaStream;
  /** Release everything this opened. Safe to call more than once. */
  close: () => void;
}

export interface AudioSource {
  id: AudioSourceId;
  open: () => Promise<OpenedAudio>;
}

/** The constraints the recorder has always used: one channel, cleaned up for speech. */
export const MICROPHONE_CONSTRAINTS: MediaStreamConstraints = {
  audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
};

function stopAll(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** The device microphone. Asks the person for permission the first time. */
export function microphoneSource(
  mediaDevices: Pick<MediaDevices, 'getUserMedia'> = navigator.mediaDevices,
): AudioSource {
  return {
    id: 'microphone',
    open: async () => {
      const stream = await mediaDevices.getUserMedia(MICROPHONE_CONSTRAINTS);
      return { stream, close: () => stopAll(stream) };
    },
  };
}

/** The slice of `AudioContext` mixing needs, so it can be tested without a browser. */
export interface MixingContext {
  createMediaStreamSource: (stream: MediaStream) => { connect: (node: unknown) => unknown };
  createMediaStreamDestination: () => { stream: MediaStream };
  close: () => Promise<void> | void;
}

/**
 * Several sources mixed into ONE stream.
 *
 * One stream, so there is one recording, one transcript and one timeline: two
 * streams reaching the transcript separately would leave two clocks to reconcile
 * and every provenance range in a note unsure which one it meant.
 *
 * All-or-nothing: if any source fails to open, the ones already open are closed
 * and the error propagates. A "mixed" recording that quietly dropped one side
 * would be the worst outcome — the person believes both are being captured.
 */
export function mixedSource(
  sources: readonly AudioSource[],
  createContext: () => MixingContext = () => new AudioContext() as unknown as MixingContext,
): AudioSource {
  return {
    id: 'mixed',
    open: async () => {
      const opened: OpenedAudio[] = [];
      try {
        for (const source of sources) opened.push(await source.open());
      } catch (error) {
        for (const audio of opened) audio.close();
        throw error;
      }

      const context = createContext();
      const destination = context.createMediaStreamDestination();
      for (const audio of opened)
        context.createMediaStreamSource(audio.stream).connect(destination);

      let closed = false;
      return {
        stream: destination.stream,
        close: () => {
          if (closed) return;
          closed = true;
          for (const audio of opened) audio.close();
          void context.close();
        },
      };
    },
  };
}
