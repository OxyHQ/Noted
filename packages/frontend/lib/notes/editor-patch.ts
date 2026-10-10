import type { LocalNote, NoteInput } from '@/lib/db/notes-repo';
import { userBodyOf } from '@/lib/notes/generated-body';

/** Capture the common ancestor with the queued draft, before other tabs refresh it. */
export interface EditorSaveSnapshot {
  draft: LocalNote;
  base: LocalNote | null;
}

/** Send only the editor's changes; untouched fields may already be newer in SQLite. */
export function editorPatch(base: LocalNote | null, draft: LocalNote, takeOverBody: boolean): NoteInput {
  const patch: NoteInput = {};
  for (const field of ['title', 'checklist', 'color', 'labels', 'pinned', 'archived', 'reminderAt', 'attachments'] as const) {
    if (base === null || JSON.stringify(base[field]) !== JSON.stringify(draft[field])) {
      Object.assign(patch, { [field]: draft[field] });
    }
  }
  const userBody = userBodyOf(draft.body, draft.generatedBody);
  if (base === null || takeOverBody || userBody !== userBodyOf(base.body, base.generatedBody)) {
    patch.userBody = userBody;
  }
  if (takeOverBody) patch.generatedBody = '';
  return patch;
}
