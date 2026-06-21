/**
 * Notes domain types — mirror the backend Notes API contract exactly.
 *
 * These are the canonical shapes returned by the API. Frontend code should
 * import from here rather than redefining note/label shapes locally.
 */

export const NOTE_COLORS = [
  "default",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "darkblue",
  "purple",
  "pink",
  "brown",
  "gray",
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface NoteImage {
  url: string;
  width?: number;
  height?: number;
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
  images: NoteImage[];
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
