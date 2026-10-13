import { asc, eq } from 'drizzle-orm';

import { getDb } from '../db/postgres.js';
import { capabilityExecutions } from '../db/schema/capability-executions.js';
import { feedback } from '../db/schema/feedback.js';
import { labels } from '../db/schema/labels.js';
import { noteArtifacts, noteItemOverrides } from '../db/schema/note-artifacts.js';
import { notes } from '../db/schema/notes.js';
import { notifications } from '../db/schema/notifications.js';
import { pushTokens, webPushSubscriptions } from '../db/schema/pushTokens.js';
import { readGeneratedHalf } from './note-artifacts.js';
import { serializeLabel, serializeNote } from './serializers.js';

export const EXPORT_FORMAT = 'noted-export-v1';

/**
 * Everything Noted stores for one user.
 *
 * Trashed notes are included (they are still the user's) and deleted ones are
 * not (they hold nothing). Push endpoints and capability receipts are
 * operational, not content, and stay out; `eraseAccountData` removes them.
 */
export async function exportAccountData(oxyUserId: string) {
  const db = getDb();
  const noteRows = await db
    .select()
    .from(notes)
    .where(eq(notes.oxyUserId, oxyUserId))
    .orderBy(asc(notes.createdAt));
  const live = noteRows.filter((row) => !row.deletedAt);
  const generated = await readGeneratedHalf(
    live.map((row) => row.id),
    oxyUserId,
  );
  const [labelRows, notificationRows, feedbackRows] = await Promise.all([
    db.select().from(labels).where(eq(labels.oxyUserId, oxyUserId)).orderBy(asc(labels.name)),
    db.select().from(notifications).where(eq(notifications.oxyUserId, oxyUserId)),
    db.select().from(feedback).where(eq(feedback.oxyUserId, oxyUserId)),
  ]);
  return {
    format: EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    notes: live.map((row) =>
      serializeNote(row, {
        artifacts: generated.artifacts.get(row.id) ?? [],
        overrides: generated.overrides.get(row.id) ?? [],
      }),
    ),
    labels: labelRows.map(serializeLabel),
    notifications: notificationRows,
    feedback: feedbackRows,
  };
}

/**
 * Erase every row Noted holds for one user, in one transaction so a failure
 * leaves the account whole rather than half erased. Children go first: nothing
 * here relies on a cascade to reach every row.
 */
export async function eraseAccountData(oxyUserId: string): Promise<void> {
  await getDb().transaction(async (transaction) => {
    await transaction.delete(noteItemOverrides).where(eq(noteItemOverrides.oxyUserId, oxyUserId));
    await transaction.delete(noteArtifacts).where(eq(noteArtifacts.oxyUserId, oxyUserId));
    await transaction.delete(notes).where(eq(notes.oxyUserId, oxyUserId));
    await transaction.delete(labels).where(eq(labels.oxyUserId, oxyUserId));
    await transaction.delete(notifications).where(eq(notifications.oxyUserId, oxyUserId));
    await transaction.delete(pushTokens).where(eq(pushTokens.oxyUserId, oxyUserId));
    await transaction
      .delete(webPushSubscriptions)
      .where(eq(webPushSubscriptions.oxyUserId, oxyUserId));
    await transaction.delete(feedback).where(eq(feedback.oxyUserId, oxyUserId));
    await transaction
      .delete(capabilityExecutions)
      .where(eq(capabilityExecutions.oxyUserId, oxyUserId));
  });
}
