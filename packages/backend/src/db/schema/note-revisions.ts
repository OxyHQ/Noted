/**
 * Earlier versions of a note's own text, so a bad edit can be undone.
 *
 * Only what the user writes is versioned (title, body, checklist). The generated
 * half already has its own revision counters and is rebuilt from the recording,
 * and labels/pins/colour are cheap to put back by hand.
 *
 * A row is the state a note had BEFORE an edit replaced it, which is why
 * restoring one is itself an edit that snapshots the current text first: no
 * restore is ever destructive.
 */

import { index, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, generatedId } from '@oxy.so/db';

import { notes } from './notes.js';

export interface RevisionChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export const noteRevisions = pgTable(
  'note_revisions',
  {
    id: generatedId(),
    /** A real reference: hard-deleting a note takes its history with it. */
    noteId: text()
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    /** Denormalised from the note so the ownership check never needs a join. */
    oxyUserId: text().notNull(),
    title: text().notNull().default(''),
    body: text().notNull().default(''),
    checklist: jsonb().$type<RevisionChecklistItem[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index('note_revisions_note_idx').on(t.noteId, t.createdAt.desc())],
);

export type NoteRevisionRow = typeof noteRevisions.$inferSelect;
