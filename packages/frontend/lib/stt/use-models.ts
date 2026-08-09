/**
 * The speech models this device has, and the ones it could fetch.
 *
 * Model state is not in SQLite alone — the file on disk is the authority, since
 * a user who cleared the app's storage leaves rows claiming `ready` for weights
 * that are gone. So this reads through `getModelStates`, which checks both, and
 * refreshes after anything that could change the answer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createLogger } from '@oxyhq/core/logger';

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
}

const ORDER: SttModelId[] = ['tiny', 'base', 'small'];

export interface SttModelsResult {
  entries: ModelEntry[];
  isLoading: boolean;
  download: (id: SttModelId) => Promise<void>;
  remove: (id: SttModelId) => Promise<void>;
}

export function useSttModels(): SttModelsResult {
  const [states, setStates] = useState<Record<SttModelId, ModelState> | null>(null);
  const [progress, setProgress] = useState<Partial<Record<SttModelId, number>>>({});

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
    const next = await getModelStates();
    if (mountedRef.current) setStates(next);
  }, []);

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      logger.error('Could not read speech model state', { error: String(error) });
    });
  }, [refresh]);

  const download = useCallback(
    async (id: SttModelId) => {
      setProgress((current) => ({ ...current, [id]: 0 }));
      // Optimistic, so the row shows progress from the first frame rather than
      // after the first chunk lands — on a slow connection that is seconds of a
      // button that looks like it did nothing.
      setStates((current) => (current ? { ...current, [id]: 'downloading' } : current));
      try {
        await downloadModel(STT_MODELS[id], (fraction) => {
          if (mountedRef.current) setProgress((current) => ({ ...current, [id]: fraction }));
        });
      } finally {
        if (mountedRef.current) {
          setProgress((current) => {
            const next = { ...current };
            delete next[id];
            return next;
          });
        }
        await refresh().catch(() => undefined);
      }
    },
    [refresh],
  );

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
  }));

  return { entries, isLoading: states === null, download, remove };
}
