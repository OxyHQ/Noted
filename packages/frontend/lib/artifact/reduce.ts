/**
 * Folding a fresh reading of the transcript into the note already on screen.
 *
 * The live pass rebuilds from the whole transcript every few seconds, and the
 * naive thing to do with the result — replace the note with it — is what makes a
 * live note unreadable: bullets reorder, a line the reader was half-way through
 * moves, and anything they touched is gone.
 *
 * So the new reading is RECONCILED against the old one. An item that says the
 * same thing as one already there keeps that item's id and its place, and only
 * its wording improves. That matters more than it sounds: the de-duplicator keeps
 * the fullest wording of a point, so a sentence cut short by a slice boundary is
 * REPLACED by its complete version a few seconds later — same point, different
 * text, and without identity resolution that reads as one bullet vanishing and
 * another appearing somewhere else.
 *
 * Identity is resolved by similarity rather than by id alone for exactly that
 * reason: the id is a hash of the text, so a reworded point cannot match itself.
 */

import type { GeneratedItem, GeneratedNoteArtifact, SourceRange } from '@/lib/artifact/types';
import { transitionItem } from '@/lib/artifact/artifact';
import { isProtected, type OverrideMap } from '@/lib/artifact/ownership';
import { isNearDuplicate } from '@/lib/structure/similar';

/** What to do with an item the new reading did not produce. */
export type MissingPolicy =
  /** It was merged into a better-worded one, or it was never really there. */
  | 'drop'
  /**
   * Something was said after it that settled it.
   *
   * Used for open questions: the whole-transcript pass decides afresh which
   * questions are still open, so one it stops reporting is one the conversation
   * moved past. Kept rather than deleted so its id — and anything the user did to
   * it — survives.
   */
  | 'resolve';

/** Both source lists, without repeating a range that is already there. */
export function mergeSources(
  left: readonly SourceRange[],
  right: readonly SourceRange[],
): SourceRange[] {
  const merged = [...left];
  for (const range of right) {
    const already = merged.some(
      (existing) =>
        existing.captureId === range.captureId &&
        existing.startMs === range.startMs &&
        existing.endMs === range.endMs,
    );
    if (!already) merged.push(range);
  }
  return merged;
}

/** The item in `candidates` that says the same thing as `item`, if any. */
function matchOf<T extends GeneratedItem>(item: GeneratedItem, candidates: readonly T[]): T | undefined {
  return (
    candidates.find((candidate) => candidate.id === item.id) ??
    candidates.find((candidate) => isNearDuplicate(candidate.text, item.text))
  );
}

/**
 * Reconcile one list.
 *
 * Order comes from `previous`, so the note does not rearrange itself under the
 * reader; genuinely new items are appended at the end, which is where somebody
 * watching a live note expects new things to appear.
 */
export function reconcileItems<T extends GeneratedItem>(
  previous: readonly T[],
  next: readonly T[],
  options: { overrides: OverrideMap; missing: MissingPolicy },
): T[] {
  const claimed = new Set<string>();
  const reconciled: T[] = [];

  for (const item of previous) {
    const match = matchOf(item, next);
    if (match) {
      claimed.add(match.id);
      reconciled.push(
        // An item the user touched keeps the wording it had when they touched
        // it. Their edit lives in the overrides and is applied at read time, but
        // silently replacing the text underneath it would make their edit
        // describe a different sentence.
        isProtected(item.id, options.overrides)
          ? item
          : { ...match, id: item.id, sources: mergeSources(item.sources, match.sources) },
      );
      continue;
    }

    if (isProtected(item.id, options.overrides)) {
      reconciled.push(item);
      continue;
    }
    if (options.missing === 'resolve') reconciled.push(transitionItem(item, 'resolved'));
  }

  for (const item of next) {
    if (!claimed.has(item.id) && !reconciled.some((kept) => kept.id === item.id)) {
      reconciled.push(item);
    }
  }
  return reconciled;
}

/**
 * Fold a freshly built artifact into the one already stored.
 *
 * Sections and checklists are matched by id — the deterministic generator names
 * them after the capture, so they are stable — and a section only the new reading
 * produced is appended.
 */
export function reduceLiveArtifact(
  previous: GeneratedNoteArtifact | null,
  next: GeneratedNoteArtifact,
  overrides: OverrideMap,
): GeneratedNoteArtifact {
  if (!previous) return next;

  const sections = [...previous.sections.map((section) => ({ ...section }))];
  for (const section of next.sections) {
    const target = sections.find((candidate) => candidate.id === section.id);
    if (target) {
      target.items = reconcileItems(target.items, section.items, { overrides, missing: 'drop' });
      target.heading = section.heading;
    } else {
      sections.push({ ...section });
    }
  }

  const checklists = [...previous.checklists.map((checklist) => ({ ...checklist }))];
  for (const checklist of next.checklists) {
    const target = checklists.find((candidate) => candidate.id === checklist.id);
    if (target) {
      target.items = reconcileItems(target.items, checklist.items, {
        overrides,
        missing: 'drop',
      });
    } else {
      checklists.push({ ...checklist });
    }
  }

  return {
    ...next,
    // A title the user rewrote keeps its id, so the override keeps pointing at
    // something.
    title:
      previous.title && isProtected(previous.title.id, overrides) ? previous.title : next.title,
    sections: sections.filter((section) => section.items.length > 0),
    checklists: checklists.filter((checklist) => checklist.items.length > 0),
    openQuestions: reconcileItems(previous.openQuestions, next.openQuestions, {
      overrides,
      missing: 'resolve',
    }),
    createdAt: previous.createdAt,
  };
}
