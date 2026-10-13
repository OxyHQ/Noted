import { and, eq } from 'drizzle-orm';

import { getDb, type Transaction } from '../db/postgres.js';
import { folders } from '../db/schema/folders.js';
import { notes } from '../db/schema/notes.js';

/** Whether `folderId` is a folder this user owns. */
export async function userOwnsFolder(userId: string, folderId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.oxyUserId, userId)))
    .limit(1);
  return row !== undefined;
}

/**
 * Take every note out of a folder, moving each note's `updatedAt` so devices
 * pull the change (a silent update would leave other devices showing the note
 * in a folder that no longer exists).
 */
export async function clearFolderFromNotes(
  transaction: Transaction,
  folderId: string,
  userId: string,
): Promise<void> {
  await transaction
    .update(notes)
    .set({ folderId: null, updatedAt: new Date() })
    .where(and(eq(notes.oxyUserId, userId), eq(notes.folderId, folderId)));
}
