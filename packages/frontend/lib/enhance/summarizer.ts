/**
 * Running a language model on this device — the neutral build.
 *
 * Metro resolves `summarizer.native.ts` on a phone. This file is what a browser,
 * `tsc` and any non-Metro bundler get, so it must not import `llama.rn`.
 *
 * Reporting `unsupported` is the whole implementation, and it is a complete
 * answer rather than a stub: the deterministic note is written first everywhere,
 * so a device that cannot run a model loses nothing it ever had.
 */

import type { OnDeviceSummarizer } from '@/lib/enhance/contract';

export function getSummarizer(): OnDeviceSummarizer {
  return {
    // `model_files_unavailable` rather than a hardware reason: this build is the
    // one no platform backend claimed, so nothing about the machine is known.
    capability: () => Promise.resolve({ kind: 'unavailable', reason: 'model_files_unavailable' }),
    enhance: () =>
      Promise.resolve({
        ok: false,
        kind: 'unavailable',
        capability: { kind: 'unavailable', reason: 'model_files_unavailable' },
      }),
  };
}

/** Free the loaded model (low memory, sign-out). */
export function releaseSummarizer(): Promise<void> {
  return Promise.resolve();
}
