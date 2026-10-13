import { and, desc, eq, gt, inArray, notInArray, sql } from 'drizzle-orm';

import type { Transaction } from '../db/postgres.js';
import { getDb } from '../db/postgres.js';
import { notes, type NoteRow } from '../db/schema/notes.js';
import { noteRevisions } from '../db/schema/note-revisions.js';

/**
 * A snapshot is taken at most this often per note. Edits arrive as a stream
 * (the outbox collapses them, but a long session still produces many), and a
 * version every few seconds is noise nobody can tell apart.
 */
export const REVISION_MIN_INTERVAL_MS = 10 * 60 * 1000;

/** The newest versions kept per note; older ones are pruned as new ones land. */
export const REVISION_KEEP = 50;

/** How long a version survives regardless of the count (see `db/expiry.ts`). */
export const REVISION_TTL_DAYS = 90;

/** The user-written text of a note: what a revision stores and restores. */
export interface NoteText {
  title: string;
  body: string;
  checklist: NoteRow['checklist'];
}

export function textOf(note: Pick<NoteRow, 'title' | 'body' | 'checklist'>): NoteText {
  return { title: note.title, body: note.body, checklist: note.checklist };
}

/** Whether applying `next` over `before` changes anything a revision records. */
export function changesText(before: NoteText, next: Partial<NoteText>): boolean {
  if (next.title !== undefined && next.title !== before.title) return true;
  if (next.body !== undefined && next.body !== before.body) return true;
  return (
    next.checklist !== undefined &&
    JSON.stringify(next.checklist) !== JSON.stringify(before.checklist)
  );
}

/**
 * Record `before` as a version of the note, unless one was taken recently.
 * Call it in the same transaction as the edit that replaces `before`, after the
 * edit is known to have applied.
 */
export async function snapshotBeforeEdit(
  transaction: Transaction,
  noteId: string,
  userId: string,
  before: NoteText,
  now = new Date(),
): Promise<boolean> {
  const [recent] = await transaction
    .select({ id: noteRevisions.id })
    .from(noteRevisions)
    .where(
      and(
        eq(noteRevisions.noteId, noteId),
        gt(noteRevisions.createdAt, new Date(now.getTime() - REVISION_MIN_INTERVAL_MS)),
      ),
    )
    .limit(1);
  if (recent) return false;

  // An untouched note has nothing worth keeping a version of.
  if (before.title === '' && before.body === '' && before.checklist.length === 0) return false;

  await insertSnapshot(transaction, noteId, userId, before, now);
  return true;
}

/** Store a version and prune the note's history back to `REVISION_KEEP`. */
async function insertSnapshot(
  transaction: Transaction,
  noteId: string,
  userId: string,
  text: NoteText,
  now: Date,
): Promise<void> {
  await transaction.insert(noteRevisions).values({
    noteId,
    oxyUserId: userId,
    title: text.title,
    body: text.body,
    checklist: text.checklist,
    createdAt: now,
  });

  const keep = transaction
    .select({ id: noteRevisions.id })
    .from(noteRevisions)
    .where(eq(noteRevisions.noteId, noteId))
    .orderBy(desc(noteRevisions.createdAt))
    .limit(REVISION_KEEP);
  await transaction
    .delete(noteRevisions)
    .where(and(eq(noteRevisions.noteId, noteId), notInArray(noteRevisions.id, keep)));
}

export interface RevisionSummary {
  id: string;
  createdAt: string;
  title: string;
  /** The start of the body, enough to recognise a version in a list. */
  preview: string;
  checklistItems: number;
}

const PREVIEW_LENGTH = 200;

/** Versions of a note, newest first. Empty for a note that is not the user's. */
export async function listRevisions(noteId: string, userId: string): Promise<RevisionSummary[]> {
  const rows = await getDb()
    .select()
    .from(noteRevisions)
    .where(and(eq(noteRevisions.noteId, noteId), eq(noteRevisions.oxyUserId, userId)))
    .orderBy(desc(noteRevisions.createdAt));
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    title: row.title,
    preview: row.body.slice(0, PREVIEW_LENGTH),
    checklistItems: row.checklist.length,
  }));
}

export interface RevisionDetail extends NoteText {
  id: string;
  createdAt: string;
}

/** One version's full text, or null when it is not the user's. */
export async function getRevision(
  noteId: string,
  revisionId: string,
  userId: string,
): Promise<RevisionDetail | null> {
  const [row] = await getDb()
    .select()
    .from(noteRevisions)
    .where(
      and(
        eq(noteRevisions.id, revisionId),
        eq(noteRevisions.noteId, noteId),
        eq(noteRevisions.oxyUserId, userId),
      ),
    );
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    title: row.title,
    body: row.body,
    checklist: row.checklist,
  };
}

/**
 * Put an earlier version's text back.
 *
 * The text being replaced is snapshotted first (bypassing the rate limit, since
 * a restore is a deliberate act the user must be able to undo), so restoring
 * never loses anything. Returns the updated note, or null when the note or the
 * version is not the user's.
 */
export async function restoreRevision(
  noteId: string,
  revisionId: string,
  userId: string,
  now = new Date(),
): Promise<NoteRow | null> {
  return getDb().transaction(async (transaction) => {
    const [revision] = await transaction
      .select()
      .from(noteRevisions)
      .where(
        and(
          eq(noteRevisions.id, revisionId),
          eq(noteRevisions.noteId, noteId),
          eq(noteRevisions.oxyUserId, userId),
        ),
      );
    if (!revision) return null;

    const [current] = await transaction
      .select()
      .from(notes)
      .where(
        and(eq(notes.id, noteId), eq(notes.oxyUserId, userId), sql`${notes.deletedAt} is null`),
      )
      .for('update');
    if (!current) return null;

    if (changesText(textOf(current), textOf(revision))) {
      // Not rate-limited like an edit: this is deliberate, and undoable.
      await insertSnapshot(transaction, noteId, userId, textOf(current), now);
    }
    const [updated] = await transaction
      .update(notes)
      .set({ ...textOf(revision), updatedAt: now })
      .where(and(eq(notes.id, noteId), eq(notes.oxyUserId, userId)))
      .returning();
    return updated ?? null;
  });
}

/** Remove every version of the given notes (a note deleted forever keeps none). */
export async function deleteRevisionsOf(
  transaction: Transaction,
  noteIds: readonly string[],
  userId: string,
): Promise<void> {
  if (noteIds.length === 0) return;
  await transaction
    .delete(noteRevisions)
    .where(and(inArray(noteRevisions.noteId, [...noteIds]), eq(noteRevisions.oxyUserId, userId)));
}
