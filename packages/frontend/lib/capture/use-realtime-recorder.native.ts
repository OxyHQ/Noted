/**
 * Recording that takes notes while the meeting is still happening.
 *
 * This is the engine the product exists for. whisper.rn owns the microphone,
 * streams raw PCM into whisper.cpp, and writes the WAV itself — so there is one
 * recorder rather than two fighting over the device. Each stabilised slice is
 * persisted and the note is rebuilt from everything understood so far, which is
 * why a phone left face-down on a table fills a note as people talk.
 *
 * The alternative engine (`use-recorder`) records a compressed file and
 * transcribes nothing. Which one runs is decided by `use-capture-engine`, and
 * both satisfy the same `Recorder` contract so no screen has to know.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import { createLogger } from '@oxyhq/core/logger';

import { beginCapture, failCapture, finishCapture } from '@/lib/capture/captures-repo';
import { captureDirectory } from '@/lib/capture/use-recorder';
import { enhanceNote, restructureNote } from '@/lib/capture/restructure';
import {
  dbToLevel,
  pushLevel,
  type Recorder,
  type RecorderPhase,
  type StopOutcome,
} from '@/lib/capture/recording';
import { startRealtimeTranscription, type RealtimeSession } from '@/lib/stt/realtime';
import { isModelPresent, STT_MODELS, type SttModelId } from '@/lib/stt/models';
import type { RealtimeRecorderOptions } from '@/lib/capture/use-realtime-recorder';
import { startBackgroundCapture, stopBackgroundCapture } from '@/modules/noted-capture';

const logger = createLogger('NotedCapture');

/** How often the timer and waveform are pushed to the screen. */
const TICK_MS = 100;

export function isRealtimeCaptureSupported(): boolean {
  return true;
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

  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const sessionRef = useRef<RealtimeSession | null>(null);
  const startRef = useRef<Promise<void> | null>(null);
  const startedAtRef = useRef<Date | null>(null);
  const audioPathRef = useRef<string>('');

  // The newest reading, published on a timer rather than on arrival: audio
  // chunks land far faster than a screen can usefully redraw, and setting state
  // per chunk would spend the battery this feature is trying to save on
  // renders nobody sees.
  const latestDbRef = useRef<number | null>(null);

  // Read through refs so a re-render with new strings (a language change) never
  // restarts the microphone.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    setPhase('starting');
    const startedAt = new Date();
    startedAtRef.current = startedAt;
    const audioPath = `captures/${captureId}/audio.wav`;
    audioPathRef.current = audioPath;

    startRef.current = (async () => {
      try {
        let permission = await getRecordingPermissionsAsync();
        if (!permission.granted) permission = await requestRecordingPermissionsAsync();
        if (!active) return;
        if (!permission.granted) {
          setPhase('denied');
          return;
        }

        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          shouldPlayInBackground: false,
          shouldRouteThroughEarpiece: false,
          interruptionMode: 'mixWithOthers',
          // The reason this feature exists: a locked phone on a table mid-meeting.
          allowsBackgroundRecording: true,
        });

        captureDirectory(captureId).create({ intermediates: true, idempotent: true });

        // Written BEFORE the microphone opens: if the process dies a moment
        // later this row is the only record that the recording existed. The path
        // is known up front here, unlike the compressed engine, because the
        // transcriber is told where to write.
        await beginCapture({ id: captureId, noteId, audioPath });

        // Started from the foreground, before the microphone opens: Android
        // refuses to start a microphone-typed foreground service from the
        // background, so there is no later moment at which this would work.
        startBackgroundCapture(
          optionsRef.current.notification.title,
          optionsRef.current.notification.body,
        );

        const session = await startRealtimeTranscription({
          captureId,
          model: optionsRef.current.model,
          language: optionsRef.current.language,
          audioPath,
          onLevel: (db) => {
            latestDbRef.current = db;
          },
          onTranscriptChanged: () => {
            void restructureNote(captureId, noteId, startedAt).catch((error: unknown) => {
              logger.error('Could not structure the note', { error: String(error) });
            });
          },
          onError: (message) => {
            // The recording itself is still going; losing transcription is not
            // losing the meeting. It is reported and the audio is kept, so it
            // can be transcribed again afterwards.
            logger.error('Live transcription failed', { error: message });
          },
        });

        if (!active) {
          await session.stop();
          return;
        }
        sessionRef.current = session;
        setPhase('recording');
      } catch (error) {
        stopBackgroundCapture();
        logger.error('Could not start recording', { error: String(error) });
        await failCapture(captureId, 'capture_start').catch(() => undefined);
        if (active) setPhase('error');
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

    // Stopping mid-startup has to wait for the session to exist, or the
    // microphone is left open with nobody holding a handle to close it.
    await startRef.current?.catch(() => undefined);
    if (phaseRef.current !== 'recording') return 'noop';

    setPhase('saving');
    try {
      await sessionRef.current?.stop();
      sessionRef.current = null;
      stopBackgroundCapture();

      await finishCapture(captureId, durationRef.current, audioPathRef.current);

      // One last pass: the final slice usually lands during `stop`, and it is
      // the one carrying whatever was agreed at the end of the meeting.
      const startedAt = startedAtRef.current;
      if (startedAt) {
        await restructureNote(captureId, noteId, startedAt).catch((error: unknown) => {
          logger.error('Could not structure the note', { error: String(error) });
        });

        // The model reads the whole meeting once, here, and only if the user
        // downloaded one. Awaited so the note is finished before the recorder
        // reports `saved`; every failure inside is swallowed because the
        // structured note is already written and losing the better version is
        // not worth losing the recording over.
        await enhanceNote(captureId, noteId, startedAt, optionsRef.current.language).catch(
          (error: unknown) => {
            logger.error('Could not enhance the note', { error: String(error) });
          },
        );
      }

      setPhase('saved');
      return 'saved';
    } catch (error) {
      stopBackgroundCapture();
      logger.error('Could not save the recording', { error: String(error) });
      await failCapture(captureId, 'persist_audio').catch(() => undefined);
      setPhase('error');
      return 'failed';
    }
  }, [captureId, noteId]);

  // A gesture or the hardware back button unmounts the screen without reaching
  // its own handler, so the recorder tears itself down — otherwise the
  // microphone keeps running and the capture is never saved.
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(
    () => () => {
      void stopRef.current();
    },
    [],
  );

  // Empty, and not for lack of a live reading: whisper.rn re-emits a slice as it
  // fills, and those segments are written with the ids they already had, so the
  // phone's live text arrives through the committed transcript rather than
  // beside it. The browser has no equivalent — each slice is transcribed once —
  // which is why it needs a provisional line and this does not.
  return { phase, levels, durationMs, partialText: '', stop };
}

/** Whether `model` is downloaded and can drive a live recording. */
export function isModelReady(model: SttModelId): boolean {
  return isModelPresent(STT_MODELS[model]);
}
