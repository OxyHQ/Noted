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
    if (
      current[key] !== undefined &&
      JSON.stringify(current[key]) !== JSON.stringify(initial[key])
    ) {
      Object.assign(patch, { [key]: current[key] });
    }
  }
  // The content typed since is an edit on top of what the creation wrote, not
  // on top of nothing: blocks another writer added since are kept.
  if (patch.edit && initial.edit) {
    patch.edit = { base: initial.edit.next, next: patch.edit.next };
  }
  if (Object.keys(patch).length === 0) return created;
  const updated = await updateNote(id, patch, viewerId);
  if (!updated)
    throw new Error(
      'This note was deleted before the edit could be saved. Your draft has been preserved.',
    );
  return updated;
}
