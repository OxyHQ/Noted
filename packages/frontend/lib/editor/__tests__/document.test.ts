import { applyOperation } from '@oxy.so/bloom-editor/model';
import { describe, expect, it } from 'vitest';

import { documentOperations, toBlocks, toDocument } from '@/lib/editor/document';
import type { NoteBlock } from '@/lib/notes/blocks';

const block = (
  id: string,
  type: NoteBlock['type'],
  content: Record<string, unknown>,
  order: number,
  parentBlockId: string | null = null,
): NoteBlock => ({ id, parentBlockId, type, content, order });

const shape = (blocks: readonly NoteBlock[]) =>
  toBlocks(toDocument(blocks)).map((b) => [b.id, b.parentBlockId, b.type, b.content.text, b.order]);

describe('blocks ⇄ editor document', () => {
  it('round-trips text, props and nesting, siblings renumbered', () => {
    const blocks = [
      block('a', 'paragraph', { text: 'Hello', segments: [{ text: 'Hello', bold: true }] }, 5),
      block('b', 'todo', { text: 'Milk', checked: true }, 9),
      block('c', 'bulleted_list_item', { text: 'nested' }, 0, 'a'),
    ];
    const back = toBlocks(toDocument(blocks));
    expect(back.map((b) => [b.id, b.parentBlockId, b.order])).toEqual([
      ['a', null, 0],
      ['c', 'a', 0],
      ['b', null, 1],
    ]);
    expect(back[0]?.content.segments).toEqual([{ text: 'Hello', bold: true }]);
    expect(back[2]?.content).toMatchObject({ text: 'Milk', checked: true });
  });
});

describe('documentOperations', () => {
  it('turns one document into the other, keeping the blocks both have', () => {
    const current = toDocument([
      block('a', 'paragraph', { text: 'typed' }, 0),
      block('g1', 'heading_2', { text: 'Decisions' }, 1),
      block('g2', 'bulleted_list_item', { text: 'Old point' }, 2),
      block('x', 'paragraph', { text: 'nested' }, 0, 'a'),
    ]);
    const targetBlocks = [
      block('a', 'paragraph', { text: 'typed more' }, 0),
      block('g1', 'heading_2', { text: 'Decisions' }, 1),
      block('g3', 'bulleted_list_item', { text: 'New point' }, 2),
      block('t', 'todo', { text: 'Call', checked: false }, 3),
      block('x', 'paragraph', { text: 'nested' }, 4),
    ];
    const ops = documentOperations(current, toDocument(targetBlocks));
    const result = ops.reduce(applyOperation, current);
    expect(shape(toBlocks(result))).toEqual(shape(targetBlocks));
    // `a` was edited, not replaced: the caret's block survives.
    expect(ops.some((op) => op.kind === 'remove' && op.blocks[0]?.id === 'a')).toBe(false);
  });

  it('does nothing between equal documents', () => {
    const doc = toDocument([block('a', 'paragraph', { text: 'same' }, 0)]);
    expect(documentOperations(doc, toDocument(toBlocks(doc)))).toEqual([]);
  });
});
