/**
 * What the user did to something the app wrote.
 *
 * The old answer was to look for the generated block's exact text inside the
 * note: if it was still there byte for byte the app owned it, and if it was not,
 * the user did. That is a guess, and it guesses wrong in both directions — typing
 * one word inside the block hands the app's whole output to the user forever,
 * and it can say nothing at all about a checklist item or a title.
 *
 * So ownership is recorded instead of inferred. Every generated item has an id;
 * touching one writes a row against that id. Nothing is matched by text, nothing
 * depends on the note's Markdown surviving unchanged, and the two questions that
 * actually matter get real answers:
 *
 * - *May a later pass change this item?* Only if the user never touched it.
 * - *What does the reader see?* The user's version, if they gave one.
 */

import type {
  GeneratedBlock,
  GeneratedChecklistItem,
  GeneratedItem,
  GeneratedNoteArtifact,
} from '@/lib/artifact/types';
import { allItems, blockUnits, filterItems, mapItems } from '@/lib/artifact/artifact';

/**
 * One user decision about one generated item.
 *
 * `null` is not `false` here. `checked: null` means "the user never said", which
 * is what lets a regenerated artifact set the tick itself; `checked: false` means
 * they unticked it, which a regeneration must not undo.
 */
export interface UserItemOverride {
  itemId: string;
  /** Replacement text, or null when they only ticked or removed it. */
  text: string | null;
  /** The tick the user set, or null when they never touched it. */
  checked: boolean | null;
  /** They deleted it. Later passes may not bring it back. */
  removed: boolean;
  /**
   * They took it as their own.
   *
   * An adopted item is no longer the app's to reword or retire; it survives every
   * later pass untouched, which is the promise that makes editing generated text
   * safe to do while the recording is still running.
   */
  adopted: boolean;
}

export function emptyOverride(itemId: string): UserItemOverride {
  return { itemId, text: null, checked: null, removed: false, adopted: false };
}

/** Whether this override represents the user having done anything at all. */
export function isTouched(override: UserItemOverride): boolean {
  return (
    override.text !== null || override.checked !== null || override.removed || override.adopted
  );
}

export type OverrideMap = ReadonlyMap<string, UserItemOverride>;

export function overridesById(overrides: readonly UserItemOverride[]): Map<string, UserItemOverride> {
  return new Map(overrides.map((override) => [override.itemId, override]));
}

/**
 * The artifact as the reader should see it: the user's edits on top, their
 * deletions gone.
 *
 * Applied at read time rather than written into the artifact, so the generator's
 * own output stays intact underneath. A regeneration therefore compares against
 * what the model actually said last time, not against a version the user rewrote
 * — otherwise every edit slowly becomes the model's opinion of itself.
 */
export function applyOverrides(
  artifact: GeneratedNoteArtifact,
  overrides: OverrideMap,
): GeneratedNoteArtifact {
  if (overrides.size === 0) return artifact;

  const editText = (item: GeneratedItem): GeneratedItem => {
    const override = overrides.get(item.id);
    return override?.text === null || override === undefined
      ? item
      : { ...item, text: override.text };
  };

  const editChecklistItem = (item: GeneratedChecklistItem): GeneratedChecklistItem => {
    const override = overrides.get(item.id);
    return {
      ...item,
      ...editText(item),
      checked: override?.checked ?? item.checked,
    };
  };

  const edited = mapItems(artifact, editText, editChecklistItem);
  return filterItems(edited, (item) => !(overrides.get(item.id)?.removed ?? false));
}

/**
 * Whether a later pass is allowed to change this item.
 *
 * The line the issue draws, in one place: an item the user checked, edited or
 * adopted is theirs and finalisation may not touch it; one they never looked at
 * is still the app's and later context may resolve, supersede or drop it.
 */
export function isProtected(itemId: string, overrides: OverrideMap): boolean {
  const override = overrides.get(itemId);
  return override !== undefined && isTouched(override);
}

/**
 * Carry the user's items forward into a freshly generated artifact.
 *
 * Finalisation reads the whole recording and writes a new artifact from scratch,
 * which is what makes it able to merge duplicates and close questions — and also
 * what would make it delete the checklist item somebody ticked twenty minutes
 * ago. Anything the user touched and the new pass did not reproduce is put back,
 * in its old section, so "the note settled" never means "my edit disappeared".
 *
 * Items the user REMOVED are deliberately not carried: their override survives
 * and `applyOverrides` drops them again, so a regeneration cannot resurrect
 * something the user threw away.
 */
export function carryProtectedItems(
  previous: GeneratedNoteArtifact | null,
  next: GeneratedNoteArtifact,
  overrides: OverrideMap,
): GeneratedNoteArtifact {
  if (!previous) return next;

  const present = new Set(allItems(next).map((item) => item.id));

  const shouldCarry = (item: { id: string }): boolean =>
    !present.has(item.id) && isProtected(item.id, overrides) && !overrides.get(item.id)?.removed;

  const sections = next.sections.map((section) => ({ ...section }));
  const checklists = next.checklists.map((checklist) => ({ ...checklist }));
  let openQuestions = [...next.openQuestions];

  for (const previousSection of previous.sections) {
    // Only the protected UNITS come back, not the block that held them. A list
    // the user ticked one line of is not a reason to restore the four lines the
    // finaliser deliberately dropped — carrying those would undo the merge the
    // final pass exists to perform.
    const carried = previousSection.blocks
      .map((block) => {
        if (block.kind === 'paragraph' || block.kind === 'quote') {
          return shouldCarry(block) ? block : null;
        }
        const items = block.items.filter(shouldCarry);
        return items.length > 0 ? { ...block, items } : null;
      })
      .filter((block): block is GeneratedBlock => block !== null);
    if (carried.length === 0) continue;
    const target = sections.find((section) => section.id === previousSection.id);
    if (target) target.blocks = [...target.blocks, ...carried];
    else sections.push({ ...previousSection, blocks: carried });
  }

  for (const previousChecklist of previous.checklists) {
    const carried = previousChecklist.items.filter(shouldCarry);
    if (carried.length === 0) continue;
    const target = checklists.find((checklist) => checklist.id === previousChecklist.id);
    if (target) target.items = [...target.items, ...carried];
    else checklists.push({ ...previousChecklist, items: carried });
  }

  openQuestions = [...openQuestions, ...previous.openQuestions.filter(shouldCarry)];

  return { ...next, sections, checklists, openQuestions };
}
