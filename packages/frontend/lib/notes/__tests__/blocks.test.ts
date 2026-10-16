import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  getRandomValues: (bytes: Uint8Array) => bytes.map(() => Math.floor(Math.random() * 256)),
}));

const { adoptEdited, inReadingOrder, mergeBlocks, plainText, renumber, todos, withGenerated } =
  await import('@/lib/notes/blocks');
type NoteBlock = import('@/lib/notes/blocks').NoteBlock;

const p = (
  id: string,
  text: string,
  order: number,
  parentBlockId: string | null = null,
): NoteBlock => ({
  id,
  parentBlockId,
  type: 'paragraph',
  content: { text },
  order,
});
const todo = (id: string, text: string, checked: boolean, order: number): NoteBlock => ({
  id,
  parentBlockId: null,
  type: 'todo',
  content: { text, checked },
  order,
});
const texts = (blocks: readonly NoteBlock[]) => inReadingOrder(blocks).map((b) => b.content.text);

describe('reading', () => {
  it('reads blocks parent first, siblings by order, and gives search their text', () => {
    const blocks = [p('c', 'child', 0, 'a'), p('b', 'second', 1), p('a', 'first', 0)];
    expect(texts(blocks)).toEqual(['first', 'child', 'second']);
    expect(plainText(blocks)).toBe('first\nchild\nsecond');
  });

  it('lists the tasks with their ticks', () => {
    expect(todos([todo('t', 'Milk', true, 0), p('x', 'note', 1)])).toEqual([
      { id: 't', text: 'Milk', checked: true },
    ]);
  });
});

describe('mergeBlocks', () => {
  const base = [p('a', 'one', 0), p('b', 'two', 1), p('c', 'three', 2)];

  it('takes each side’s change to a different block', () => {
    const mine = [p('a', 'ONE', 0), p('b', 'two', 1), p('c', 'three', 2)];
    const theirs = [p('a', 'one', 0), p('b', 'two', 1), p('c', 'THREE', 2)];
    expect(texts(mergeBlocks(base, mine, theirs))).toEqual(['ONE', 'two', 'THREE']);
  });

  it('keeps mine when both changed one block', () => {
    const mine = [p('a', 'mine', 0), p('b', 'two', 1), p('c', 'three', 2)];
    const theirs = [p('a', 'theirs', 0), p('b', 'two', 1), p('c', 'three', 2)];
    expect(texts(mergeBlocks(base, mine, theirs))).toEqual(['mine', 'two', 'three']);
  });

  it('keeps blocks both sides added, each where its side put it', () => {
    const mine = [...base, p('m', 'mine new', 3)];
    const theirs = [p('t', 'theirs new', 0), ...base.map((b) => ({ ...b, order: b.order + 1 }))];
    expect(texts(mergeBlocks(base, mine, theirs))).toEqual([
      'theirs new',
      'one',
      'two',
      'three',
      'mine new',
    ]);
  });

  it('lets a deletion go unless the other side edited the block since', () => {
    const mineDeleted = [p('a', 'one', 0), p('c', 'three', 1)];
    expect(texts(mergeBlocks(base, mineDeleted, base))).toEqual(['one', 'three']);
    const theirsEdited = [p('a', 'one', 0), p('b', 'TWO', 1), p('c', 'three', 2)];
    expect(texts(mergeBlocks(base, mineDeleted, theirsEdited))).toEqual(['one', 'TWO', 'three']);
  });

  it('moves a block mine moved, after the sibling it follows in mine', () => {
    const mine = [p('c', 'three', 0), p('a', 'one', 1), p('b', 'two', 2)];
    expect(texts(mergeBlocks(base, mine, base))).toEqual(['three', 'one', 'two']);
  });

  it('renumbers siblings from zero', () => {
    const merged = mergeBlocks(base, base, base);
    expect(merged.map((b) => b.order)).toEqual([0, 1, 2]);
    expect(renumber([p('x', 'x', 7), p('y', 'y', 9)]).map((b) => b.order)).toEqual([0, 1]);
  });
});

describe('the recorder’s blocks', () => {
  let n = 0;
  const newId = () => {
    n += 1;
    return `gen-${n}`;
  };

  it('go after the user’s, and keep their ids when rendered again', () => {
    const user = [p('u', 'typed', 0)];
    const first = withGenerated(
      user,
      {},
      [
        { key: 'h', type: 'heading_2', content: { text: 'Decisions' } },
        { key: 'd1', type: 'bulleted_list_item', content: { text: 'Ship it' } },
      ],
      newId,
    );
    expect(texts(first.blocks)).toEqual(['typed', 'Decisions', 'Ship it']);
    const shipId = Object.entries(first.generated).find(([, ref]) => ref.key === 'd1')?.[0];

    const second = withGenerated(
      first.blocks,
      first.generated,
      [
        { key: 'h', type: 'heading_2', content: { text: 'Decisions' } },
        { key: 'd1', type: 'bulleted_list_item', content: { text: 'Ship it' } },
        { key: 'd2', type: 'bulleted_list_item', content: { text: 'Hire' } },
      ],
      newId,
    );
    expect(texts(second.blocks)).toEqual(['typed', 'Decisions', 'Ship it', 'Hire']);
    expect(second.generated[shipId as string]).toEqual({ key: 'd1' });
  });

  it('leave a block the user edited alone: it is theirs now', () => {
    const first = withGenerated(
      [],
      {},
      [{ key: 'q', type: 'paragraph', content: { text: 'Draft' } }],
      newId,
    );
    const [id] = Object.keys(first.generated);
    const edited = first.blocks.map((b) =>
      b.id === id ? { ...b, content: { text: 'Mine now' } } : b,
    );
    const generated = adoptEdited(first.blocks, edited, first.generated);
    expect(generated).toEqual({});
    const rebuilt = withGenerated(
      edited,
      generated,
      [{ key: 'q', type: 'paragraph', content: { text: 'Draft v2' } }],
      newId,
    );
    expect(texts(rebuilt.blocks)).toEqual(['Mine now', 'Draft v2']);
  });
});
