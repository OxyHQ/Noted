/**
 * Folders in the local store.
 *
 * The same shape as labels and for the same reason: read offline (a note's
 * folder name resolves here), written online (creating or renaming one is rare
 * and its failure is visible), and replaced wholesale on sync because the
 * server's list is the whole truth and folders carry no tombstone.
 */

import { executeTransaction, getActiveViewerId, type Row, type Statement } from '@/lib/db/client';
import type { Folder } from '@noted/shared-types';

export interface FolderRow extends Row {
  id: string;
  name: string;
  parent_id: string | null;
}

export const FOLDER_LIST_SQL = `
SELECT id, name, parent_id FROM folders ORDER BY name COLLATE NOCASE ASC
`;

export function rowsToFolders(rows: readonly FolderRow[]): Folder[] {
  return rows.map((row) => ({ id: row.id, name: row.name, parentId: row.parent_id }));
}

/**
 * Replace the stored folders with the server's list.
 *
 * It also unfiles any note with unsent edits that names a folder no longer in
 * the list. Such a note would otherwise be refused by the server (`Unknown
 * folder`) on every retry, which leaves its edits stuck for good. Only notes
 * with unsent edits are touched: a clean note pointing at a folder this device
 * has not heard of yet is correct, and unfiling it here would diverge from the
 * server, which the next pull would not repair.
 */
export function replaceFolders(folders: readonly Folder[], now: string): Statement[] {
  return [
    { sql: 'DELETE FROM folders', params: [] },
    ...folders.map((folder) => ({
      sql: 'INSERT INTO folders (id, name, parent_id, updated_at) VALUES (?, ?, ?, ?)',
      params: [folder.id, folder.name, folder.parentId ?? null, now],
    })),
    {
      sql: `UPDATE notes SET folder_id = NULL
            WHERE dirty = 1 AND folder_id IS NOT NULL
              AND folder_id NOT IN (SELECT id FROM folders)`,
      params: [],
    },
  ];
}

export function saveFolders(
  folders: readonly Folder[],
  expectedViewerId = getActiveViewerId(),
): Promise<number[]> {
  return executeTransaction(replaceFolders(folders, new Date().toISOString()), expectedViewerId);
}

/** Apply one server-confirmed folder without replacing its siblings. */
export function saveFolder(folder: Folder, expectedViewerId: string): Promise<number[]> {
  return executeTransaction(
    [
      {
        sql: `INSERT INTO folders (id, name, parent_id, updated_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET name = excluded.name, parent_id = excluded.parent_id,
                updated_at = excluded.updated_at`,
        params: [folder.id, folder.name, folder.parentId ?? null, new Date().toISOString()],
      },
    ],
    expectedViewerId,
  );
}
