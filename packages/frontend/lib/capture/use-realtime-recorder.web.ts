/**
 * Recording that takes notes while the meeting happens — in a browser.
 *
 * Same shape as the phone's version and, deliberately, less of it: there is no
 * foreground service to start (a tab is either open or it is not), and no
 * directory to create, because the recording is a blob whose URL only exists
 * once it has stopped. That last difference is why the capture row is finished
 * with a path the session hands back rather than one chosen up front.
 */

import { getActiveViewerId } from '@/lib/db/client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createLogger } from '@oxy.so/core/logger';

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

  const sessionRef = useRef<RealtimeSession | null>(null);
  const startRef = useRef<Promise<void> | null>(null);
  const stoppingRef = useRef<{ generation: number; promise: Promise<StopOutcome> } | null>(null);
  const generationRef = useRef(0);
  const sessionGenerationRef = useRef(0);
  const startedAtRef = useRef<Date | null>(null);
  const latestDbRef = useRef<number | null>(null);
  // The same owner the phone uses. What differs between the two files is opening
  // a microphone, and that is all that should differ.
  const coordinatorRef = useRef<CaptureCoordinator | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!enabled) return;
    const expectedViewerId = getActiveViewerId();

    const generation = ++generationRef.current;
    let active = true;
    let sessionForFailure: RealtimeSession | null = null;
    let coordinatorForRun: CaptureCoordinator | null = null;
    let audioStorageFailed = false;
    const stopAfterStorageFailure = () => {
      if (!active || !sessionForFailure || sessionRef.current !== sessionForFailure) return;
      void stopRef.current();
    };
    setPhase('starting');
    const startedAt = new Date();
    startedAtRef.current = startedAt;

    startRef.current = (async () => {
      try {
        // Written before the microphone opens, as on the phone: if the tab dies
        // a moment later, this row is the only record the recording existed.
        // The path is empty because a blob has no URL until it is finished.
        await beginCapture({ id: captureId, noteId, audioPath: '' }, expectedViewerId);
        if (!active) return;

        const coordinator = createLiveCoordinator({
          expectedViewerId,
          captureId,
          noteId,
          startedAt,
          language: optionsRef.current.language,
        });
        coordinatorForRun = coordinator;
        coordinatorRef.current = coordinator;

        const rawSession = await startRealtimeTranscription({
          expectedViewerId,
          captureId,
          model: optionsRef.current.model,
          language: optionsRef.current.language,
          audioPath: '',
          onLevel: (db) => {
            if (active) latestDbRef.current = db;
          },
          onPartial: (text) => {
            if (active) setPartialText(text);
          },
          onTranscriptChanged: () => {
            if (!active) return;
            void coordinator.transcriptChanged().catch((error: unknown) => {
              logger.error('Could not queue the transcript revision', { error: String(error) });
            });
          },
          onAudioStorageFailure: () => {
            audioStorageFailed = true;
            stopAfterStorageFailure();
          },
          onError: (message) => {
            // The recording continues: losing transcription is not losing the
            // meeting, and the audio can still be transcribed afterwards.
            logger.error('Live transcription failed', { error: message });
          },
        });

        let stopped: Promise<string | null> | null = null;
        const session: RealtimeSession = { stop: () => (stopped ??= rawSession.stop()) };
        sessionForFailure = session;
        if (!active) {
          await session.stop();
          return;
        }
        sessionRef.current = session;
        sessionGenerationRef.current = generation;
        await coordinator.markRecording();
        if (!active) {
          await session.stop();
          return;
        }
        setPhase('recording');
        if (audioStorageFailed) stopAfterStorageFailure();
      } catch (error) {
        await sessionForFailure?.stop().catch(() => undefined);
        if (sessionRef.current === sessionForFailure) sessionRef.current = null;
        // The usual cause is the user declining the microphone, which the
        // browser reports as a `NotAllowedError` rather than a permission API.
        const denied = error instanceof DOMException && error.name === 'NotAllowedError';
        logger.error('Could not start recording', { error: String(error) });
        if (active) {
          await coordinatorForRun
            ?.markFailed(denied ? 'permission' : 'capture_start')
            .catch(() => undefined);
          if (active) setPhase(denied ? 'denied' : 'error');
        }
      }
    })();

    return () => {
      active = false;
      if (generationRef.current === generation) generationRef.current += 1;
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

  const stop = useCallback((): Promise<StopOutcome> => {
    const requestedGeneration = generationRef.current;
    if (stoppingRef.current?.generation === requestedGeneration) return stoppingRef.current.promise;
    const started = startRef.current;
    const run = async (): Promise<StopOutcome> => {
      await started?.catch(() => undefined);
      if (generationRef.current !== requestedGeneration || !sessionRef.current) return 'noop';

      const session = sessionRef.current;
      const generation = sessionGenerationRef.current;
      const coordinator = coordinatorRef.current;
      const isCurrent = () =>
        generationRef.current === generation && sessionRef.current === session;
      if (isCurrent()) setPhase('saving');
      try {
        if (isCurrent()) await coordinator?.markStopping().catch(() => undefined);
        const audioPath = (await session.stop()) ?? '';
        if (!isCurrent()) return 'noop';
        await coordinator?.markStopped(durationRef.current, audioPath);
        if (!isCurrent()) return 'noop';
        sessionRef.current = null;
        setPhase('saved');
        return 'saved';
      } catch (error) {
        logger.error('Could not save the recording', { error: String(error) });
        if (!isCurrent()) return 'failed';
        await coordinator?.markFailed('persist_audio').catch(() => undefined);
        if (isCurrent()) {
          sessionRef.current = null;
          setPhase('error');
        }
        return 'failed';
      }
    };
    const pending = run();
    stoppingRef.current = { generation: requestedGeneration, promise: pending };
    void pending.then(() => {
      if (stoppingRef.current?.promise === pending) stoppingRef.current = null;
    });
    return pending;
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
