/**
 * Whether a generated document is checkable enough to replace the note.
 *
 * The deterministic floor selects sentences somebody actually said, so every
 * line of it points at a moment in the recording. A model's document is prose it
 * wrote, and it is only worth more than those fragments if a reader can still
 * check it — which is the entire reason `sources` exists.
 *
 * ## Why this is a gate and not a warning
 *
 * Measured on a real device, four runs of the same model over the same
 * transcript: 4 of 13 blocks grounded, 4 of 8, and — in one run — **0 of 16**.
 * Same prompt, same recording. That last document was sixteen paragraphs of
 * fluent prose about a talk, with nothing tying any of it to what was said, and
 * publishing it would have replaced checkable highlights with something nobody
 * can verify. It reads better. That is the problem.
 *
 * So a document that cannot be checked does not win. The note keeps the
 * extractive floor, the outcome says why, and the user can retry.
 *
 * ## The threshold, and why it is not 100%
 *
 * A summary legitimately contains connective sentences that belong to no single
 * line — "the speaker then turned to funding" — and demanding a citation for
 * every one of them would refuse good documents. What is not legitimate is a
 * document where the ordinary case is ungrounded. Half is the line: below it,
 * more of the note is unverifiable than verifiable.
 */

import { allItems } from '@/lib/artifact/artifact';
import type { GeneratedNoteArtifact } from '@noted/shared-types';

/** Below this fraction of grounded units, the document is not an improvement. */
export const MIN_GROUNDED_RATIO = 0.5;

export interface Grounding {
  units: number;
  grounded: number;
  /** 1 when there is nothing to check, so an empty document is not "ungrounded". */
  ratio: number;
}

export function groundingOf(artifact: GeneratedNoteArtifact): Grounding {
  // Only what the model claims came from the recording. A `derived` item carries
  // its authorisation instead, and a `legacy` one predates the whole mechanism —
  // counting either as ungrounded would refuse documents for the wrong reason.
  const units = allItems(artifact).filter((unit) => unit.origin === 'transcript');
  const grounded = units.filter((unit) => unit.sources.length > 0).length;
  return {
    units: units.length,
    grounded,
    ratio: units.length === 0 ? 1 : grounded / units.length,
  };
}

/** Whether this document may replace the deterministic note. */
export function isCheckable(artifact: GeneratedNoteArtifact): boolean {
  return groundingOf(artifact).ratio >= MIN_GROUNDED_RATIO;
}
