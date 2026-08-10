/**
 * What happened when the on-device model was asked to rewrite a note.
 *
 * This was a `boolean`, and `false` covered every one of these:
 *
 * - the capture or its settled artifact could not be read
 * - the device genuinely cannot run a model
 * - the model ran and returned prose instead of JSON
 * - the model ran and generation stopped mid-object
 * - the model ran and every paragraph was dropped for being longer than a
 *   bullet limit written years earlier
 * - the model produced a document and a newer artifact won the commit
 * - there was honestly nothing to improve
 *
 * The coordinator turned all of them into `enhancement: 'unsupported'`, which
 * the user reads as **"this device cannot organize them further."** Six of the
 * seven are not about the device, and three of them are retryable. Telling
 * somebody their laptop is incapable when the real answer is "ask again with
 * more room" is not a wording problem — it is the app being wrong about its own
 * state, and it is why #68 exists.
 *
 * Each arm below maps to a different thing the app must DO, which is the test
 * of whether a distinction is worth a type: retry, tell the user how to fix the
 * page, or say nothing because everything already worked.
 */

import type { LocalModelCapability } from '@/lib/enhance/contract';

export type EnhancementOutcome =
  /** The model wrote a better note and it landed. */
  | { kind: 'improved'; artifactRevision: number }
  /**
   * It ran, and what it produced was not an improvement.
   *
   * A complete answer, not a failure: the structured note is already on screen.
   */
  | { kind: 'no-change'; reason: 'equivalent' | 'nothing_useful' }
  /** It never ran. The only arm that is genuinely about this device or page. */
  | { kind: 'unavailable'; capability: LocalModelCapability }
  /**
   * It ran and the answer could not be used. Retryable, and worth retrying:
   * `truncated` in particular means the model was working and ran out of room.
   */
  | { kind: 'invalid-output'; reason: string }
  /** A newer artifact won the guarded commit. Ordinary superseded work. */
  | { kind: 'stale'; currentRevision: number };

/**
 * Whether asking again could plausibly produce a different answer.
 *
 * The property the UI needs, and the one the boolean destroyed: a truncated
 * reply and a missing GPU both used to offer the same dead-end message.
 */
export function isRetryable(outcome: EnhancementOutcome): boolean {
  return outcome.kind === 'invalid-output';
}
