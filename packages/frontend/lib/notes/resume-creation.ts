import { createNote, updateNote, type LocalNote, type NoteInput } from '@/lib/db/notes-repo';

/**
 * A user-triggered retry confirms one stable creation ID, then applies only
 * edits made since that attempt. The first insert may already have committed.
 */
export async function resumeNoteCreation(
  id: string,
  initial: NoteInput,
  current: NoteInput,
  viewerId?: string,
): Promise<LocalNote> {
  const created = await createNote(id, initial, viewerId);
  const patch: NoteInput = {};
  for (const key of Object.keys(current) as Array<keyof NoteInput>) {
    if (current[key] !== undefined && JSON.stringify(current[key]) !== JSON.stringify(initial[key])) {
      Object.assign(patch, { [key]: current[key] });
    }
  }
  if (Object.keys(patch).length === 0) return created;
  const updated = await updateNote(id, patch, viewerId);
  if (!updated) throw new Error('This note was deleted before the edit could be saved. Your draft has been preserved.');
  return updated;
}
