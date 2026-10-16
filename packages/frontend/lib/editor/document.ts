/**
 * A note's blocks ⇄ the block editor's document (`@oxy.so/bloom-editor`, the
 * editor Nilo uses), and the operations that turn one document into another.
 *
 * The note stores blocks flat (`parentBlockId`, `order` among siblings, a
 * `content` bag whose text is `segments` plus plain `text`); the editor holds
 * a tree of `{ text, props }`. The schema is Nilo's — every type Nilo stores,
 * each keeping the props Nilo keeps (as `apps/app/lib/editor/schema.ts` in
 * Nilo builds it) — so a note edited here holds exactly what Nilo would store,
 * and a block Noted cannot show (a table, an embedded database) is carried
 * through untouched.
 */
import {
  type Block,
  type BlockSpec,
  childrenOf,
  DEFAULT_SCHEMA,
  defineSchema,
  type EditorDocument,
  extendSchema,
  getBlock,
  type Operation,
  readingOrder,
  specOf,
  subtreeIds,
  anchorOf,
  applyOperation,
} from '@oxy.so/bloom-editor/model';
import { type Segment, segmentsEqual, segmentsToPlainText } from '@oxy.so/bloom-text/model';
import { BLOCK_TYPES, type BlockType, contentFields, defaultContent } from '@oxy.so/nilo-contracts';

import type { NoteBlock } from '@/lib/notes/blocks';

/** How Nilo's block types behave under the editor's commands. */
const BEHAVIOUR = extendSchema(DEFAULT_SCHEMA, [
  { type: 'image', hasText: false, canHaveChildren: false },
  { type: 'video', hasText: false, canHaveChildren: false },
  { type: 'audio', hasText: false, canHaveChildren: false },
  { type: 'file', hasText: false, canHaveChildren: false },
  { type: 'pdf', hasText: false, canHaveChildren: false },
  { type: 'bookmark', hasText: false, canHaveChildren: false },
  { type: 'embed', hasText: false, canHaveChildren: false },
  { type: 'columns', hasText: false, canHaveChildren: true, isContainer: true },
  { type: 'column', hasText: false, canHaveChildren: true, isContainer: true },
  { type: 'canvas_note', hasText: false, canHaveChildren: true, isContainer: true },
  { type: 'table', hasText: false, canHaveChildren: true, isContainer: true },
  { type: 'table_row', hasText: false, canHaveChildren: true, isContainer: true },
  { type: 'table_cell', hasText: true, canHaveChildren: false },
  { type: 'button', hasText: false, canHaveChildren: false },
  { type: 'link_to_page', hasText: false, canHaveChildren: false },
  { type: 'sync_block', hasText: false, canHaveChildren: false },
  { type: 'breadcrumb', hasText: false, canHaveChildren: false },
  { type: 'table_of_contents', hasText: false, canHaveChildren: false },
  { type: 'equation', hasText: false, canHaveChildren: false },
  { type: 'mermaid', hasText: false, canHaveChildren: false },
  { type: 'inline_database', hasText: false, canHaveChildren: false },
]);

/** Content fields the editor holds as the block's text, not as props. */
const TEXT_FIELDS = new Set(['text', 'segments']);

function fromContract(spec: BlockSpec, type: BlockType): BlockSpec {
  const defaults = Object.fromEntries(
    Object.entries(defaultContent(type)).filter(([key]) => !TEXT_FIELDS.has(key)),
  );
  return {
    ...spec,
    defaultProps: defaults,
    props: contentFields(type).filter((key) => !TEXT_FIELDS.has(key)),
  };
}

/** Every block type Nilo stores, and nothing else. */
export const NOTE_SCHEMA = defineSchema(
  BLOCK_TYPES.map((type) => fromContract(specOf(BEHAVIOUR, type), type)),
);

const hasText = (type: string) => specOf(NOTE_SCHEMA, type).hasText;

/** The editor's text and props for a block's content. */
export function fieldsOf(
  type: string,
  content: Record<string, unknown>,
): { text?: Segment[]; props: Record<string, unknown> } {
  const { text, segments, ...props } = content as { text?: unknown; segments?: unknown };
  if (!hasText(type)) return { props };
  const value =
    Array.isArray(segments) && segments.length > 0
      ? (segments as Segment[])
      : typeof text === 'string' && text !== ''
        ? [{ text }]
        : [];
  return { text: value, props };
}

/** A block's content for an editor block: its props, plus `segments` and plain `text`. */
export function contentOf(block: Pick<Block, 'type' | 'text' | 'props'>): Record<string, unknown> {
  const content: Record<string, unknown> = { ...block.props };
  if (hasText(block.type)) {
    const segments = block.text ?? [];
    content.text = segmentsToPlainText(segments);
    // Code blocks store plain text only, as Nilo does.
    if (block.type !== 'code') content.segments = segments;
  }
  return content;
}

const byOrder = (a: NoteBlock, b: NoteBlock) =>
  a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The editor document for a note's blocks. A block whose parent is missing goes to the top. */
export function toDocument(blocks: readonly NoteBlock[]): EditorDocument {
  const known = new Set(blocks.map((block) => block.id));
  const byParent = new Map<string | null, NoteBlock[]>();
  for (const block of blocks) {
    const parent =
      block.parentBlockId && known.has(block.parentBlockId) ? block.parentBlockId : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), block]);
  }
  const childIds = (parent: string | null) =>
    [...(byParent.get(parent) ?? [])].sort(byOrder).map((block) => block.id);
  const docBlocks: Record<string, Block> = {};
  for (const block of blocks) {
    const parent =
      block.parentBlockId && known.has(block.parentBlockId) ? block.parentBlockId : null;
    const { text, props } = fieldsOf(block.type, block.content);
    docBlocks[block.id] = {
      id: block.id,
      type: block.type,
      parent,
      ...(text !== undefined && { text }),
      props,
      children: childIds(block.id),
    };
  }
  return { root: childIds(null), blocks: docBlocks };
}

/** A note's blocks for the editor document: siblings numbered in order. */
export function toBlocks(doc: EditorDocument): NoteBlock[] {
  const out: NoteBlock[] = [];
  const walk = (ids: readonly string[], parentBlockId: string | null) => {
    ids.forEach((id, order) => {
      const block = getBlock(doc, id);
      out.push({
        id,
        parentBlockId,
        type: block.type as BlockType,
        content: contentOf(block),
        order,
      });
      walk(block.children, id);
    });
  };
  walk(doc.root, null);
  return out;
}

const sameFields = (a: Block, b: Block) =>
  a.type === b.type &&
  segmentsEqual(a.text ?? [], b.text ?? []) &&
  (a.text === undefined) === (b.text === undefined) &&
  JSON.stringify(a.props) === JSON.stringify(b.props);

/**
 * The operations that turn `current` into `target`, keeping every block both
 * have (so the block the caret is in stays the block it is in): removals of
 * what `target` lacks, updates of what changed, then inserts and moves in
 * `target`'s reading order, each placed after its sibling there. Applied as
 * one remote transaction, it leaves the caret and the undo history alone,
 * which resetting the editor would not.
 */
export function documentOperations(current: EditorDocument, target: EditorDocument): Operation[] {
  const ops: Operation[] = [];
  let doc = current;
  const run = (op: Operation) => {
    doc = applyOperation(doc, op);
    ops.push(op);
  };

  for (const id of readingOrder(current)) {
    if (target.blocks[id] || !doc.blocks[id]) continue;
    // Top-most among the blocks going: its subtree goes with it.
    const anchor = anchorOf(doc, id);
    const blocks = subtreeIds(doc, id).map((child) => getBlock(doc, child));
    run({ kind: 'remove', blocks, ...anchor });
  }

  for (const id of Object.keys(target.blocks)) {
    const now = doc.blocks[id];
    const wanted = target.blocks[id] as Block;
    if (!now || sameFields(now, wanted)) continue;
    run({
      kind: 'update',
      id,
      before: { type: now.type, text: now.text, props: now.props },
      after: { type: wanted.type, text: wanted.text, props: wanted.props },
    });
  }

  const place = (parent: string | null) => {
    let after: string | null = null;
    for (const id of childrenOf(target, parent)) {
      const wanted = target.blocks[id] as Block;
      if (!doc.blocks[id]) {
        run({ kind: 'insert', blocks: [{ ...wanted, parent, children: [] }], parent, after });
      } else {
        const at = anchorOf(doc, id);
        if (at.parent !== parent || at.after !== after) {
          run({ kind: 'move', id, from: at, to: { parent, after } });
        }
      }
      place(id);
      after = id;
    }
  };
  place(null);
  return ops;
}
