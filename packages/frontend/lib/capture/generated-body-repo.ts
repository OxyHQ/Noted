/**
 * Where the app remembers what it wrote into a note.
 *
 * Read and written straight against the column rather than through
 * `updateNote`, for one reason that matters: `updateNote` marks the note dirty
 * and queues it for the server. This is local bookkeeping — the server has the
 * note's body and no business knowing which part of it the app composed — so
 * pushing it would be a sync for nothing, on every slice of every recording.
 */

import { execute, executeTransaction, type Row } from '@/lib/db/client';

interface GeneratedBodyRow extends Row {
  generated_body: string;
}

export async function readGeneratedBody(noteId: string): Promise<string> {
  const rows = await execute<GeneratedBodyRow>(
    'SELECT generated_body FROM notes WHERE id = ?',
    [noteId],
  );
  return rows[0]?.generated_body ?? '';
}

export function writeGeneratedBody(noteId: string, generated: string): Promise<number[]> {
  return executeTransaction([
    { sql: 'UPDATE notes SET generated_body = ? WHERE id = ?', params: [generated, noteId] },
  ]);
}
