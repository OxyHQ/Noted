import type { LocalNote, NoteInput } from '@/lib/db/notes-repo';

/** Capture the common ancestor with the queued draft, before other tabs refresh it. */
export interface EditorSaveSnapshot {
  draft: LocalNote;
  base: LocalNote | null;
}

/**
 * Send only the editor's changes; untouched fields may already be newer in
 * SQLite. Its blocks go as an edit (what it started from, and what they are
 * now), which the store merges onto its own: never written whole over a
 * recording that has moved on since.
 */
export function editorPatch(base: LocalNote | null, draft: LocalNote): NoteInput {
  const patch: NoteInput = {};
  for (const field of [
    'title',
    'color',
    'labels',
    'pinned',
    'archived',
    'reminderAt',
    'attachments',
    'folderId',
  ] as const) {
    if (base === null || JSON.stringify(base[field]) !== JSON.stringify(draft[field])) {
      Object.assign(patch, { [field]: draft[field] });
    }
  }
  if (base === null) patch.edit = { base: [], next: draft.blocks };
  else if (JSON.stringify(base.blocks) !== JSON.stringify(draft.blocks)) {
    patch.edit = { base: base.blocks, next: draft.blocks };
  }
  return patch;
}
