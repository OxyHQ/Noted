/**
 * The rules an artifact obeys, kept away from anything that can write one.
 *
 * Every function here is pure and total: given the same artifact it returns the
 * same answer, and it never reaches SQLite, a model, or a clock. That is what
 * lets the interesting cases — a question answered two windows later, a stale
 * task trying to commit after finalisation, a derived item with no receipt — be
 * tested as arithmetic rather than as a recording.
 */

import type { ArtifactStage, GeneratedBlock, GeneratedListItem, CaptureProfile, DocumentIntent, GeneratedChecklist, GeneratedChecklistItem, GeneratedItem, GeneratedItemStatus, GeneratedNoteArtifact, GeneratedSection } from '@noted/shared-types';

/**
 * Which status changes a later revision is allowed to make.
 *
 * Written down rather than left to each generator, because the two directions
 * are not symmetric and the asymmetry is the point:
 *
 * - A question can be answered (`resolved`) and, if it comes back up, re-opened.
 * - A decision can be overturned (`superseded`), and an overturned decision does
 *   NOT come back — "we're launching Friday" after "actually Monday" is history,
 *   and presenting it as current again is precisely the bug.
 * - `removed` is terminal. Something taken out of the note stays out; anything
 *   else means a correction the user watched happen can silently undo itself.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<GeneratedItemStatus, readonly GeneratedItemStatus[]>> = {
  active: ['active', 'resolved', 'superseded', 'removed'],
  resolved: ['resolved', 'active', 'removed'],
  superseded: ['superseded', 'removed'],
  removed: ['removed'],
};

export function canTransition(from: GeneratedItemStatus, to: GeneratedItemStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Move an item to `to`, or leave it alone if that move is not allowed.
 *
 * Refusing rather than throwing on purpose: the caller is usually applying a
 * model's opinion about an item, and a model that wants to revive a superseded
 * decision should be ignored, not crash the finalisation that would otherwise
 * have produced a perfectly good note.
 */
export function transitionItem<T extends GeneratedItem>(item: T, to: GeneratedItemStatus): T {
  return canTransition(item.status, to) ? { ...item, status: to } : item;
}

/**
 * Items the reader should see: the ones still standing.
 *
 * Only `active`, and `resolved` is the interesting exclusion. An answered
 * question does not belong in a list of open questions — its answer belongs in
 * the notes, which is where the finaliser puts it. What `resolved` buys over
 * deleting the item is the id: the user's edit still points at something, and a
 * later pass can tell "this was settled" from "this was overturned" and from
 * "the user threw it away".
 */
export function visibleItems<T extends GeneratedItem>(items: readonly T[]): T[] {
  return items.filter((item) => item.status === 'active');
}

/**
 * Replace an item in place, or append it.
 *
 * In place, and this is the whole reason items carry ids: an update that removed
 * and re-appended would reorder the note on every slice, which is what makes a
 * live note unreadable while somebody is still talking.
 */
export function upsertItem<T extends GeneratedItem>(items: readonly T[], next: T): T[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index === -1) return [...items, next];
  const merged = [...items];
  merged[index] = next;
  return merged;
}

/**
 * The units of a block: the thing a reader can edit and a pass can retire.
 *
 * A paragraph and a quote ARE units — they carry text of their own. A list is a
 * container: editing it means editing one of its lines, so its lines are the
 * units and the block itself is structure.
 */
export function blockUnits(block: GeneratedBlock): GeneratedItem[] {
  return block.kind === 'paragraph' || block.kind === 'quote' ? [block] : block.items;
}

/** Every unit in the artifact, title included, in reading order. */
export function allItems(artifact: GeneratedNoteArtifact): GeneratedItem[] {
  return [
    ...(artifact.title ? [artifact.title] : []),
    ...artifact.sections.flatMap((section) => section.blocks.flatMap(blockUnits)),
    ...artifact.checklists.flatMap((checklist) => checklist.items),
    ...artifact.openQuestions,
  ];
}

/** Look an item up wherever it lives. */
export function findItem(
  artifact: GeneratedNoteArtifact,
  itemId: string,
): GeneratedItem | undefined {
  return allItems(artifact).find((item) => item.id === itemId);
}

/**
 * Rewrite every item through `map`, wherever it sits.
 *
 * Sections, checklists, open questions and the title are four different shapes of
 * the same thing, and a caller that walked them itself would be a caller that
 * forgets one — which in practice means user edits surviving in the body and
 * vanishing from the checklist.
 */
export function mapItems(
  artifact: GeneratedNoteArtifact,
  map: (item: GeneratedItem) => GeneratedItem,
  /**
   * Checklist items by default get `map` applied over their own shape, so the
   * tick and the quantity survive a caller that only cares about text. A caller
   * that needs to change those passes its own.
   */
  mapChecklist: (item: GeneratedChecklistItem) => GeneratedChecklistItem = (item) => ({
    ...item,
    ...map(item),
  }),
): GeneratedNoteArtifact {
  const mapBlock = (block: GeneratedBlock): GeneratedBlock => {
    if (block.kind === 'paragraph' || block.kind === 'quote') {
      // Spread over the block, not replaced by the mapped unit: `map` returns a
      // `GeneratedItem`, and a quote's attribution is not one of its fields.
      return { ...block, ...map(block) };
    }
    return { ...block, items: block.items.map((item) => ({ ...item, ...map(item) })) };
  };

  return {
    ...artifact,
    title: artifact.title ? map(artifact.title) : undefined,
    sections: artifact.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map(mapBlock),
    })),
    checklists: artifact.checklists.map((checklist) => ({
      ...checklist,
      items: checklist.items.map(mapChecklist),
    })),
    openQuestions: artifact.openQuestions.map(map),
  };
}

/** Drop items `keep` rejects, and then any section or checklist left empty. */
export function filterItems(
  artifact: GeneratedNoteArtifact,
  keep: (item: GeneratedItem) => boolean,
): GeneratedNoteArtifact {
  const keepBlock = (block: GeneratedBlock): GeneratedBlock | null => {
    if (block.kind === 'paragraph' || block.kind === 'quote') return keep(block) ? block : null;
    const items = block.items.filter(keep);
    // A list whose every line went is not an empty list, it is nothing.
    return items.length > 0 ? { ...block, items } : null;
  };

  return {
    ...artifact,
    title: artifact.title && keep(artifact.title) ? artifact.title : undefined,
    sections: artifact.sections
      .map((section) => ({
        ...section,
        blocks: section.blocks
          .map(keepBlock)
          .filter((block): block is GeneratedBlock => block !== null),
      }))
      .filter((section) => section.blocks.length > 0),
    checklists: artifact.checklists
      .map((checklist) => ({ ...checklist, items: checklist.items.filter(keep) }))
      .filter((checklist) => checklist.items.length > 0),
    openQuestions: artifact.openQuestions.filter(keep),
  };
}

/**
 * Whether an item is one a reader could check against the recording.
 *
 * Derived items are not, by construction, and that is fine — they are marked as
 * derived and carry the instruction that authorised them. What this catches is
 * the dangerous case: an item claiming `transcript` origin with nothing behind
 * it, which is a model asserting that somebody said something.
 */
export function isGrounded(item: GeneratedItem): boolean {
  return item.sources.length > 0;
}

/**
 * The complaints an artifact would make about itself.
 *
 * Returned as strings rather than thrown, because the caller's correct response
 * is almost never to fail: a malformed model reply is an ordinary outcome, and
 * the deterministic note is already written. Callers drop the offending items and
 * log the reasons.
 */
export function artifactProblems(artifact: GeneratedNoteArtifact): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const item of allItems(artifact)) {
    if (seen.has(item.id)) problems.push(`duplicate item id: ${item.id}`);
    seen.add(item.id);

    if (item.text.trim() === '') problems.push(`empty item text: ${item.id}`);

    // The trust rule, enforced rather than documented: knowledge Noted supplied
    // itself must name the instruction that asked for it, or there is no way for
    // a reader — or a later reviewer — to tell it from something that was said.
    if (item.origin === 'derived-from-instruction' && !item.instructionSource) {
      problems.push(`derived item without an authorising instruction: ${item.id}`);
    }
    if (item.origin === 'transcript' && !isGrounded(item)) {
      problems.push(`transcript item with no source: ${item.id}`);
    }
  }
  return problems;
}

export interface NewArtifactInput {
  id: string;
  noteId: string;
  captureId: string;
  stage: ArtifactStage;
  profile?: CaptureProfile;
  intent?: DocumentIntent;
  transcriptRevision?: number;
  now: string;
}

/** An artifact with nothing in it yet — what a generator starts from. */
export function emptyArtifact(input: NewArtifactInput): GeneratedNoteArtifact {
  return {
    id: input.id,
    noteId: input.noteId,
    captureId: input.captureId,
    stage: input.stage,
    profile: input.profile ?? 'auto',
    intent: input.intent ?? 'freeform',
    transcriptRevision: input.transcriptRevision ?? 0,
    artifactRevision: 0,
    sections: [],
    checklists: [],
    openQuestions: [],
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** Whether the artifact would render as nothing at all. */
export function isEmptyArtifact(artifact: GeneratedNoteArtifact): boolean {
  return visibleItems(allItems(artifact)).length === 0;
}

/**
 * Stamp a commit.
 *
 * `artifactRevision` only ever goes up, so a reader holding an older copy can
 * tell it is older without comparing contents.
 */
export function committed(
  artifact: GeneratedNoteArtifact,
  input: { transcriptRevision: number; now: string },
): GeneratedNoteArtifact {
  return {
    ...artifact,
    transcriptRevision: input.transcriptRevision,
    artifactRevision: artifact.artifactRevision + 1,
    updatedAt: input.now,
  };
}

/**
 * Whether a task that read `taskRevision` may still write.
 *
 * The check the whole pipeline turns on. Work started against an older transcript
 * has not seen whatever arrived since, so committing it puts the note BACK — the
 * exact failure of the current code, where a slow restructure from ten seconds
 * ago lands on top of a fresher one.
 *
 * A live task may also never touch a final artifact, whatever its revision:
 * finalisation has read the whole recording and a live pass never has.
 */
export function mayCommit(
  current: Pick<GeneratedNoteArtifact, 'stage' | 'transcriptRevision'> | null,
  task: { stage: ArtifactStage; transcriptRevision: number },
): boolean {
  if (!current) return true;
  if (current.stage === 'final' && task.stage === 'live') return false;
  return task.transcriptRevision >= current.transcriptRevision;
}

/**
 * Sections with only their standing blocks, dropped entirely when nothing
 * survives.
 */
export function nonEmptySections(artifact: GeneratedNoteArtifact): GeneratedSection[] {
  const standing = (block: GeneratedBlock): GeneratedBlock | null => {
    if (block.kind === 'paragraph' || block.kind === 'quote') {
      return block.status === 'active' ? block : null;
    }
    const items = visibleItems(block.items) as GeneratedListItem[];
    return block.status === 'active' && items.length > 0 ? { ...block, items } : null;
  };

  return artifact.sections
    .map((section) => ({
      ...section,
      blocks: section.blocks
        .map(standing)
        .filter((block): block is GeneratedBlock => block !== null),
    }))
    .filter((section) => section.blocks.length > 0);
}

/** Checklists with their visible items, dropped entirely when nothing survives. */
export function nonEmptyChecklists(artifact: GeneratedNoteArtifact): GeneratedChecklist[] {
  return artifact.checklists
    .map((checklist) => ({ ...checklist, items: visibleItems(checklist.items) }))
    .filter((checklist) => checklist.items.length > 0);
}
