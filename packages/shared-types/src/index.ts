/**
 * @noted/shared-types — the canonical Note/Label contract.
 *
 * This is the SINGLE SOURCE OF TRUTH for the shapes shared between the Noted
 * backend (the wire contract returned by the Notes API) and the frontend (what
 * the app renders). Both sides import these types from here rather than
 * redefining note/label shapes locally, so the two can never drift.
 *
 * The backend's mongoose models keep their own Document-bound interfaces
 * (`INote`, `ILabel`) — those carry Mongo internals (`_id`, `ObjectId`, …) and
 * are NOT part of this shared contract. The serialized DTOs the API returns are
 * exactly the {@link Note} / {@link Label} shapes below.
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
  'amber',
  'yellow',
  'red',
  'purple',
  'pink',
  'sky',
  'orange',
  'mint',
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

/** The color a brand-new note is created with (Keep-style yellow default). */
export const DEFAULT_NEW_NOTE_COLOR: NoteColor = 'yellow';

/**
 * Coerce any stored/incoming color string to a valid {@link NoteColor}.
 *
 * Legacy notes/labels may hold colors from the previous palette
 * (`darkblue`, `brown`, `gray`) that are no longer in the enum. Narrowing the
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
    const legacy: Record<string, NoteColor> = {
      darkblue: 'blue',
      brown: 'amber',
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
