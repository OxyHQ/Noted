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
import type { CaptureProfile, DocumentIntent, PendingExpansion } from '@noted/shared-types';
import type { BlockType } from '@/lib/enhance/schema';

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
 * One line of a list the model wrote.
 *
 * `sources` are LINE NUMBERS of the window the model was shown, not segment ids:
 * a small model handles `[3, 4]` far better than it handles
 * `["cap_x#0.12", "cap_x#0.13"]`, and the mapping back is exact because the
 * caller built the window.
 */
export interface EnhancementListItem {
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

/** A piece of the document the model wrote. */
export interface EnhancementBlock {
  type: BlockType;
  /** Present for `paragraph` and `quote`. */
  text?: string;
  /** Present for the two list types. */
  items?: EnhancementListItem[];
  /** Present for `quote`, when the model knows whose words they are. */
  attribution?: string;
  sources: number[];
}

export interface EnhancementSection {
  heading?: string;
  blocks: EnhancementBlock[];
}

export interface EnhancementPerson {
  name?: string;
  role?: string;
  organization?: string;
  sources: number[];
}

/**
 * What the model is asked to produce: a document.
 *
 * Not four arrays of short lines. That shape could only ever express a bullet
 * summary, so a model that understood a talk perfectly still had nowhere to put
 * a paragraph, a heading or who was speaking.
 */
export interface Enhancement {
  /** What the model thinks this recording is. A user's own choice still wins. */
  profile?: CaptureProfile;
  /** A short, specific title for what was discussed. */
  title: string;
  /** Who the recording is about, when it says. */
  people: EnhancementPerson[];
  /** The document itself, organised by subject. */
  sections: EnhancementSection[];
  /** Concrete next steps someone committed to or was assigned. */
  actions: EnhancementListItem[];
  /**
   * Important matters genuinely left unresolved.
   *
   * Deliberately not "every question asked": a question that got an answer
   * belongs in the notes as the answer, and a rhetorical one belongs nowhere.
   */
  openQuestions: EnhancementListItem[];
  /**
   * Items to add to a list the user dictated.
   *
   * Empty unless the request carried an authorisation. This is the only field
   * through which knowledge the recording does not contain may enter a note.
   */
  listAdditions: EnhancementListItem[];
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
 * Citations turned into segment ids.
 *
 * The model cites line numbers of the window it was shown, which are meaningless
 * outside that window. They are resolved while the window is still in hand rather
 * than carried around as numbers nobody can interpret later.
 */
export interface Resolved {
  /** Transcript segments this came from. Empty means nothing supports it. */
  segmentIds: string[];
  /** The start of the earliest line cited, for a reader jumping to the audio. */
  atMs: number | null;
}

export type ResolvedItem = Resolved & {
  text: string;
  derived?: { subject: string; reason: string };
};

export type ResolvedBlock = Resolved & {
  type: BlockType;
  text?: string;
  items?: ResolvedItem[];
  attribution?: string;
};

export interface ResolvedSection {
  heading?: string;
  blocks: ResolvedBlock[];
}

export type ResolvedPerson = Resolved & {
  name?: string;
  role?: string;
  organization?: string;
};

export interface ResolvedEnhancement {
  profile?: CaptureProfile;
  title: string;
  people: ResolvedPerson[];
  sections: ResolvedSection[];
  actions: ResolvedItem[];
  openQuestions: ResolvedItem[];
  listAdditions: ResolvedItem[];
}

/**
 * Whether a model can run here, and when it cannot, exactly what stopped it.
 *
 * The browser used to answer this with `(await requestAdapter()) !== null`, and
 * every "no" became one sentence to the user: *this device cannot organize
 * them further*. Three of the reasons below are not about the device at all —
 * a page served over plain HTTP, a browser without `navigator.gpu`, a runtime
 * that failed to initialise — and telling somebody their laptop is incapable
 * when the actual fix is the URL is worse than saying nothing.
 *
 * Deliberately carries no GPU identifiers. The adapter's vendor and device
 * strings are a fingerprinting surface and none of them are needed to explain
 * what happened.
 */
export type LocalModelCapability =
  | {
      kind: 'ready';
      backend: 'webgpu' | 'native';
      dtype: 'q4f16' | 'q4';
      /** Whether half-precision shaders are available, which decides the dtype. */
      shaderF16: boolean;
    }
  | {
      kind: 'unavailable';
      reason:
        /** Not HTTPS or localhost: `navigator.gpu` is withheld from the page. */
        | 'insecure_context'
        | 'navigator_gpu_missing'
        | 'adapter_unavailable'
        /** An adapter exists and would not give up a device. */
        | 'device_request_failed'
        | 'runtime_initialization_failed'
        | 'model_files_unavailable';
    };

/**
 * What one attempt at the model produced.
 *
 * The three arms are the distinction the old `ResolvedEnhancement | null` could
 * not make: the model never ran, the model ran and its answer was unusable, or
 * it worked. Only the first is a statement about the device.
 */
export type EnhanceAttempt =
  | { ok: true; value: ResolvedEnhancement; diagnostics: EnhanceDiagnostics }
  | { ok: false; kind: 'unavailable'; capability: LocalModelCapability }
  | { ok: false; kind: 'invalid-output'; reason: string; diagnostics: EnhanceDiagnostics };

/**
 * What the run saw, in numbers, for the caller to log or show.
 *
 * The parser computed these and `summarize` accumulated them, and then this
 * type threw them away — so the one question a real run raised could not be
 * answered from outside: a document whose every block came back with NO source
 * range is either a model that ignores the citation field, or a model that
 * cites lines it was never shown and has them all dropped. Those need opposite
 * fixes, and `invalidSourceRefs` is the number that tells them apart.
 *
 * Counts only. No transcript, no model output.
 */
export interface EnhanceDiagnostics {
  windows: number;
  /** Windows whose reply produced a usable document. */
  windowsAccepted: number;
  blocksAccepted: number;
  blocksDropped: number;
  oversizeDropped: number;
  /** Citations to lines the model was never shown, summed over windows. */
  invalidSourceRefs: number;
  /**
   * Whether the runtime reported hitting its token ceiling.
   *
   * `null` when it could not be measured, which is a different fact from
   * `false`: `false` says the model chose to stop and left its object open — a
   * quality failure the budget cannot fix — while `null` says nobody knows.
   */
  hitGenerationCap: boolean | null;
}

export interface OnDeviceSummarizer {
  /**
   * Probed once per runtime lifecycle and cached — see the backends.
   *
   * It used to request an adapter three separate times per enhancement, so the
   * answer that chose the dtype was not necessarily the answer the inference
   * runtime later got.
   */
  capability: () => Promise<LocalModelCapability>;
  /** Read the transcript and write the note, or say why it could not. */
  enhance: (request: EnhanceRequest) => Promise<EnhanceAttempt>;
}
