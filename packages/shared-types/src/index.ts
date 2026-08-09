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
  createdAt: string;
  updatedAt: string;
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
