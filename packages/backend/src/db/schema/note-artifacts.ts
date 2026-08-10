/**
 * `note_artifacts` and `note_item_overrides` — what a recording produced, and
 * what the user did to it.
 *
 * A note's body is Markdown, and Markdown cannot say which sentence came from
 * which second of the recording, which line the user rewrote, or which revision
 * of the transcript a claim was checked against. That is why the artifact exists
 * at all, and why it has to reach the server: a recording made on a phone must
 * open on a laptop with its structure and its provenance intact, not as a
 * paragraph of text that has forgotten where it came from.
 *
 * ## Two tables, because they have two authors
 *
 * A later pass may rewrite an artifact freely. It may never touch an override —
 * that is the user's own edit, and it is the promise that makes editing a
 * generated note safe to do while the recording is still running. Folding them
 * into one row would put both authors on the same lock.
 *
 * ## Only `final` artifacts are stored
 *
 * A `live` artifact is written every few seconds while somebody is still
 * talking and is replaced wholesale by the next revision. Uploading it would be
 * a write per slice describing a recording that has not finished, and the
 * device that made it is the only one that can act on it.
 */

import { boolean, index, integer, jsonb, pgTable, primaryKey, text, unique } from 'drizzle-orm/pg-core';
import { createdAt, generatedId, updatedAt } from '@oxyhq/db';
import { CAPTURE_PROFILES, DOCUMENT_INTENTS } from '@noted/shared-types';
import type { GeneratedNoteArtifact } from '@noted/shared-types';

import { notes } from './notes.js';

/** The parts of an artifact that live inside `doc` rather than in a column. */
export type ArtifactDocument = Pick<
  GeneratedNoteArtifact,
  'title' | 'sections' | 'people' | 'checklists' | 'openQuestions' | 'pendingExpansions'
>;

export const noteArtifacts = pgTable(
  'note_artifacts',
  {
    id: generatedId(),
    /**
     * Deleting the note deletes what was generated for it. Unlike `oxyUserId`,
     * this one points at a row in this database, so the reference is real.
     */
    noteId: text()
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    /** Denormalised from the note so the ownership check never needs a join. */
    oxyUserId: text().notNull(),
    /** The recording. Minted on the device; this database never creates one. */
    captureId: text().notNull(),
    /**
     * Narrowed by the shared lists, the same way `notes.color` is: drizzle's
     * `enum` is a TypeScript narrowing rather than a database constraint, and
     * the validator at the route is what refuses a value that is not in them.
     */
    profile: text({ enum: CAPTURE_PROFILES }).notNull().default('auto'),
    intent: text({ enum: DOCUMENT_INTENTS }).notNull().default('freeform'),
    /**
     * The compare-and-swap pair.
     *
     * A device that has been offline holds an artifact built from an older
     * transcript, and its view of the recording is missing whatever changed the
     * answer. `transcriptRevision` is what lets the server refuse it without
     * having to know anything about the content; `artifactRevision` moves on
     * every commit so two writers cannot silently interleave.
     */
    transcriptRevision: integer().notNull().default(0),
    artifactRevision: integer().notNull().default(0),
    /**
     * Sections, checklists and open questions, as JSON.
     *
     * A full relational shredding — a row per item, a row per source range —
     * would buy the ability to query for "every item derived from an
     * instruction", which nothing wants, and cost a join per note read. The
     * revisions are columns precisely because the guard above is expressed in
     * SQL; nothing else is ever queried BY.
     */
    doc: jsonb()
      .$type<ArtifactDocument>()
      .notNull()
      .default({ sections: [], checklists: [], openQuestions: [] }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    /**
     * One final artifact per recording per note.
     *
     * `unique()` and not `uniqueIndex()`: drizzle-kit emits every foreign key
     * before every `CREATE UNIQUE INDEX`, so a constraint declared as an index
     * would not exist yet when something referenced it. This one is emitted
     * inline in `CREATE TABLE`.
     */
    unique('note_artifacts_slot').on(t.noteId, t.captureId),
    index('note_artifacts_by_note_idx').on(t.noteId),
    // The sync read: everything one user changed after an instant.
    index('note_artifacts_sync_idx').on(t.oxyUserId, t.updatedAt),
  ],
);

export const noteItemOverrides = pgTable(
  'note_item_overrides',
  {
    noteId: text()
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    oxyUserId: text().notNull(),
    /** The generated item's stable id. Nothing here is matched by text. */
    itemId: text().notNull(),
    /** Replacement text, or null when they only ticked or removed it. */
    text: text(),
    /** The tick the user set, or null when they never touched it. */
    checked: boolean(),
    removed: boolean().notNull().default(false),
    adopted: boolean().notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [
    // The row IS the pair; there is nothing else to identify it by.
    primaryKey({ columns: [t.noteId, t.itemId] }),
    index('note_item_overrides_by_note_idx').on(t.noteId),
    index('note_item_overrides_sync_idx').on(t.oxyUserId, t.updatedAt),
  ],
);
