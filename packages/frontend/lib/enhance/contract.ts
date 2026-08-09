/**
 * Reading the meeting, rather than pattern-matching it.
 *
 * The rule-based structurer (`lib/structure`) decides what matters by looking
 * for phrasings — "hay que", "decidimos", a question mark. That is cheap, works
 * everywhere, and is honestly not understanding: it cannot tell a decision from
 * someone describing a decision, and it has nothing to say about a meeting whose
 * important part was never phrased in a way it recognises.
 *
 * A language model on the device can. This is the contract it answers, and the
 * rules stay underneath it as the floor: the deterministic note is written
 * first, so a model that is absent, slow, or wrong never leaves the user with an
 * empty note.
 */

import type { ChecklistItem } from '@noted/shared-types';

/** Whether a device can run a model at all, before anything is asked of it. */
export type SummarizerAvailability =
  /** Ready now. */
  | 'ready'
  /** The device supports it but something must be fetched first. */
  | 'downloadable'
  /** No model can run here. */
  | 'unsupported';

/**
 * What the model is asked to produce.
 *
 * Deliberately the same shape the rule-based structurer produces, so the two are
 * interchangeable and the merge with the user's own writing is written once.
 */
export interface Enhancement {
  /** A title that names the meeting, not the moment it started. */
  title: string;
  /** The points worth reading again, in the meeting's own terms. */
  summary: string[];
  /** Things that were settled. */
  decisions: string[];
  /** Things someone agreed to do. */
  actions: string[];
  /** Things raised and left open. */
  questions: string[];
}

export interface EnhanceRequest {
  /** The cleaned transcript, oldest first. */
  transcript: readonly { atMs: number; text: string }[];
  /** What the user wrote themselves, which the model is told to preserve. */
  existing?: { title: string; body: string; checklist: readonly ChecklistItem[] };
  /** BCP-47-ish hint for the reply's language, or `auto`. */
  language: string;
}

export interface OnDeviceSummarizer {
  availability: () => Promise<SummarizerAvailability>;
  /**
   * Read the transcript and write the note.
   *
   * @returns null when the model could not produce something usable. Null is a
   *   normal outcome, not an exception: the deterministic note is already
   *   written, so "no improvement" is a complete answer.
   */
  enhance: (request: EnhanceRequest) => Promise<Enhancement | null>;
}
