/**
 * Reading the meeting, rather than pattern-matching it.
 *
 * The rule-based generator (`lib/artifact/generate/deterministic.ts`) decides
 * what matters by looking for phrasings — "hay que", "decidimos", a question
 * mark. That is cheap, works everywhere, and is honestly not understanding: it
 * cannot tell a decision from someone describing a decision, and it has nothing
 * to say about a meeting whose important part was never phrased in a way it
 * recognises.
 *
 * A language model on the device can. This is the contract it answers, and the
 * rules stay underneath it as the floor: the deterministic artifact is written
 * first, so a model that is absent, slow, or wrong never leaves the user with an
 * empty note.
 *
 * ## Why every item carries its sources
 *
 * A model writes fluent prose, which is exactly what makes it dangerous here: an
 * invented claim reads better than a real one. So it is asked to say WHICH lines
 * of the transcript each note came from, and those references are checked against
 * the lines it was actually shown. A reference to a line that does not exist is
 * dropped rather than trusted — and an item left with no sources is visibly
 * ungrounded rather than quietly indistinguishable from one that is.
 */

import type { ChecklistItem } from '@noted/shared-types';
import type { CaptureProfile, DocumentIntent, PendingExpansion } from '@/lib/artifact/types';

/** Whether a device can run a model at all, before anything is asked of it. */
export type SummarizerAvailability =
  /** Ready now. */
  | 'ready'
  /** The device supports it but something must be fetched first. */
  | 'downloadable'
  /** No model can run here. */
  | 'unsupported';

/**
 * What the model is doing right now.
 *
 * Reported rather than inferred, because the honest states are far apart in
 * duration: a 300 MB download and a two-second load look identical from outside,
 * and "Organizing notes…" over a silent download is the thing that made the stop
 * button feel broken.
 */
export type SummarizerStage = 'downloading' | 'loading' | 'generating';

export interface SummarizerProgress {
  stage: SummarizerStage;
  /** 0–1 where the stage can measure itself, null where it cannot. */
  ratio: number | null;
  /** Which window of the transcript, when there is more than one. */
  window?: { index: number; total: number };
}

/**
 * One thing the model wrote, and where it got it.
 *
 * `sources` are LINE NUMBERS of the window the model was shown, not segment ids:
 * a small model handles `[3, 4]` far better than it handles
 * `["cap_x#0.12", "cap_x#0.13"]`, and the mapping back is exact because the
 * caller built the window.
 */
export interface EnhancementItem {
  text: string;
  sources: number[];
  /**
   * Set when this is knowledge the model supplied rather than something said.
   *
   * Only legal when the request carried an authorisation for it. `subject` names
   * which one, so the item can point back at the sentence that permitted it.
   */
  derived?: { subject: string; reason: string };
}

/**
 * What the model is asked to produce.
 *
 * Deliberately the same shape the rule-based generator produces, so the two are
 * interchangeable and the merge with the user's own writing is written once.
 */
export interface Enhancement {
  /** A short, specific title for what was discussed. */
  title: string;
  /**
   * The notes themselves — what someone would keep and refer back to.
   *
   * Not a summary of the conversation: the useful content, with the
   * conversational shape taken out. This is the note's body.
   */
  notes: EnhancementItem[];
  /** Concrete next steps someone committed to or was assigned. */
  actions: EnhancementItem[];
  /**
   * Important matters genuinely left unresolved.
   *
   * Deliberately not "every question asked": a question that got an answer
   * belongs in the notes as the answer.
   */
  openQuestions: EnhancementItem[];
  /**
   * Items to add to a list the user dictated.
   *
   * Empty unless the request carried an authorisation. This is the only field
   * through which knowledge the recording does not contain may enter a note.
   */
  listAdditions: EnhancementItem[];
}

/** One line of transcript as the model is shown it. */
export interface EnhanceLine {
  atMs: number;
  text: string;
  /** The segments behind this line, so a reference can be resolved to evidence. */
  segmentIds: string[];
}

export interface EnhanceRequest {
  /** The cleaned transcript, oldest first. */
  transcript: readonly EnhanceLine[];
  /** What the user wrote themselves, which the model is told to preserve. */
  existing?: { title: string; body: string; checklist: readonly ChecklistItem[] };
  /** BCP-47-ish hint for the reply's language, or `auto`. */
  language: string;
  /** How the note should be organised. */
  profile: CaptureProfile;
  /** What the user is building, when they are dictating rather than discussing. */
  intent: DocumentIntent;
  /**
   * The expansions the user authorised out loud.
   *
   * The ONLY thing that lets the model contribute knowledge of its own. Empty —
   * which is almost always — means everything it writes must come from the
   * transcript.
   */
  expansions: readonly PendingExpansion[];
  onProgress?: (progress: SummarizerProgress) => void;
}

/**
 * One thing the model wrote, with its citations turned into segment ids.
 *
 * The model cites line numbers of the window it was shown, which are meaningless
 * outside that window. They are resolved while the window is still in hand rather
 * than carried around as numbers nobody can interpret later — so this, not
 * {@link EnhancementItem}, is what leaves the enhancement path.
 */
export interface ResolvedItem {
  text: string;
  /** Transcript segments this came from. Empty means nothing supports it. */
  segmentIds: string[];
  /** The start of the earliest line cited, for a reader jumping to the audio. */
  atMs: number | null;
  derived?: { subject: string; reason: string };
}

export interface ResolvedEnhancement {
  title: string;
  notes: ResolvedItem[];
  actions: ResolvedItem[];
  openQuestions: ResolvedItem[];
  listAdditions: ResolvedItem[];
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
  enhance: (request: EnhanceRequest) => Promise<ResolvedEnhancement | null>;
}
