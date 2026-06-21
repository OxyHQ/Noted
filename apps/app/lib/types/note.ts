/**
 * Notes domain types — mirror the backend Notes API contract exactly.
 *
 * These are the canonical shapes returned by the API. Frontend code should
 * import from here rather than redefining note/label shapes locally.
 */

/**
 * The 12 note colors — identical to the backend `NOTE_COLORS` enum (this is a
 * stored API contract; the two MUST stay in sync). `default` means "no tint /
 * app surface"; the other 11 are exactly the standard (non-premium) Bloom color
 * presets, so a note's tint derives from the canonical Bloom color system.
 */
export const NOTE_COLORS = [
  "default",
  "teal",
  "blue",
  "green",
  "amber",
  "yellow",
  "red",
  "purple",
  "pink",
  "sky",
  "orange",
  "mint",
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

/** The color a brand-new note is created with (Keep-style yellow default). */
export const DEFAULT_NEW_NOTE_COLOR: NoteColor = "yellow";

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

export interface Label {
  id: string;
  name: string;
  color: NoteColor | null;
}

/** Which collection of notes the home screen is showing. */
export type NoteView = "active" | "archived" | "trashed";

/** Query params accepted by `GET /notes`. */
export interface NoteListParams {
  view?: NoteView;
  label?: string;
  pinned?: boolean;
  q?: string;
}
