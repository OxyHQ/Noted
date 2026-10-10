import { describe, expect, it } from 'vitest';
import type { LocalNote, NoteInput } from '@/lib/db/notes-repo';
import { editorPatch, type EditorSaveSnapshot } from '@/lib/notes/editor-patch';
import { NoteSaveQueue } from '@/lib/notes/save-queue';

const note: LocalNote = {
  id: 'note', kind: 'note', title: 'Original', body: 'Typed\n\nGenerated', generatedBody: 'Generated',
  checklist: [], color: 'yellow', labels: [], pinned: false, archived: false, trashed: false,
  attachments: [], reminderAt: null, order: 0, createdAt: '', updatedAt: '',
};

describe('editor field ownership', () => {
  it('sends only a title edit without taking ownership of another tab’s body or flags', () => {
    expect(editorPatch(note, { ...note, title: 'Renamed' }, false)).toEqual({ title: 'Renamed' });
    expect(editorPatch(note, { ...note, body: 'Edited\n\nGenerated' }, false)).toEqual({ userBody: 'Edited' });
  });

  it('omits unchanged copies of arrays and duplicate close saves', () => {
    expect(editorPatch(note, { ...note, checklist: [], attachments: [], labels: [] }, false)).toEqual({});
  });

  it('keeps explicit clearing and generated-body takeover', () => {
    expect(editorPatch({ ...note, reminderAt: 'tomorrow', labels: ['label'] }, note, false)).toEqual({ reminderAt: null, labels: [] });
    expect(editorPatch(note, { ...note, body: '', generatedBody: '' }, true)).toEqual({ userBody: '', generatedBody: '' });
  });

  it('does not send a newer generated block back as a user edit', () => {
    expect(editorPatch(note, { ...note, body: 'Typed\n\nNew generated', generatedBody: 'New generated' }, false)).toEqual({});
  });

  it('keeps the enqueue baseline when a peer update arrives before the write starts', async () => {
    let base = note;
    const patches: NoteInput[] = [];
    const queue = new NoteSaveQueue<EditorSaveSnapshot>(async (snapshot, takeover) => {
      patches.push(editorPatch(snapshot.base, snapshot.draft, takeover));
    });
    const saving = queue.save({ base, draft: { ...note, body: 'Edited\n\nGenerated' } });
    base = { ...note, title: 'Other tab', pinned: true };
    await saving;
    expect(base.title).toBe('Other tab');
    expect(patches).toEqual([{ userBody: 'Edited' }]);
  });

  it('diffs edits queued during creation against the successfully created draft', async () => {
    let saved: LocalNote | null = null;
    const patches: NoteInput[] = [];
    const queue = new NoteSaveQueue<EditorSaveSnapshot>(async (snapshot, takeover) => {
      patches.push(editorPatch(snapshot.base ?? saved, snapshot.draft, takeover));
      saved = snapshot.draft;
    });
    await Promise.all([
      queue.save({ base: null, draft: note }),
      queue.save({ base: null, draft: { ...note, title: 'Typed during creation' } }),
    ]);
    expect(patches[0]).toMatchObject({ title: 'Original', userBody: 'Typed', labels: [], pinned: false });
    expect(patches[1]).toEqual({ title: 'Typed during creation' });
  });
});
