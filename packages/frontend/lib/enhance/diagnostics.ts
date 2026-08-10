/**
 * What to tell somebody whose enhanced notes did not arrive.
 *
 * #68 was reported from a machine with a secure context, `navigator.gpu`, an
 * adapter AND a `GPUDevice` — and the app said *this device cannot organize
 * them further*. Nobody could tell from the outside which of eight things had
 * actually happened, so the first hour of that investigation was spent pasting
 * expressions into a console by hand.
 *
 * This is that by-hand check, made part of the app. It is deliberately small:
 * enough to say WHICH branch a user is in, and nothing that identifies their
 * machine.
 *
 * ## What it must never include
 *
 * The adapter's vendor, architecture, device or driver strings. They are a
 * fingerprinting surface, they are not needed to explain any of the outcomes,
 * and a diagnostic that people are encouraged to paste into a support thread is
 * the last place to start collecting them. Same for the transcript and anything
 * the model wrote — a support report is not a reason to copy somebody's meeting
 * off their device.
 */

import type { LocalModelCapability } from '@/lib/enhance/contract';
import { getSummarizer } from '@/lib/enhance/summarizer';

export interface EnhanceDiagnostics {
  /** Whether the page can be offered WebGPU at all. */
  secureContext: boolean;
  /** Whether the browser exposes the API, before anything is asked of it. */
  webGpuExposed: boolean;
  capability: LocalModelCapability;
  /** How long the probe took, which is itself a signal on a cold driver. */
  probeMs: number;
}

/**
 * Run the real capability probe and report what it found.
 *
 * The same call the enhancement path makes, not a re-implementation of it: a
 * diagnostic that asks its own question can disagree with the code it is meant
 * to explain, and then it is worse than nothing.
 */
export async function collectDiagnostics(): Promise<EnhanceDiagnostics> {
  const started = Date.now();
  const capability = await getSummarizer().capability();
  return {
    secureContext: typeof window === 'undefined' ? true : window.isSecureContext !== false,
    webGpuExposed: typeof navigator !== 'undefined' && 'gpu' in navigator,
    capability,
    probeMs: Date.now() - started,
  };
}

/**
 * The diagnostic as a line somebody can paste into an issue.
 *
 * Fixed keys in a fixed order so two reports can be compared, and no free text
 * from anywhere else in the app.
 */
export function formatDiagnostics(diagnostics: EnhanceDiagnostics): string {
  const { capability } = diagnostics;
  const detail =
    capability.kind === 'ready'
      ? `ready backend=${capability.backend} dtype=${capability.dtype} shaderF16=${String(capability.shaderF16)}`
      : `unavailable reason=${capability.reason}`;
  return [
    `secureContext=${String(diagnostics.secureContext)}`,
    `webGpuExposed=${String(diagnostics.webGpuExposed)}`,
    detail,
    `probeMs=${String(diagnostics.probeMs)}`,
  ].join(' ');
}
