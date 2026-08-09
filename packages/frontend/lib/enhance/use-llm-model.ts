/**
 * Whether this device has the language model, and getting it.
 *
 * Separate from the speech models because the choice is different in kind:
 * speech has three sizes to pick between and one is required for the feature to
 * work at all, while this is a single optional download that makes the notes
 * better. Sharing a hook would have meant a selection UI for a set of one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createLogger } from '@oxyhq/core/logger';

import {
  deleteLlmModel,
  downloadLlmModel,
  LLM_MODEL,
  llmModelState,
} from '@/lib/enhance/models';
import type { WeightsState } from '@/lib/models/weights';

const logger = createLogger('NotedEnhance');

export interface LlmModelResult {
  state: WeightsState;
  bytes: number;
  /** 0–1 while downloading, null otherwise. */
  progress: number | null;
  isLoading: boolean;
  download: () => Promise<void>;
  remove: () => Promise<void>;
}

export function useLlmModel(): LlmModelResult {
  const [state, setState] = useState<WeightsState | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  // A 469 MB download outlives the screen that started it, so finishing after
  // the user has navigated away is normal rather than exceptional.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const next = await llmModelState();
    if (mountedRef.current) setState(next);
  }, []);

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      logger.error('Could not read the language model state', { error: String(error) });
    });
  }, [refresh]);

  const download = useCallback(async () => {
    setProgress(0);
    setState('downloading');
    try {
      await downloadLlmModel((fraction) => {
        if (mountedRef.current) setProgress(fraction);
      });
    } finally {
      if (mountedRef.current) setProgress(null);
      await refresh().catch(() => undefined);
    }
  }, [refresh]);

  const remove = useCallback(async () => {
    await deleteLlmModel();
    await refresh();
  }, [refresh]);

  return {
    state: state ?? 'absent',
    bytes: LLM_MODEL.bytes,
    progress,
    isLoading: state === null,
    download,
    remove,
  };
}
