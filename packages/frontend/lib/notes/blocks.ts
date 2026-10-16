/**
 * A note's content: Nilo blocks, flat (`parentBlockId` + `order` among
 * siblings), the same shape Nilo stores and `/notes` sends.
 *
 * Two writers share it — the person in the editor and the recorder, whose
 * generated blocks are rebuilt every few seconds — and a block's id is what
 * tells their work apart. The recorder knows its blocks by id
 * (`GeneratedMap`), so it replaces exactly those and nothing the user wrote,
 * and two versions of a note are merged block by block against the version
 * both started from (`mergeBlocks`), not by comparing text.
 */
import type { BlockContent, BlockType, NoteBlock } from '@oxy.so/nilo-contracts';

export type { NoteBlock };

/**
 * The recorder's blocks, by block id, each with the stable key of what it
 * renders (an artifact item's id, or a section's). A rebuild gives a key the
 * block id it had, so a ticked generated task stays the same block and keeps
 * its tick. A block the user edits leaves the map: it is theirs from then on.
 */
export type GeneratedMap = Record<string, { key: string }>;

/** A block the recorder renders, before it has an id. */
export interface RenderedBlock {
  key: string;
  type: BlockType;
  content: BlockContent;
  children?: RenderedBlock[];
}

/* ── Reading ───────────────────────────────────────────────────── */

const byOrder = (a: NoteBlock, b: NoteBlock) =>
  a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The blocks in reading order: each parent, then its children, depth first. */
export function inReadingOrder(blocks: readonly NoteBlock[]): NoteBlock[] {
  const ids = new Set(blocks.map((block) => block.id));
  const children = new Map<string | null, NoteBlock[]>();
  for (const block of blocks) {
    const parent = block.parentBlockId && ids.has(block.parentBlockId) ? block.parentBlockId : null;
    children.set(parent, [...(children.get(parent) ?? []), block]);
  }
  const out: NoteBlock[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null) => {
    for (const block of [...(children.get(parent) ?? [])].sort(byOrder)) {
      if (seen.has(block.id)) continue;
      seen.add(block.id);
      out.push(block);
      walk(block.id);
    }
  };
  walk(null);
  return out;
}

export function blockText(block: NoteBlock): string {
  const text = block.content.text;
  return typeof text === 'string' ? text : '';
}

/** Every block's text, one per line: what search and previews read. */
export function plainText(blocks: readonly NoteBlock[]): string {
  return inReadingOrder(blocks)
    .map(blockText)
    .filter((text) => text.trim() !== '')
    .join('\n');
}

export interface TodoItem {
  id: string;
  text: string;
  checked: boolean;
}

/** The note's tasks: its `todo` blocks, in reading order. */
export function todos(blocks: readonly NoteBlock[]): TodoItem[] {
  return inReadingOrder(blocks)
    .filter((block) => block.type === 'todo')
    .map((block) => ({
      id: block.id,
      text: blockText(block),
      checked: block.content.checked === true,
    }));
}

/**
 * The recorder's tasks among `blocks`, named by their item keys — the shape
 * `overridesForChecklistChange` compares, so a tick on a generated task is
 * recorded against the item and survives the next rebuild.
 */
export function generatedTodos(blocks: readonly NoteBlock[], generated: GeneratedMap): TodoItem[] {
  return todos(blocks).flatMap((item) => {
    const ref = generated[item.id];
    return ref ? [{ ...item, id: ref.key }] : [];
  });
}

/** Whether the blocks hold anything at all (an empty paragraph is nothing). */
export function hasContent(blocks: readonly NoteBlock[]): boolean {
  return blocks.some(
    (block) =>
      blockText(block).trim() !== '' ||
      // A divider, an image, a file: content without text.
      ![
        'paragraph',
        'heading_1',
        'heading_2',
        'heading_3',
        'quote',
        'todo',
        'bulleted_list_item',
        'numbered_list_item',
        'code',
        'callout',
        'toggle',
      ].includes(block.type),
  );
}

/** The blocks the user wrote: everything not the recorder's (nor under one of its blocks). */
export function userBlocks(blocks: readonly NoteBlock[], generated: GeneratedMap): NoteBlock[] {
  const theirs = new Set<string>();
  for (const id of Object.keys(generated)) for (const gone of subtree(blocks, id)) theirs.add(gone);
  return blocks.filter((block) => !theirs.has(block.id));
}

/* ── Writing ───────────────────────────────────────────────────── */

/** Siblings numbered 0, 1, 2… in their current order, so any two lists compare. */
export function renumber(blocks: readonly NoteBlock[]): NoteBlock[] {
  const ordered = inReadingOrder(blocks);
  const next = new Map<string | null, number>();
  return ordered.map((block) => {
    const order = next.get(block.parentBlockId) ?? 0;
    next.set(block.parentBlockId, order + 1);
    return block.order === order ? block : { ...block, order };
  });
}

/** `id` and everything under it. */
function subtree(blocks: readonly NoteBlock[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const block of blocks) {
      if (block.parentBlockId && out.has(block.parentBlockId) && !out.has(block.id)) {
        out.add(block.id);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * The note with the recorder's blocks replaced by `rendered`, after the
 * user's at the top level: what the user wrote comes first, always.
 *
 * Only blocks still in `generated` are the recorder's to replace; one the
 * user edited left the map and stays where it is. A key rendered again keeps
 * its block id.
 */
export function withGenerated(
  blocks: readonly NoteBlock[],
  generated: GeneratedMap,
  rendered: readonly RenderedBlock[],
  /** Block ids: UUIDv7, which Nilo requires (`newNoteId`). */
  newId: () => string,
): { blocks: NoteBlock[]; generated: GeneratedMap } {
  const idForKey = new Map(Object.entries(generated).map(([id, ref]) => [ref.key, id]));
  const replaced = new Set<string>();
  for (const id of Object.keys(generated))
    for (const gone of subtree(blocks, id)) replaced.add(gone);
  const kept = blocks.filter((block) => !replaced.has(block.id));
  const used = new Set(kept.map((block) => block.id));

  const next: GeneratedMap = {};
  const added: NoteBlock[] = [];
  const topLevel = kept.filter((block) => block.parentBlockId === null).length;
  const place = (items: readonly RenderedBlock[], parentBlockId: string | null, start: number) => {
    items.forEach((item, index) => {
      const known = idForKey.get(item.key);
      const id = known && !used.has(known) ? known : newId();
      used.add(id);
      next[id] = { key: item.key };
      added.push({
        id,
        parentBlockId,
        type: item.type,
        content: item.content,
        order: start + index,
      });
      place(item.children ?? [], id, 0);
    });
  };
  place(rendered, null, topLevel);
  return { blocks: renumber([...kept, ...added]), generated: next };
}

/* ── Merging ───────────────────────────────────────────────────── */

const sameContent = (a: NoteBlock, b: NoteBlock) =>
  a.type === b.type && JSON.stringify(a.content) === JSON.stringify(b.content);

/** Each block's parent and the sibling before it: where it is, as an anchor. */
function positions(
  blocks: readonly NoteBlock[],
): Map<string, { parent: string | null; after: string | null }> {
  const out = new Map<string, { parent: string | null; after: string | null }>();
  const last = new Map<string | null, string>();
  for (const block of inReadingOrder(blocks)) {
    out.set(block.id, {
      parent: block.parentBlockId,
      after: last.get(block.parentBlockId) ?? null,
    });
    last.set(block.parentBlockId, block.id);
  }
  return out;
}

/**
 * Two versions of a note's blocks made one, against the version both started
 * from (`base`): `mine` is the side whose edits are being brought in (the
 * open editor, unsent local edits), `theirs` the other (the store, the
 * server).
 *
 * Block by block: a block only one side changed takes that side's change; one
 * both changed takes mine; one either side added is kept. A block one side
 * deleted goes, unless the other side changed it since — then the edit wins,
 * because a silently lost sentence is the one outcome worse than a stale one.
 * Positions follow the same rule: a block mine moved or added goes after the
 * sibling it follows in mine, everything else stays where theirs has it.
 */
export function mergeBlocks(
  base: readonly NoteBlock[],
  mine: readonly NoteBlock[],
  theirs: readonly NoteBlock[],
): NoteBlock[] {
  const baseById = new Map(base.map((block) => [block.id, block]));
  const mineById = new Map(mine.map((block) => [block.id, block]));
  const theirsById = new Map(theirs.map((block) => [block.id, block]));
  // Whether mine moved a block is read among the blocks both mine and base
  // have: a neighbour mine deleted or added does not make a block "moved".
  const shared = (blocks: readonly NoteBlock[], other: Map<string, NoteBlock>) =>
    positions(blocks.filter((block) => other.has(block.id)));
  const basePositions = shared(base, mineById);
  const mineSharedPositions = shared(mine, baseById);
  const minePositions = positions(mine);

  // Content, and which blocks survive.
  const merged = new Map<string, NoteBlock>();
  for (const id of new Set([...mineById.keys(), ...theirsById.keys(), ...baseById.keys()])) {
    const was = baseById.get(id);
    const m = mineById.get(id);
    const t = theirsById.get(id);
    if (!was) {
      // Added on one side (both adding one id is the same block twice: mine).
      if (m ?? t) merged.set(id, (m ?? t) as NoteBlock);
      continue;
    }
    if (m && t)
      merged.set(id, sameContent(m, was) ? t : { ...t, type: m.type, content: m.content });
    else if (m && !t) {
      if (!sameContent(m, was)) merged.set(id, m);
    } else if (t && !m) {
      if (!sameContent(t, was)) merged.set(id, t);
    }
  }

  // Theirs' arrangement, then mine's moves and additions on top of it.
  const order = new Map<string | null, string[]>();
  const sibling = (parent: string | null) => {
    let list = order.get(parent);
    if (!list) {
      list = [];
      order.set(parent, list);
    }
    return list;
  };
  const parentOf = new Map<string, string | null>();
  for (const block of inReadingOrder(theirs)) {
    if (!merged.has(block.id)) continue;
    const parent =
      block.parentBlockId && merged.has(block.parentBlockId) ? block.parentBlockId : null;
    sibling(parent).push(block.id);
    parentOf.set(block.id, parent);
  }
  const place = (id: string, parent: string | null, after: string | null) => {
    const current = parentOf.get(id);
    if (current !== undefined) {
      const list = sibling(current);
      list.splice(list.indexOf(id), 1);
    }
    const target = parent && merged.has(parent) ? parent : null;
    const list = sibling(target);
    const index = after ? list.indexOf(after) : -1;
    list.splice(index + 1, 0, id);
    parentOf.set(id, target);
  };
  for (const block of inReadingOrder(mine)) {
    if (!merged.has(block.id)) continue;
    const now = minePositions.get(block.id);
    const was = basePositions.get(block.id);
    const sharedNow = mineSharedPositions.get(block.id);
    const moved = !was || was.parent !== sharedNow?.parent || was.after !== sharedNow?.after;
    if (moved || !parentOf.has(block.id)) place(block.id, now?.parent ?? null, now?.after ?? null);
  }
  // A block still unplaced (its side's parent went away) goes to the top level.
  for (const id of merged.keys()) if (!parentOf.has(id)) place(id, null, null);

  const out: NoteBlock[] = [];
  for (const [parent, ids] of order) {
    ids.forEach((id, index) => {
      const block = merged.get(id) as NoteBlock;
      out.push({ ...block, parentBlockId: parent, order: index });
    });
  }
  return renumber(out);
}

/**
 * The recorder's map after the user's edits: a generated block the user
 * changed or removed is no longer the recorder's (their change must survive
 * the next rebuild).
 */
export function adoptEdited(
  base: readonly NoteBlock[],
  mine: readonly NoteBlock[],
  generated: GeneratedMap,
): GeneratedMap {
  const before = new Map(base.map((block) => [block.id, block]));
  const after = new Map(mine.map((block) => [block.id, block]));
  const next: GeneratedMap = {};
  for (const [id, ref] of Object.entries(generated)) {
    const was = before.get(id);
    const now = after.get(id);
    if (was && now && !sameContent(was, now)) continue;
    if (was && !now) continue;
    next[id] = ref;
  }
  return next;
}
