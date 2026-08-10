/**
 * @noted/shared-types — the canonical Note/Label contract.
 *
 * This is the SINGLE SOURCE OF TRUTH for the shapes shared between the Noted
 * backend (the wire contract returned by the Notes API) and the frontend (what
 * the app renders). Both sides import these types from here rather than
 * redefining note/label shapes locally, so the two can never drift.
 *
 * The backend's drizzle tables keep their own row types (`NoteRow`, `LabelRow`)
 * — those carry storage-only columns (`oxyUserId`, `deletedAt`, `searchVector`)
 * and are NOT part of this shared contract. The serialized DTOs the API returns
 * are exactly the {@link Note} / {@link Label} shapes below.
 */

/**
 * The 12 note colors — a stored API contract shared with the client (the
 * backend's `NOTE_COLORS` enum and this list MUST stay in sync; they are now
 * one and the same). `default` means "no tint / app surface"; the other 11 are
 * exactly the standard (non-premium) Bloom color presets
 * (`@oxyhq/bloom/theme` `APP_COLOR_PRESETS`), so a note's tint derives from the
 * canonical Bloom color system on the client.
 */
export const NOTE_COLORS = [
  'default',
  'teal',
  'blue',
  'green',
  'yellow',
  'red',
  'purple',
  'pink',
  'sky',
  'orange',
  'mint',
  'pumpkin',
  'brown',
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

/** The color a brand-new note is created with (Keep-style yellow default). */
export const DEFAULT_NEW_NOTE_COLOR: NoteColor = 'yellow';

/**
 * Coerce any stored/incoming color string to a valid {@link NoteColor}.
 *
 * Legacy notes/labels may hold colors that are not in the enum (`darkblue`,
 * `gray`), or that Bloom has since removed (`amber`). Narrowing the
 * enum would otherwise make a `.save()`/PATCH of such a document fail
 * validation, so reads and writes funnel through here: legacy values map to
 * their closest current hue, and anything unrecognised falls back to
 * `default`. This keeps the API tolerant of old data without a migration.
 *
 * Pure (no mongoose dependency), so it lives in the shared contract and is used
 * by both the API serializers/routes and any client validation.
 */
export function normalizeNoteColor(color: unknown): NoteColor {
  if (typeof color === 'string') {
    if ((NOTE_COLORS as readonly string[]).includes(color)) {
      return color as NoteColor;
    }
    // `amber` was a Bloom preset until it was removed there: at the tones a white
    // label needs it flattened to the same gold as `pumpkin`, so the picker was
    // offering a choice that did nothing. `pumpkin` is what it became, which is
    // why it is the target rather than a neighbour chosen by eye.
    //
    // `brown` is NOT in this table any more: it used to be coerced to `amber`
    // because Bloom had no brown of its own, and now it does — so it is a real
    // enum member above and the check before this one already returns it.
    const legacy: Record<string, NoteColor> = {
      darkblue: 'blue',
      amber: 'pumpkin',
      gray: 'default',
    };
    if (color in legacy) return legacy[color];
  }
  return 'default';
}

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  checklist: ChecklistItem[];
  color: NoteColor;
  labels: string[];
  pinned: boolean;
  archived: boolean;
  trashed: boolean;
  /**
   * Oxy file IDs of attached files of any type (image, pdf, doc, audio, video,
   * etc.). Stored as plain file IDs; per-file metadata (filename/contentType/
   * size) is fetched by ID at render time. Images resolve via
   * `getFileDownloadUrl`; non-image attachments render as type chips.
   */
  attachments: string[];
  reminderAt: string | null;
  order: number;
  /**
   * What a recording produced for this note, and what the user did to it.
   *
   * Both travel with the note rather than on endpoints of their own, because
   * they are only ever read together with it and a note that arrived without
   * them would render generated text the user had already edited away. Only
   * `final` artifacts cross the wire — a `live` one is replaced wholesale every
   * few seconds and describes a recording that is still happening.
   *
   * Absent means "I have nothing to say about them", not "there are none": a
   * client that does not send the field leaves whatever the server holds alone.
   */
  artifacts?: GeneratedNoteArtifact[];
  itemOverrides?: UserItemOverride[];
  createdAt: string;
  updatedAt: string;
}

/**
 * What the user did to one generated item, keyed by that item's stable id.
 *
 * Kept beside the artifact rather than inside it, because they have different
 * authors: a later pass may rewrite the artifact freely and must never touch
 * this. That separation is what makes editing a generated note safe to do while
 * the recording is still running.
 */
export interface UserItemOverride {
  itemId: string;
  /** Replacement text, or null when they only ticked or removed it. */
  text: string | null;
  /** The tick the user set, or null when they never touched it. */
  checked: boolean | null;
  /** They deleted it. Later passes may not bring it back. */
  removed: boolean;
  /**
   * They took it as their own.
   *
   * An adopted item is no longer the app's to reword or retire; it survives
   * every later pass untouched.
   */
  adopted: boolean;
}

/**
 * The serialized note DTO returned by the API. Structurally identical to
 * {@link Note} — kept as an alias so backend code that refers to `NoteDTO`
 * reads naturally without duplicating the shape.
 */
export type NoteDTO = Note;

export interface Label {
  id: string;
  name: string;
  color: NoteColor | null;
}

/** The serialized label DTO returned by the API (alias of {@link Label}). */
export type LabelDTO = Label;

/** Which collection of notes the home screen is showing. */
export type NoteView = 'active' | 'archived' | 'trashed';

/** Query params accepted by `GET /notes`. */
export interface NoteListParams {
  view?: NoteView;
  label?: string;
  pinned?: boolean;
  q?: string;
}

/**
 * The one thing every note generator produces, and the one both halves read.
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
export const CAPTURE_PROFILES = [
  'auto',
  'meeting',
  'lecture',
  'event',
  'brainstorm',
  'interview',
  'dictation',
] as const;

/**
 * Derived from the list rather than declared beside it.
 *
 * The two are the same fact, and written twice they are free to drift — a
 * profile added to one and not the other is a value the type permits and no
 * validator accepts, or the reverse. Deriving also makes the tuple usable
 * directly as a schema enum, so the server validates against this exact list.
 */
export type CaptureProfile = (typeof CAPTURE_PROFILES)[number];

/**
 * What the user is asking to be built, when they are dictating rather than
 * discussing.
 *
 * Separate from {@link CaptureProfile} because they answer different questions: a
 * profile says what the recording IS, an intent says what the note should BECOME.
 * A meeting can end with someone dictating a task list.
 */
export const DOCUMENT_INTENTS = [
  'freeform',
  'checklist',
  'shopping-list',
  'task-list',
  'packing-list',
  'study-outline',
  'steps',
] as const;

/** Derived from the list above, for the same reason {@link CaptureProfile} is. */
export type DocumentIntent = (typeof DOCUMENT_INTENTS)[number];

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
