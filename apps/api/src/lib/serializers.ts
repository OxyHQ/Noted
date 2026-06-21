/**
 * Doc → client DTO serializers.
 *
 * These define the exact wire contract returned to the Noted app. They must
 * never leak Mongo internals (`_id`, `__v`, `oxyUserId`).
 */

import type { INote } from '../models/note.js';
import type { ILabel } from '../models/label.js';

export interface NoteDTO {
  id: string;
  title: string;
  body: string;
  checklist: { id: string; text: string; checked: boolean }[];
  color: string;
  labels: string[];
  pinned: boolean;
  archived: boolean;
  trashed: boolean;
  images: { url: string; width?: number; height?: number }[];
  reminderAt: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface LabelDTO {
  id: string;
  name: string;
  color: string | null;
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
    color: note.color,
    labels: note.labels,
    pinned: note.pinned,
    archived: note.archived,
    trashed: note.trashed,
    images: note.images.map((img) => ({
      url: img.url,
      ...(img.width !== undefined ? { width: img.width } : {}),
      ...(img.height !== undefined ? { height: img.height } : {}),
    })),
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
    color: label.color ?? null,
  };
}
