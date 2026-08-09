/**
 * Which engine records.
 *
 * Two exist and only one may hold the microphone:
 *
 * - **live** (`use-realtime-recorder`) streams PCM into whisper.cpp, writes the
 *   WAV itself, and fills the note while the meeting runs. This is the point of
 *   the product, and it needs a native build with a downloaded model.
 * - **plain** (`use-recorder`) records a compressed file with `expo-audio` and
 *   transcribes nothing. It is what a browser gets, and what a device without a
 *   model gets, so a recording is never refused for want of a download.
 *
 * Both hooks are called on every render — a hook cannot be called conditionally
 * — and `enabled` decides which one opens the device. At most one is ever true.
 */

import { useCallback } from 'react';

import { useRecorder } from '@/lib/capture/use-recorder';
import {
  isRealtimeCaptureSupported,
  useRealtimeRecorder,
} from '@/lib/capture/use-realtime-recorder';
import type { Recorder } from '@/lib/capture/recording';
import type { Row } from '@/lib/db/client';
import { useLiveQuery } from '@/lib/db/live-query';
import { DEFAULT_STT_MODEL, type SttModelId } from '@/lib/stt/models';
import { readSetting, SETTING_KEYS, useSettings } from '@/lib/db/settings-repo';

interface ReadyModelRow extends Row {
  id: string;
}

/**
 * Which models are downloaded, read from the store rather than the file system.
 *
 * A live query, not a `file.exists` in render: the file system is external
 * mutable state, and with the React Compiler a read of it from a memoised
 * position is frozen at its first value — so a model downloaded during the
 * session would never be noticed. The row is written by the downloader, so this
 * updates the moment one arrives.
 */
const READY_MODELS_SQL = "SELECT id FROM model_files WHERE kind = 'stt' AND state = 'ready'";

function mapReadyIds(rows: readonly ReadyModelRow[]): Set<string> {
  return new Set(rows.map((row) => row.id));
}

function isModelId(value: unknown): value is SttModelId {
  return value === 'tiny' || value === 'base' || value === 'small';
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isLanguage(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export interface CaptureEngine extends Recorder {
  /** True when this recording is also being transcribed as it happens. */
  isLive: boolean;
}

export function useCaptureEngine(
  captureId: string,
  noteId: string,
  enabled: boolean,
  notification: { title: string; body: string },
): CaptureEngine {
  const { settings } = useSettings();
  const { data: readyModels } = useLiveQuery<ReadyModelRow, Set<string>>({
    sql: READY_MODELS_SQL,
    mapRows: mapReadyIds,
  });

  const model = readSetting(settings, SETTING_KEYS.sttModel, isModelId, DEFAULT_STT_MODEL);
  const language = readSetting(settings, SETTING_KEYS.sttLanguage, isLanguage, 'auto');
  const wantsLive = readSetting(settings, SETTING_KEYS.liveNotes, isBoolean, true);

  const canRecordLive = isRealtimeCaptureSupported() && wantsLive && readyModels.has(model);

  const live = useRealtimeRecorder(captureId, noteId, enabled && canRecordLive, {
    model,
    language,
    notification,
  });
  const plain = useRecorder(captureId, noteId, enabled && !canRecordLive, notification);

  const active = canRecordLive ? live : plain;

  // Stopping is the one thing that must never depend on which engine the render
  // thinks is active: a settings change mid-recording would otherwise hand the
  // stop button to an engine that never started, leaving the microphone open.
  const stop = useCallback(async () => {
    const [liveOutcome, plainOutcome] = await Promise.all([live.stop(), plain.stop()]);
    return liveOutcome === 'noop' ? plainOutcome : liveOutcome;
  }, [live, plain]);

  return {
    phase: active.phase,
    levels: active.levels,
    durationMs: active.durationMs,
    stop,
    isLive: canRecordLive,
  };
}
