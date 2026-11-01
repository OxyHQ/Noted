/**
 * The speech models this device has, and the ones it could fetch.
 *
 * Model state is not in SQLite alone — the file on disk is the authority, since
 * a user who cleared the app's storage leaves rows claiming `ready` for weights
 * that are gone. So this reads through `getModelStates`, which checks both, and
 * refreshes after anything that could change the answer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createLogger } from '@oxy.so/core/logger';

import {
  deleteModel,
  downloadModel,
  getModelStates,
  STT_MODELS,
  type ModelState,
  type SttModel,
  type SttModelId,
} from '@/lib/stt/models';

const logger = createLogger('NotedSTT');

export interface ModelEntry {
  model: SttModel;
  state: ModelState;
  /** 0–1 while downloading, null otherwise. */
  progress: number | null;
  /** The most recent attempt failed while this screen remained mounted. */
  downloadFailed: boolean;
  /** Local attempt that produced the current failure, if any. */
  failureVersion: number | null;
}

const ORDER: SttModelId[] = ['tiny', 'base', 'small'];

export interface SttModelsResult {
  entries: ModelEntry[];
  isLoading: boolean;
  loadFailed: boolean;
  retryLoad: () => void;
  download: (id: SttModelId) => Promise<void>;
  clearDownloadFailure: (id: SttModelId, version: number) => void;
  remove: (id: SttModelId) => Promise<void>;
}

export function useSttModels(): SttModelsResult {
  const [states, setStates] = useState<Record<SttModelId, ModelState> | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [progress, setProgress] = useState<Partial<Record<SttModelId, number>>>({});
  const [failures, setFailures] = useState<Partial<Record<SttModelId, number>>>({});
  const attemptsRef = useRef<Partial<Record<SttModelId, number>>>({});
  const runningRef = useRef<Partial<Record<SttModelId, number>>>({});
  const refreshVersionRef = useRef(0);

  // Guards every state write after an unmount: a download outlives the screen
  // that started it, and finishing after the user has navigated away is normal
  // rather than exceptional.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const version = ++refreshVersionRef.current;
    let next: Record<SttModelId, ModelState>;
    try {
      next = await getModelStates();
    } catch (error) {
      if (mountedRef.current && refreshVersionRef.current === version) setLoadFailed(true);
      throw error;
    }
    const current = refreshVersionRef.current === version;
    if (mountedRef.current && current) {
      const visible = { ...next };
      for (const id of ORDER) {
        if (runningRef.current[id] !== undefined) visible[id] = 'downloading';
      }
      setStates(visible);
      setLoadFailed(false);
    }
    return { states: next, version };
  }, []);

  const retryLoad = useCallback(() => {
    if (!mountedRef.current) return;
    setLoadFailed(false);
    void refresh().catch((error: unknown) => {
      logger.error('Could not read speech model state', { error: String(error) });
    });
  }, [refresh]);

  useEffect(() => {
    retryLoad();
  }, [retryLoad]);

  const download = useCallback(
    async (id: SttModelId) => {
      const attempt = (attemptsRef.current[id] ?? 0) + 1;
      attemptsRef.current[id] = attempt;
      runningRef.current[id] = attempt;
      setFailures((current) => ({ ...current, [id]: undefined }));
      setProgress((current) => ({ ...current, [id]: 0 }));
      // Optimistic, so the row shows progress from the first frame rather than
      // after the first chunk lands — on a slow connection that is seconds of a
      // button that looks like it did nothing.
      setStates((current) => (current ? { ...current, [id]: 'downloading' } : current));
      let failed = false;
      let failure: unknown;
      try {
        await downloadModel(STT_MODELS[id], (fraction) => {
          if (mountedRef.current && attemptsRef.current[id] === attempt) {
            setProgress((current) => ({ ...current, [id]: fraction }));
          }
        });
      } catch (error) {
        failed = true;
        failure = error;
        if (mountedRef.current && attemptsRef.current[id] === attempt) {
          setFailures((current) => ({ ...current, [id]: attempt }));
        }
      } finally {
        if (runningRef.current[id] === attempt) delete runningRef.current[id];
        if (mountedRef.current && attemptsRef.current[id] === attempt) {
          setProgress((current) => {
            const next = { ...current };
            delete next[id];
            return next;
          });
        }
      }
      try {
        const observed = await refresh();
        if (
          !failed &&
          (refreshVersionRef.current !== observed.version || observed.states[id] !== 'ready')
        ) {
          throw new Error('Downloaded model could not be confirmed');
        }
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
          if (mountedRef.current && attemptsRef.current[id] === attempt) {
            setFailures((current) => ({ ...current, [id]: attempt }));
          }
        }
      }
      if (!failed && attemptsRef.current[id] !== attempt) {
        failed = true;
        failure = new Error('A newer model download superseded this attempt');
      }
      if (failed) throw failure;
    },
    [refresh],
  );

  const clearDownloadFailure = useCallback((id: SttModelId, version: number) => {
    if (!mountedRef.current) return;
    setFailures((current) => (current[id] === version ? { ...current, [id]: undefined } : current));
  }, []);

  const remove = useCallback(
    async (id: SttModelId) => {
      await deleteModel(STT_MODELS[id]);
      await refresh();
    },
    [refresh],
  );

  const entries = ORDER.map((id) => ({
    model: STT_MODELS[id],
    state: states?.[id] ?? 'absent',
    progress: progress[id] ?? null,
    downloadFailed: failures[id] !== undefined,
    failureVersion: failures[id] ?? null,
  }));

  return {
    entries,
    isLoading: states === null && !loadFailed,
    loadFailed: states === null && loadFailed,
    retryLoad,
    download,
    clearDownloadFailure,
    remove,
  };
}
