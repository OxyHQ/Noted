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
 * Move every note out of a folder, into `intoFolderId` (null = unfiled), moving
 * each note's `updatedAt` so devices pull the change (a silent update would leave
 * other devices showing the note in a folder that no longer exists).
 */
export async function moveNotesOutOfFolder(
  transaction: Transaction,
  folderId: string,
  intoFolderId: string | null,
  userId: string,
): Promise<void> {
  await transaction
    .update(notes)
    .set({ folderId: intoFolderId, updatedAt: new Date() })
    .where(and(eq(notes.oxyUserId, userId), eq(notes.folderId, folderId)));
}

/** Take every note out of a folder and leave it unfiled. */
export async function clearFolderFromNotes(
  transaction: Transaction,
  folderId: string,
  userId: string,
): Promise<void> {
  await moveNotesOutOfFolder(transaction, folderId, null, userId);
}

/** Hang a folder's children from `newParentId` instead (null = the top level). */
export async function reparentChildren(
  transaction: Transaction,
  folderId: string,
  newParentId: string | null,
  userId: string,
): Promise<void> {
  await transaction
    .update(folders)
    .set({ parentId: newParentId, updatedAt: new Date() })
    .where(and(eq(folders.oxyUserId, userId), eq(folders.parentId, folderId)));
}

/** The user's folders as plain nodes, for validating a placement. */
export async function listFolderNodes(
  userId: string,
): Promise<{ id: string; parentId: string | null }[]> {
  return getDb()
    .select({ id: folders.id, parentId: folders.parentId })
    .from(folders)
    .where(eq(folders.oxyUserId, userId));
}
