/**
 * The one thing every note generator produces.
 *
 * Today the rule-based structurer and the model each build their own shape and
 * each render it their own way, so a note quietly changes structure depending on
 * whether a model happened to be installed. That is the bug this file exists to
 * make impossible: both write a `GeneratedNoteArtifact`, one composer reads it,
 * and the note looks the same either way — only better or worse.
 *
 * Three properties are load-bearing and none of them are decoration:
 *
 * - **Every item has a stable id.** A live pass runs every few seconds; without
 *   identity the only thing it can do is throw the last note away and write a new
 *   one, which is why the current live note reorders and flickers, and why an
 *   item the user ticked cannot survive the next slice.
 * - **Every item records where it came from.** `sources` points back at the
 *   transcript, so a generated claim can be checked against what was actually
 *   said. An item with no sources is one nobody can verify — that is a fact worth
 *   being able to see, not one to hide.
 * - **Every item records who authorised it.** Ordinary discussion may only be
 *   reported, never extended. "Hablamos de hacer una pizza" does not license
 *   adding flour; "añade los ingredientes para una pizza" does. The difference is
 *   `origin`, and `instructionSource` is the receipt.
 */

/**
 * What kind of recording this is, which decides how the note is organised.
 *
 * `auto` means nobody has said, so the finaliser may classify. A user's choice is
 * never overwritten by classification — see `resolveProfile`.
 */
export type CaptureProfile =
  | 'auto'
  | 'meeting'
  | 'lecture'
  | 'event'
  | 'brainstorm'
  | 'interview'
  | 'dictation';

export const CAPTURE_PROFILES: readonly CaptureProfile[] = [
  'auto',
  'meeting',
  'lecture',
  'event',
  'brainstorm',
  'interview',
  'dictation',
];

/**
 * What the user is asking to be built, when they are dictating rather than
 * discussing.
 *
 * Separate from {@link CaptureProfile} because they answer different questions: a
 * profile says what the recording IS, an intent says what the note should BECOME.
 * A meeting can end with someone dictating a task list.
 */
export type DocumentIntent =
  | 'freeform'
  | 'checklist'
  | 'shopping-list'
  | 'task-list'
  | 'packing-list'
  | 'study-outline'
  | 'steps';

export const DOCUMENT_INTENTS: readonly DocumentIntent[] = [
  'freeform',
  'checklist',
  'shopping-list',
  'task-list',
  'packing-list',
  'study-outline',
  'steps',
];

/**
 * Provisional or settled.
 *
 * `live` is written while somebody is still talking and may be replaced wholesale
 * by the next revision. `final` is written once, after the whole recording has
 * been reconciled, and a `live` writer may never overwrite it — that barrier is
 * the difference between a note that settles and one that keeps twitching.
 */
export type ArtifactStage = 'live' | 'final';

/**
 * What later speech did to an item.
 *
 * The reason a note can be built while the meeting is still running: an item does
 * not have to be right forever, it has to be able to change honestly. A question
 * asked at 00:04 and answered at 00:31 becomes `resolved` rather than being
 * deleted and re-added, so its id — and anything the user did to it — survives.
 */
export type GeneratedItemStatus = 'active' | 'resolved' | 'superseded' | 'removed';

/**
 * Where an item's content came from, which is the whole trust model.
 *
 * - `transcript` — somebody said it. The default, and the only origin ordinary
 *   discussion can produce.
 * - `explicit-instruction` — the user told Noted to write it down.
 * - `derived-from-instruction` — Noted supplied it from its own knowledge because
 *   an instruction asked it to. The only origin that is not grounded in the
 *   recording, which is exactly why it is named rather than blended in.
 * - `legacy` — carried over from a note written before this domain existed. Its
 *   text is opaque Markdown; see `lib/artifact/legacy.ts`.
 */
export type GeneratedItemOrigin =
  | 'transcript'
  | 'explicit-instruction'
  | 'derived-from-instruction'
  | 'legacy';

/**
 * A stretch of the recording an item came from.
 *
 * Both the milliseconds and the segment ids are kept: the timestamps survive a
 * transcript that was re-segmented, and the ids survive audio that was deleted.
 */
export interface SourceRange {
  captureId: string;
  startMs: number;
  endMs: number;
  segmentIds: string[];
}

export interface GeneratedItem {
  id: string;
  text: string;
  status: GeneratedItemStatus;
  origin: GeneratedItemOrigin;
  /** Where in the recording this came from. Empty for derived and legacy items. */
  sources: SourceRange[];
  /** The instruction that authorised a derived item. */
  instructionSource?: SourceRange;
  /** Why a derived item was added, in the session's language, for the user to judge. */
  derivationReason?: string;
}

export type GeneratedSectionKind =
  | 'notes'
  | 'concepts'
  | 'examples'
  | 'ideas'
  | 'decisions'
  | 'takeaways'
  | 'custom';

/**
 * Everything a block carries regardless of what it is.
 *
 * Provenance lives at the smallest editable unit, which is what makes a note
 * checkable line by line rather than as a whole: a reader can ask where THIS
 * paragraph came from, and a later pass can retire it without touching the one
 * beside it.
 */
export interface GeneratedBlockBase {
  id: string;
  status: GeneratedItemStatus;
  origin: GeneratedItemOrigin;
  sources: SourceRange[];
  instructionSource?: SourceRange;
  derivationReason?: string;
}

/** One line of a list. Its own unit, because a reader edits one line, not the list. */
export interface GeneratedListItem {
  id: string;
  text: string;
  status: GeneratedItemStatus;
  origin: GeneratedItemOrigin;
  sources: SourceRange[];
}

/**
 * A piece of the document.
 *
 * The reason this is a union rather than an array of strings: a note about a
 * talk is mostly PROSE. Connected reasoning belongs in a paragraph, and forcing
 * it into bullets does not style it badly — it destroys the connection, because
 * a bullet list asserts that its lines are peers and a paragraph asserts that
 * they follow from each other.
 *
 * Deliberately four kinds and not forty. A note needs prose, two kinds of list
 * and a way to quote somebody exactly; tables and callouts are a different
 * product.
 */
export type GeneratedBlock =
  | (GeneratedBlockBase & { kind: 'paragraph'; text: string })
  | (GeneratedBlockBase & { kind: 'bullet-list'; items: GeneratedListItem[] })
  | (GeneratedBlockBase & { kind: 'numbered-list'; items: GeneratedListItem[] })
  /**
   * Somebody's words, kept as theirs.
   *
   * The one place first person is allowed to survive into the note, because a
   * quotation is explicitly not the note speaking.
   */
  | (GeneratedBlockBase & { kind: 'quote'; text: string; attribution?: string });

export interface GeneratedSection {
  id: string;
  kind: GeneratedSectionKind;
  /** Shown as the section heading. Absent means the blocks ARE the note. */
  heading?: string;
  blocks: GeneratedBlock[];
}

/**
 * Somebody the recording is about.
 *
 * Every field optional and every one source-grounded, because the failure mode
 * here is inventing a person. A talk whose speaker never says their name must
 * produce a note that does not contain one — the role is known, the name is not,
 * and the note has to be able to say exactly that.
 */
export interface GeneratedPerson {
  id: string;
  name?: string;
  role?: string;
  organization?: string;
  sources: SourceRange[];
}

export type GeneratedChecklistKind = 'actions' | 'shopping' | 'packing' | 'steps' | 'custom';

export interface GeneratedChecklistItem extends GeneratedItem {
  checked: boolean;
  /** "2 kg", "una docena" — kept apart from the text so a correction can replace it alone. */
  quantity?: string;
  /** For grouping a long list ("verdura", "lácteos") without splitting the checklist. */
  category?: string;
  owner?: string;
  dueAt?: string;
}

export interface GeneratedChecklist {
  id: string;
  kind: GeneratedChecklistKind;
  heading?: string;
  items: GeneratedChecklistItem[];
}

/**
 * Everything one generator produced for one note, at one revision.
 *
 * `transcriptRevision` is what makes a write safe to reject: a task that started
 * against revision 7 may not commit once revision 9 exists, because its view of
 * the meeting is missing the part that changed the answer. `artifactRevision`
 * moves on every commit, so two writers cannot silently interleave.
 */
export interface GeneratedNoteArtifact {
  id: string;
  noteId: string;
  captureId: string;
  stage: ArtifactStage;
  profile: CaptureProfile;
  intent: DocumentIntent;
  transcriptRevision: number;
  artifactRevision: number;
  /** The generated title. The user's own title always wins over it — see the composer. */
  title?: GeneratedItem;
  sections: GeneratedSection[];
  /** Who the recording is about, when the recording says. */
  people?: GeneratedPerson[];
  checklists: GeneratedChecklist[];
  /** Only what is genuinely still open. An answered question belongs in a section. */
  openQuestions: GeneratedItem[];
  /**
   * Knowledge the user authorised and nothing has supplied yet.
   *
   * "Añade todos los ingredientes para una pizza de pollo" is a permission, and
   * the deterministic pass can never act on it — it has nothing of its own to
   * contribute, and inventing a recipe is the exact failure the origin field
   * exists to prevent. So the permission is RECORDED, and the UI can say the
   * suggestion is pending rather than implying it happened.
   */
  pendingExpansions?: PendingExpansion[];
  createdAt: string;
  updatedAt: string;
}

/** An authorised expansion waiting for something able to perform it. */
export interface PendingExpansion {
  /** What the user asked to have completed — "una pizza de pollo". */
  subject: string;
  /** The sentence that granted the permission. */
  instructionSource: SourceRange;
}

/** Section and checklist headings, so the caller can translate them. */
export interface ArtifactLabels {
  decisions: string;
  questions: string;
  actions: string;
  concepts: string;
  examples: string;
  ideas: string;
  takeaways: string;
  shopping: string;
  packing: string;
  steps: string;
  /** Label for the person a recording is about. */
  speaker: string;
  /**
   * What the rule-based pass produces.
   *
   * Named for what it is. It selects sentences somebody said; calling that a
   * finished note is how a talk ended up reading as though the speaker had
   * written it.
   */
  highlights: string;
}

export const DEFAULT_ARTIFACT_LABELS: ArtifactLabels = {
  decisions: 'Decisions',
  questions: 'Open questions',
  actions: 'Actions',
  concepts: 'Concepts',
  examples: 'Examples',
  ideas: 'Ideas',
  takeaways: 'Takeaways',
  shopping: 'Shopping list',
  packing: 'Packing list',
  steps: 'Steps',
  speaker: 'Speaker',
  highlights: 'Transcript highlights',
};
