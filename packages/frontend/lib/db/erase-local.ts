/**
 * Clearing an account's notes from THIS device.
 *
 * Used after the server has erased the account's data. It has to be thorough in
 * two ways a plain `DELETE FROM notes` is not:
 *
 * - The outbox goes too. Left behind, every pending upload would re-create on the
 *   server the very notes the person just asked to be erased.
 * - Recordings are removed from disk first. Their audio is not in SQLite, and a
 *   deleted account that still has its meetings' audio on the phone has not been
 *   deleted.
 *
 * Device preferences (chosen speech model, downloaded model weights) are not
 * account data and stay: they describe this phone, not the person.
 */

import { deleteNoteRecordings } from '@/lib/capture/captures-repo';
import { execute, executeTransaction, type Statement } from '@/lib/db/client';

/** Children before parents. Everything here belongs to the account. */
export const ACCOUNT_DATA_TABLES = [
  'note_item_overrides',
  'note_artifacts',
  'transcript_segments',
  'captures',
  'note_labels',
  'notes',
  'labels',
  'folders',
  'outbox',
  'sync_state',
] as const;

export function eraseStatements(): Statement[] {
  return ACCOUNT_DATA_TABLES.map((table) => ({ sql: `DELETE FROM ${table}`, params: [] }));
}

export async function eraseLocalAccountData(viewerId: string): Promise<void> {
  const recorded = await execute<{ note_id: string }>(
    'SELECT DISTINCT note_id FROM captures',
    [],
    viewerId,
  );
  for (const { note_id } of recorded) {
    // Removes the audio, then the note's capture rows; a failure on one note
    // must not leave the others' audio behind.
    await deleteNoteRecordings(note_id, viewerId).catch(() => undefined);
  }
  await executeTransaction(eraseStatements(), viewerId);
}
