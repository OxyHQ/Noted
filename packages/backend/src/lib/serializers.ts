/**
 * Row → client DTO serializers.
 *
 * These define the exact wire contract returned to the Noted app. They must
 * never leak storage internals (`oxyUserId`, `deletedAt`, `searchVector`), which
 * is why every field is listed rather than spread.
 */

import type { NoteDTO, LabelDTO } from '@noted/shared-types';
import { normalizeNoteColor } from '@noted/shared-types';

import type { NoteRow } from '../db/schema/notes.js';
import type { LabelRow } from '../db/schema/labels.js';

export function serializeNote(note: NoteRow): NoteDTO {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    checklist: note.checklist.map((item) => ({
      id: item.id,
      text: item.text,
      checked: item.checked,
    })),
    // Coerce legacy colors (e.g. darkblue/gray) to a valid value so a GET of an
    // old note never returns an out-of-enum color to the client.
    color: normalizeNoteColor(note.color),
    labels: note.labels,
    pinned: note.pinned,
    archived: note.archived,
    trashed: note.trashed,
    attachments: note.attachments,
    reminderAt: note.reminderAt ? note.reminderAt.toISOString() : null,
    order: note.sortOrder,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

export function serializeLabel(label: LabelRow): LabelDTO {
  return {
    id: label.id,
    name: label.name,
    // A label with no color stays null; a legacy color is coerced to a valid one.
    color: label.color === null ? null : normalizeNoteColor(label.color),
  };
}
