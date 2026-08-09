/**
 * The microphone.
 *
 * Records to a file the app owns, keeps a running level for the waveform, and
 * writes the capture row before the microphone opens so a recording that
 * outlives its process can still be recovered.
 *
 * ## Background
 *
 * The core case is a phone face-down on a table during a meeting while its owner
 * uses another app. That needs three separate things, and missing any one of
 * them ends the recording silently:
 *
 * - `allowsBackgroundRecording` on the audio session (both platforms);
 * - `UIBackgroundModes: ["audio"]` on iOS, declared in `app.json`;
 * - a foreground service of type `microphone` on Android, which is
 *   `modules/noted-capture`. Android 14+ refuses to keep the microphone open
 *   without one, and refuses to let one start from the background — which is why
 *   recording can only ever be started by the user, in the foreground.
 */

import {
  getRecordingPermissionsAsync,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingStatus,
} from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { createLogger } from '@oxyhq/core/logger';
import { useCallback, useEffect, useRef, useState } from 'react';

import { beginCapture, failCapture, finishCapture } from '@/lib/capture/captures-repo';
import { startBackgroundCapture, stopBackgroundCapture } from '@/modules/noted-capture';

const logger = createLogger('NotedCapture');

/** How many bars the waveform keeps. */
export const WAVEFORM_BARS = 48;

/**
 * Quietest level the meter maps to an empty bar, in dBFS. Below this is room
 * tone rather than speech, and mapping it to a visible bar makes silence look
 * like it is being recorded.
 */
const METERING_FLOOR_DB = -50;

/** How often the recorder's state (duration, meter) is sampled. */
const STATE_POLL_MS = 50;

export type RecorderPhase =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'saving'
  | 'saved'
  /** The user declined the microphone, or the system withheld it. */
  | 'denied'
  /** Anything else went wrong. Deliberately NOT reported as a permission
   *  problem: a message that names a cause it does not know sends the user to
   *  fix a setting that was never the issue. */
  | 'error';

export type StopOutcome = 'saved' | 'failed' | 'noop';

/** Where a capture's audio lives. One directory per capture, so deleting it is one call. */
export function captureDirectory(captureId: string): Directory {
  return new Directory(Paths.document, 'captures', captureId);
}

export interface Recorder {
  phase: RecorderPhase;
  /** Recent levels, 0–1, oldest first. Null until the first sample. */
  levels: number[] | null;
  durationMs: number;
  stop: () => Promise<StopOutcome>;
}

/**
 * Record into `captureId` while `enabled`.
 *
 * @param noteId the note this recording belongs to; the capture row points at it.
 * @param notification what Android's ongoing notification says. Passed in rather
 *   than built here so it is translated by the same machinery as the rest of the
 *   UI — this string is the only part of a background recording the user sees.
 */
export function useRecorder(
  captureId: string,
  noteId: string,
  enabled: boolean,
  notification: { title: string; body: string },
): Recorder {
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [levels, setLevels] = useState<number[] | null>(null);

  // The phase is read inside callbacks that outlive a render, so they need the
  // current value rather than the one captured when they were created.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const reportedStatusErrorRef = useRef<string | null>(null);
  const handleStatus = useCallback((status: RecordingStatus) => {
    const errorKey = status.hasError
      ? (status.error ?? 'unknown')
      : status.mediaServicesDidReset
        ? 'media_services_reset'
        : null;
    // Report each distinct failure once: the status callback fires continuously,
    // and a stuck recorder would otherwise fill the log with one problem.
    if (!errorKey || reportedStatusErrorRef.current === errorKey) return;
    reportedStatusErrorRef.current = errorKey;
    logger.error('Recorder reported a failure', { error: errorKey });
  }, []);

  const recorder = useAudioRecorder(
    { ...RecordingPresets.HIGH_QUALITY, directory: 'document', isMeteringEnabled: true },
    handleStatus,
  );
  const recorderState = useAudioRecorderState(recorder, STATE_POLL_MS);

  // Held so `stop` can await a start that is still in flight.
  const startRef = useRef<Promise<void> | null>(null);

  // Read through a ref so re-rendering with a new string (a language change)
  // does not re-run the effect that owns the microphone.
  const notificationRef = useRef(notification);
  notificationRef.current = notification;

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    setPhase('starting');
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

        const directory = captureDirectory(captureId);
        directory.create({ intermediates: true, idempotent: true });

        // The row is written BEFORE the microphone opens. If the process dies a
        // moment later, this is the only record that the recording existed.
        await beginCapture({
          id: captureId,
          noteId,
          audioPath: `captures/${captureId}/audio.m4a`,
        });

        await recorder.prepareToRecordAsync();
        if (!active) return;

        // Started from the foreground, before the microphone opens: Android
        // refuses to start a microphone-typed foreground service from the
        // background, so there is no later moment at which this would work.
        startBackgroundCapture(notificationRef.current.title, notificationRef.current.body);

        recorder.record();
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
  }, [captureId, noteId, enabled, recorder]);

  const metering = recorderState.metering;
  useEffect(() => {
    if (typeof metering !== 'number' || phaseRef.current !== 'recording') return;
    const level = Math.min(1, Math.max(0, (metering - METERING_FLOOR_DB) / -METERING_FLOOR_DB));
    setLevels((current) => [
      ...(current ?? Array<number>(WAVEFORM_BARS).fill(0)).slice(1),
      level,
    ]);
  }, [metering]);

  const durationMs = recorderState.durationMillis ?? 0;
  const durationRef = useRef(durationMs);
  durationRef.current = durationMs;

  const stop = useCallback(async (): Promise<StopOutcome> => {
    if (phaseRef.current !== 'recording' && phaseRef.current !== 'starting') return 'noop';

    // Stopping mid-startup has to wait for `record()` to actually happen.
    // Without this the recorder is left running with nobody able to stop it —
    // the microphone stays open and the capture is never saved.
    await startRef.current?.catch(() => undefined);
    if (phaseRef.current !== 'recording') return 'noop';

    setPhase('saving');
    try {
      await recorder.stop();
      // Released as soon as the microphone is, so the ongoing notification never
      // outlives the recording it describes.
      stopBackgroundCapture();
      const uri = recorder.uri;
      if (!uri) throw new Error('the recording produced no file');

      const extension = uri.split('.').pop()?.toLowerCase() ?? 'm4a';
      const directory = captureDirectory(captureId);
      directory.create({ intermediates: true, idempotent: true });
      const destination = new File(directory, `audio.${extension}`);
      if (destination.exists) destination.delete();
      new File(uri).move(destination);

      await finishCapture(captureId, durationRef.current);
      setPhase('saved');
      return 'saved';
    } catch (error) {
      stopBackgroundCapture();
      logger.error('Could not save the recording', { error: String(error) });
      await failCapture(captureId, 'persist_audio').catch(() => undefined);
      setPhase('error');
      return 'failed';
    }
  }, [captureId, recorder]);

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

  return { phase, levels, durationMs, stop };
}
