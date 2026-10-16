/**
 * Markdown, as a note's blocks: what Noted's old bodies, imported files and
 * templates are written in. Parsed by Nilo's own converter
 * (`@oxy.so/nilo-contracts` `markdownToBlocks`), so a note reads the same
 * here and in Nilo. A separate checklist (the old notes kept one) becomes
 * `todo` blocks after the text, where it was shown.
 */
import {
  type BlockNode,
  blocksToMarkdown,
  blocksToTree,
  markdownToBlocks,
  normalizeContent,
} from '@oxy.so/nilo-contracts';

import { inReadingOrder, type NoteBlock } from '@/lib/notes/blocks';

export interface ChecklistLike {
  text?: string;
  checked?: boolean;
}

function flatten(
  nodes: readonly BlockNode[],
  newId: () => string,
  parentBlockId: string | null = null,
): NoteBlock[] {
  return nodes.flatMap((node, order) => {
    const id = newId();
    return [
      {
        id,
        parentBlockId,
        type: node.type,
        content: normalizeContent(node.type, node.content),
        order,
      },
      ...flatten(node.children, newId, id),
    ];
  });
}

/** Markdown (and an old checklist) as fresh blocks. */
export function noteBlocksFromMarkdown(
  markdown: string,
  checklist: readonly ChecklistLike[] = [],
  newId: () => string,
): NoteBlock[] {
  const text = markdown.trim() ? markdownToBlocks(markdown) : [];
  const todos: BlockNode[] = checklist
    .filter((item) => (item.text ?? '').trim() !== '' || item.checked === true)
    .map((item) => ({
      type: 'todo',
      content: { text: item.text ?? '', checked: item.checked === true },
      children: [],
    }));
  return flatten([...text, ...todos], newId);
}

/** A note's blocks as Markdown, for export and sharing. */
export function noteBlocksToMarkdown(blocks: readonly NoteBlock[], title?: string): string {
  return blocksToMarkdown(blocksToTree(inReadingOrder(blocks)), title);
}
