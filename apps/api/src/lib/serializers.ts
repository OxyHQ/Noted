/**
 * Doc → client DTO serializers.
 *
 * These define the exact wire contract returned to the Noted app. They must
 * never leak Mongo internals (`_id`, `__v`, `oxyUserId`).
 */

import type { INote, NoteColor } from '../models/note.js';
import { normalizeNoteColor } from '../models/note.js';
import type { ILabel } from '../models/label.js';

export interface NoteDTO {
  id: string;
  title: string;
  body: string;
  checklist: { id: string; text: string; checked: boolean }[];
  color: NoteColor;
  labels: string[];
  pinned: boolean;
  archived: boolean;
  trashed: boolean;
  /** Oxy file-manager file IDs (any file type). */
  attachments: string[];
  reminderAt: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface LabelDTO {
  id: string;
  name: string;
  color: NoteColor | null;
}

export function serializeNote(note: INote): NoteDTO {
  return {
    id: note._id.toString(),
    title: note.title,
    body: note.body,
    checklist: note.checklist.map((item) => ({
      id: item.id,
      text: item.text,
      checked: item.checked,
    })),
    // Coerce legacy colors (e.g. darkblue/brown/gray) to a valid value so a
    // GET of an old note never returns an out-of-enum color to the client.
    color: normalizeNoteColor(note.color),
    labels: note.labels,
    pinned: note.pinned,
    archived: note.archived,
    trashed: note.trashed,
    attachments: note.attachments ?? [],
    reminderAt: note.reminderAt ? note.reminderAt.toISOString() : null,
    order: note.order,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

export function serializeLabel(label: ILabel): LabelDTO {
  return {
    id: label._id.toString(),
    name: label.name,
    // A label with no color stays null; a legacy color is coerced to a valid one.
    color: label.color === null || label.color === undefined ? null : normalizeNoteColor(label.color),
  };
}
