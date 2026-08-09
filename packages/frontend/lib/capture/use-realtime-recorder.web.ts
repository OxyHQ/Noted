/**
 * Recording that takes notes while the meeting happens — in a browser.
 *
 * Same shape as the phone's version and, deliberately, less of it: there is no
 * foreground service to start (a tab is either open or it is not), and no
 * directory to create, because the recording is a blob whose URL only exists
 * once it has stopped. That last difference is why the capture row is finished
 * with a path the session hands back rather than one chosen up front.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createLogger } from '@oxyhq/core/logger';

import { beginCapture } from '@/lib/capture/captures-repo';
import type { CaptureCoordinator } from '@/lib/capture/coordinator';
import { createLiveCoordinator } from '@/lib/capture/live-coordinator';
import {
  dbToLevel,
  pushLevel,
  type Recorder,
  type RecorderPhase,
  type StopOutcome,
} from '@/lib/capture/recording';
import { startRealtimeTranscription, type RealtimeSession } from '@/lib/stt/realtime';
import type { RealtimeRecorderOptions } from '@/lib/capture/use-realtime-recorder';

const logger = createLogger('NotedCapture');

/** How often the timer and waveform are pushed to the screen. */
const TICK_MS = 100;

/**
 * True where the browser can hand over raw microphone samples.
 *
 * Checked rather than assumed: without `AudioWorklet` there is no way to get
 * PCM while recording, and the deferred path — transcribe once the recording
 * stops — is the correct answer there rather than a broken live one.
 */
export function isRealtimeCaptureSupported(): boolean {
  return (
    typeof AudioContext !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices !== undefined
  );
}

export function useRealtimeRecorder(
  captureId: string,
  noteId: string,
  enabled: boolean,
  options: RealtimeRecorderOptions,
): Recorder {
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [levels, setLevels] = useState<number[] | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  // Held in state rather than a ref: it is rendered, and the whole point is that
  // the screen changes every time the recogniser re-reads the current span.
  const [partialText, setPartialText] = useState('');

  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const sessionRef = useRef<RealtimeSession | null>(null);
  const startRef = useRef<Promise<void> | null>(null);
  const startedAtRef = useRef<Date | null>(null);
  const latestDbRef = useRef<number | null>(null);
  // The same owner the phone uses. What differs between the two files is opening
  // a microphone, and that is all that should differ.
  const coordinatorRef = useRef<CaptureCoordinator | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    setPhase('starting');
    const startedAt = new Date();
    startedAtRef.current = startedAt;

    startRef.current = (async () => {
      try {
        // Written before the microphone opens, as on the phone: if the tab dies
        // a moment later, this row is the only record the recording existed.
        // The path is empty because a blob has no URL until it is finished.
        await beginCapture({ id: captureId, noteId, audioPath: '' });

        const coordinator = createLiveCoordinator({
          captureId,
          noteId,
          startedAt,
          language: optionsRef.current.language,
        });
        coordinatorRef.current = coordinator;

        const session = await startRealtimeTranscription({
          captureId,
          model: optionsRef.current.model,
          language: optionsRef.current.language,
          audioPath: '',
          onLevel: (db) => {
            latestDbRef.current = db;
          },
          onPartial: (text) => {
            setPartialText(text);
          },
          onTranscriptChanged: () => {
            void coordinator.transcriptChanged().catch((error: unknown) => {
              logger.error('Could not queue the transcript revision', { error: String(error) });
            });
          },
          onError: (message) => {
            // The recording continues: losing transcription is not losing the
            // meeting, and the audio can still be transcribed afterwards.
            logger.error('Live transcription failed', { error: message });
          },
        });

        if (!active) {
          await session.stop();
          return;
        }
        sessionRef.current = session;
        await coordinator.markRecording();
        setPhase('recording');
      } catch (error) {
        // The usual cause is the user declining the microphone, which the
        // browser reports as a `NotAllowedError` rather than a permission API.
        const denied = error instanceof DOMException && error.name === 'NotAllowedError';
        logger.error('Could not start recording', { error: String(error) });
        await coordinatorRef.current?.markFailed(denied ? 'permission' : 'capture_start').catch(
          () => undefined,
        );
        if (active) setPhase(denied ? 'denied' : 'error');
      }
    })();

    return () => {
      active = false;
    };
  }, [captureId, noteId, enabled]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const startedAt = startedAtRef.current;
    if (!startedAt) return;

    const timer = setInterval(() => {
      setDurationMs(Date.now() - startedAt.getTime());
      const db = latestDbRef.current;
      if (db !== null) setLevels((current) => pushLevel(current, dbToLevel(db)));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [phase]);

  const durationRef = useRef(durationMs);
  durationRef.current = durationMs;

  const stop = useCallback(async (): Promise<StopOutcome> => {
    if (phaseRef.current !== 'recording' && phaseRef.current !== 'starting') return 'noop';

    await startRef.current?.catch(() => undefined);
    if (phaseRef.current !== 'recording') return 'noop';

    setPhase('saving');
    try {
      const coordinator = coordinatorRef.current;
      await coordinator?.markStopping();

      // The session finishes its last slice before returning, so the audio and
      // the transcript end at the same moment.
      const audioPath = (await sessionRef.current?.stop()) ?? '';
      sessionRef.current = null;

      // Returns once the recording is safe. The final pass runs afterwards, on
      // its own, exactly as on the phone.
      await coordinator?.markStopped(durationRef.current, audioPath);

      setPhase('saved');
      return 'saved';
    } catch (error) {
      logger.error('Could not save the recording', { error: String(error) });
      await coordinatorRef.current?.markFailed('persist_audio').catch(() => undefined);
      setPhase('error');
      return 'failed';
    }
  }, []);

  // Navigating away unmounts this without reaching the stop button, and a tab
  // that keeps its microphone open after the user left is the worst outcome
  // available.
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(
    () => () => {
      void stopRef.current();
    },
    [],
  );

  return { phase, levels, durationMs, partialText, stop };
}
