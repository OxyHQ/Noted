import { describe, expect, it } from 'vitest';
import type { LocalNote, NoteInput } from '@/lib/db/notes-repo';
import type { NoteBlock } from '@/lib/notes/blocks';
import { editorPatch, type EditorSaveSnapshot } from '@/lib/notes/editor-patch';
import { NoteSaveQueue } from '@/lib/notes/save-queue';

const line = (id: string, text: string, order = 0): NoteBlock => ({
  id,
  parentBlockId: null,
  type: 'paragraph',
  content: { text },
  order,
});
const TYPED = line('typed', 'Typed');
const GENERATED = line('gen', 'Generated', 1);

const note: LocalNote = {
  id: 'note',
  kind: 'note',
  title: 'Original',
  blocks: [TYPED, GENERATED],
  generated: { gen: { key: 'n1' } },
  color: 'yellow',
  labels: [],
  pinned: false,
  archived: false,
  trashed: false,
  attachments: [],
  removedAttachments: [],
  reminderAt: null,
  order: 0,
  folderId: null,
  createdAt: '',
  updatedAt: '',
};

describe('editor field ownership', () => {
  it('sends only a title edit, and its blocks as an edit on what it started from', () => {
    expect(editorPatch(note, { ...note, title: 'Renamed' })).toEqual({ title: 'Renamed' });
    const edited = [line('typed', 'Edited'), GENERATED];
    expect(editorPatch(note, { ...note, blocks: edited })).toEqual({
      edit: { base: note.blocks, next: edited },
    });
  });

  it('omits unchanged copies of arrays and duplicate close saves', () => {
    expect(
      editorPatch(note, { ...note, blocks: [...note.blocks], attachments: [], labels: [] }),
    ).toEqual({});
  });

  it('keeps explicit clearing', () => {
    expect(editorPatch({ ...note, reminderAt: 'tomorrow', labels: ['label'] }, note)).toEqual({
      reminderAt: null,
      labels: [],
    });
  });

  it('does not send a newer generated block back as a user edit', () => {
    // The store moved under the editor (a rebuild) and the draft followed it:
    // nothing the user did, so nothing to send.
    const rebuilt = { ...note, blocks: [TYPED, line('gen', 'New generated', 1)] };
    expect(editorPatch(rebuilt, rebuilt)).toEqual({});
  });

  it('keeps the enqueue baseline when a peer update arrives before the write starts', async () => {
    let base = note;
    const patches: NoteInput[] = [];
    const queue = new NoteSaveQueue<EditorSaveSnapshot>(async (snapshot) => {
      patches.push(editorPatch(snapshot.base, snapshot.draft));
    });
    const edited = [line('typed', 'Edited'), GENERATED];
    const saving = queue.save({ base, draft: { ...note, blocks: edited } });
    base = { ...note, title: 'Other tab', pinned: true };
    await saving;
    expect(base.title).toBe('Other tab');
    expect(patches).toEqual([{ edit: { base: note.blocks, next: edited } }]);
  });

  it('diffs edits queued during creation against the successfully created draft', async () => {
    let saved: LocalNote | null = null;
    const patches: NoteInput[] = [];
    const queue = new NoteSaveQueue<EditorSaveSnapshot>(async (snapshot) => {
      patches.push(editorPatch(snapshot.base ?? saved, snapshot.draft));
      saved = snapshot.draft;
    });
    await Promise.all([
      queue.save({ base: null, draft: note }),
      queue.save({ base: null, draft: { ...note, title: 'Typed during creation' } }),
    ]);
    expect(patches[0]).toMatchObject({
      title: 'Original',
      edit: { base: [], next: note.blocks },
      labels: [],
      pinned: false,
    });
    expect(patches[1]).toEqual({ title: 'Typed during creation' });
  });
});
