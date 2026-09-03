/**
 * `notes` — the app's central table.
 *
 * Two conventions that apply to every table here:
 *
 * 1. **`oxyUserId` carries no foreign key, and never will.** Oxy owns identity,
 *    so every user id in this database is a foreign service's primary key
 *    reached over HTTP; there is nothing here for `.references()` to point at.
 *    The same goes for the Oxy file ids in `attachments`.
 * 2. **Columns are declared camelCase and named by the casing authority.**
 *    `oxyUserId` becomes `oxy_user_id` in SQL because `DATABASE_CASING` is
 *    passed both to the runtime handle and to drizzle-kit. Never spell the SQL
 *    name by hand.
 */

import { sql, type SQL } from 'drizzle-orm';
import { boolean, doublePrecision, index, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, generatedId, timestamptz, tsvector, updatedAt } from '@oxyhq/db';
import { NOTE_COLORS, type ChecklistItem } from '@noted/shared-types';

export const notes = pgTable(
  'notes',
  {
    /** A UUIDv7 text primary key. Clients may mint it so a note written offline
     *  keeps one id from creation through upload. */
    id: generatedId(),
    /** An Oxy account id — a foreign service's key, so no foreign key here. */
    oxyUserId: text().notNull(),
    /** `note` for a typed note, `voice` for one captured from a recording. */
    kind: text({ enum: ['note', 'voice'] })
      .notNull()
      .default('note'),
    title: text().notNull().default(''),
    body: text().notNull().default(''),
    /** Checklist items in their display order. */
    checklist: jsonb().$type<ChecklistItem[]>().notNull().default([]),
    color: text({ enum: NOTE_COLORS }).notNull().default('default'),
    /**
     * Label ids. An array rather than a join table because a note carries a
     * handful of them, they are always read with the note, and `@>` over a GIN
     * index answers "notes with this label" without a join.
     */
    labels: text().array().notNull().default(sql`'{}'`),
    pinned: boolean().notNull().default(false),
    archived: boolean().notNull().default(false),
    trashed: boolean().notNull().default(false),
    /** Oxy file-manager ids of any type. Bytes live in Oxy storage, not here. */
    attachments: text().array().notNull().default(sql`'{}'`),
    reminderAt: timestamptz(),
    /** Set when the reminder event was atomically placed in the durable outbox. */
    reminderQueuedAt: timestamptz(),
    /** Set once the current reminder has been delivered — keeps the sweep idempotent. */
    reminderSentAt: timestamptz(),
    /** Explicit position within a view, set by drag-reorder. */
    sortOrder: doublePrecision().notNull().default(0),
    /**
     * Tombstone for "delete forever". The row survives the deletion so an
     * offline client can still learn the note is gone rather than re-uploading
     * it forever. Its content is cleared at deletion time; only the fact
     * remains, and the expiry registry drops the row a month later.
     *
     * REGISTERED FOR SWEEPING in `db/expiry.ts` — Postgres has no TTL index, so
     * without that entry this table would grow without bound and nothing would
     * ever say so.
     */
    deletedAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /**
     * Full-text search over title and body, replacing Mongo's weighted text
     * index. `simple` rather than a language configuration on purpose: Noted is
     * translated and a user's notes are not all in one language, so stemming
     * with the wrong dictionary would help one language and quietly hurt the
     * rest. Weights keep the title's contribution above the body's, as the
     * Mongo index's `{ title: 3, body: 1 }` did.
     */
    searchVector: tsvector().generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('simple', coalesce(${notes.title}, '')), 'A') || setweight(to_tsvector('simple', coalesce(${notes.body}, '')), 'B')`,
    ),
  },
  (t) => [
    // The feed: one user's notes for one view, pinned first, then by position.
    index('notes_feed_idx').on(
      t.oxyUserId,
      t.trashed,
      t.archived,
      t.pinned.desc(),
      t.sortOrder,
    ),
    // Incremental sync: everything this user changed after an instant, in
    // change order, tombstones included.
    index('notes_sync_idx').on(t.oxyUserId, t.updatedAt),
    // The reminder sweep: due and undelivered.
    index('notes_reminder_idx')
      .on(t.reminderAt)
      .where(
        sql`${t.reminderQueuedAt} is null and ${t.reminderSentAt} is null and ${t.deletedAt} is null`,
      ),
    index('notes_labels_idx').using('gin', t.labels),
    index('notes_search_idx').using('gin', t.searchVector),
    // The expiry sweep's own read path.
    index('notes_deleted_at_idx')
      .on(t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

/** A `notes` row as selected. */
export type NoteRow = typeof notes.$inferSelect;

/** The shape `insert(notes).values(...)` accepts. */
export type NewNoteRow = typeof notes.$inferInsert;
