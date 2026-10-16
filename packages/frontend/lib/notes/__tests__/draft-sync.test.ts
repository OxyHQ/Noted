import { describe, expect, it } from 'vitest';

import type { LocalNote } from '@/lib/db/notes-repo';
import { inReadingOrder, type NoteBlock } from '@/lib/notes/blocks';
import { reconcileDraft } from '@/lib/notes/draft-sync';

const line = (
  id: string,
  text: string,
  order: number,
  type: NoteBlock['type'] = 'paragraph',
): NoteBlock => ({
  id,
  parentBlockId: null,
  type,
  content: type === 'todo' ? { text, checked: false } : { text },
  order,
});

const TYPED = line('typed', 'Preguntar por el presupuesto', 0);
const HEADING = line('h', 'Open questions', 1, 'heading_2');
const FIRST = line('q1', 'Is it reading the entire internet?', 2, 'bulleted_list_item');
const SECOND = line('q2', 'Who signs off?', 3, 'bulleted_list_item');

function note(over: Partial<LocalNote> = {}): LocalNote {
  return {
    id: 'note-1',
    kind: 'voice',
    title: 'Reunión',
    blocks: [TYPED, HEADING, FIRST],
    generated: { h: { key: 'section:q' }, q1: { key: 'q1' } },
    color: 'default',
    labels: [],
    pinned: false,
    archived: false,
    trashed: false,
    attachments: [],
    reminderAt: null,
    order: 0,
    folderId: null,
    createdAt: '2026-08-10T09:00:00.000Z',
    updatedAt: '2026-08-10T09:00:00.000Z',
    ...over,
  };
}
const texts = (n: LocalNote) => inReadingOrder(n.blocks).map((b) => b.content.text);

describe('reconcileDraft', () => {
  it('takes the whole note when the user has changed nothing', () => {
    const base = note();
    const stored = note({ blocks: [TYPED, HEADING, FIRST, SECOND], title: 'Renamed' });
    const next = reconcileDraft(base, base, stored);
    expect(next.blocks).toBe(stored.blocks);
    expect(next.title).toBe('Renamed');
  });

  it('keeps what was typed and shows what the slice added, once', () => {
    const base = note();
    const draft = note({
      blocks: [line('typed', 'Preguntar por el presupuesto y el plazo', 0), HEADING, FIRST],
    });
    const stored = note({
      blocks: [TYPED, HEADING, FIRST, SECOND],
      generated: { ...note().generated, q2: { key: 'q2' } },
    });
    const next = reconcileDraft(base, draft, stored);
    expect(texts(next)).toEqual([
      'Preguntar por el presupuesto y el plazo',
      'Open questions',
      'Is it reading the entire internet?',
      'Who signs off?',
    ]);
    expect(next.generated).toEqual(stored.generated);
  });

  it('makes a generated block the user edited theirs, so the next rebuild leaves it', () => {
    const base = note();
    const draft = note({
      blocks: [TYPED, HEADING, line('q1', 'Does it read everything?', 2, 'bulleted_list_item')],
    });
    const next = reconcileDraft(base, draft, note());
    expect(texts(next)).toContain('Does it read everything?');
    expect(next.generated).toEqual({ h: { key: 'section:q' } });
  });

  it('keeps a title the user typed and takes one they did not', () => {
    const base = note();
    expect(reconcileDraft(base, note({ title: 'Mine' }), note({ title: 'Theirs' })).title).toBe(
      'Mine',
    );
    expect(reconcileDraft(base, base, note({ title: 'Theirs' })).title).toBe('Theirs');
  });

  it('keeps blocks the user reordered and takes ones they did not touch', () => {
    const base = note({ blocks: [line('a', 'A', 0), line('b', 'B', 1)], generated: {} });
    const draft = note({ blocks: [line('b', 'B', 0), line('a', 'A', 1)], generated: {} });
    const stored = note({
      blocks: [line('a', 'A', 0), line('b', 'B', 1), line('c', 'C', 2)],
      generated: {},
    });
    expect(texts(reconcileDraft(base, draft, stored))).toEqual(['B', 'A', 'C']);
  });

  it('keeps a colour the user picked while a slice was landing', () => {
    const base = note();
    const next = reconcileDraft(
      base,
      note({ color: 'teal' }),
      note({ blocks: [TYPED, HEADING, FIRST, SECOND] }),
    );
    expect(next.color).toBe('teal');
    expect(texts(next)).toContain('Who signs off?');
  });

  it('hands the editor the stored blocks themselves when its own save lands back', () => {
    // Nothing moved but our own write: the editor must be given the exact list,
    // or it would apply a no-op change and disturb the caret.
    const base = note();
    const draft = note({ blocks: [line('typed', 'Edited', 0), HEADING, FIRST] });
    const saved = note({ blocks: draft.blocks });
    const next = reconcileDraft(base, draft, saved);
    expect(next.blocks).toEqual(saved.blocks);
  });

  it('still takes blocks another device changed while nothing was typed here', () => {
    const base = note();
    const stored = note({ blocks: [line('typed', 'From the laptop', 0), HEADING, FIRST] });
    expect(texts(reconcileDraft(base, base, stored))[0]).toBe('From the laptop');
  });

  it('leaves the draft consistent for the next reconcile', () => {
    const base = note();
    const draft = note({ blocks: [line('typed', 'Typed more', 0), HEADING, FIRST] });
    const first = reconcileDraft(base, draft, note({ blocks: [TYPED, HEADING, FIRST, SECOND] }));
    const second = reconcileDraft(
      note({ blocks: [TYPED, HEADING, FIRST, SECOND] }),
      first,
      note({ blocks: [TYPED, HEADING, FIRST, SECOND] }),
    );
    expect(texts(second).filter((t) => t === 'Open questions')).toHaveLength(1);
    expect(texts(second)[0]).toBe('Typed more');
  });
});
