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
    availability: () => Promise.resolve('unsupported'),
    enhance: () => Promise.resolve(null),
  };
}

/** Free the loaded model (low memory, sign-out). */
export function releaseSummarizer(): Promise<void> {
  return Promise.resolve();
}
