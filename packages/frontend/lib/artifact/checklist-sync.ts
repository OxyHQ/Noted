/**
 * Making a tick on a generated item stick.
 *
 * The note's checklist holds both halves: the items the user typed and the ones a
 * generator produced, merged by the composer. Editing it writes the whole list
 * back to the note — which works fine until the next pass rebuilds the artifact,
 * finds no record that anybody touched anything, and reproduces the item exactly
 * as it first wrote it. The tick disappears, and it disappears minutes later,
 * which is the worst possible time to notice.
 *
 * So a change to a GENERATED item is also recorded as an override against its id.
 * The list write keeps the screen honest now; the override keeps it honest after
 * the next finalisation.
 *
 * Pure, and it takes both lists rather than one gesture, because that is what the
 * checklist editor actually produces: a new array. Working out what changed is
 * this module's job precisely so no surface has to.
 */

import type { ChecklistItem } from '@noted/shared-types';

import { checkItem, editItem, removeItem, type ItemPatch } from '@/lib/artifact/actions';
import { isGeneratedItemId } from '@/lib/artifact/item-id';

/**
 * The overrides to store for a checklist edit.
 *
 * Items the user owns produce nothing: their ids are theirs, the note's own
 * `checklist` column already holds them, and writing an override for one would be
 * recording that the user had touched something the app never wrote.
 */
export function overridesForChecklistChange(
  before: readonly ChecklistItem[],
  after: readonly ChecklistItem[],
): ItemPatch[] {
  const patches: ItemPatch[] = [];
  const afterById = new Map(after.map((item) => [item.id, item]));

  for (const previous of before) {
    if (!isGeneratedItemId(previous.id)) continue;

    const current = afterById.get(previous.id);
    if (!current) {
      patches.push(removeItem(previous.id));
      continue;
    }
    // Both can change in one edit — a person renaming an item often ticks it in
    // the same breath — so these are not exclusive branches.
    if (current.checked !== previous.checked) patches.push(checkItem(previous.id, current.checked));
    if (current.text !== previous.text) patches.push(editItem(previous.id, current.text));
  }

  return patches;
}
