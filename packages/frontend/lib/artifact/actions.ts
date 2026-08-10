/**
 * What happens when the user touches something the app wrote.
 *
 * Four gestures — tick it, reword it, throw it away, make it mine — and each one
 * has to answer the same question: may a later pass still change this item? The
 * answer is recorded as an override against the item's id, never inferred from
 * the note's text, which is the whole reason ids exist.
 *
 * Pure on purpose. Each function returns the patch to store, so the rule can be
 * stated once and tested without a database, and the repo layer stays a writer
 * rather than a decision-maker.
 */

import type { UserItemOverride } from '@/lib/artifact/ownership';

export type ItemPatch = Partial<UserItemOverride> & { itemId: string };

/** They ticked or unticked it. */
export function checkItem(itemId: string, checked: boolean): ItemPatch {
  // `false` is a decision, not the absence of one: a regeneration may set a tick
  // nobody has touched, and may not undo one the user cleared.
  return { itemId, checked };
}

/**
 * They reworded it.
 *
 * Empty text is a removal rather than an item with no words in it — an empty
 * bullet is not something anybody meant to write, and leaving one is how a note
 * accumulates blank lines nobody can explain.
 */
export function editItem(itemId: string, text: string): ItemPatch {
  const trimmed = text.trim();
  return trimmed === '' ? removeItem(itemId) : { itemId, text: trimmed };
}

/**
 * They threw it away.
 *
 * Recorded rather than deleted, and that is what makes it stick: the artifact is
 * rebuilt from the transcript on every pass, so an item deleted from the artifact
 * comes straight back. The override is what keeps it gone.
 */
export function removeItem(itemId: string): ItemPatch {
  return { itemId, removed: true };
}

/** They took it back. */
export function restoreItem(itemId: string): ItemPatch {
  return { itemId, removed: false };
}

/**
 * They made it theirs.
 *
 * The strongest of the four: an adopted item is no longer the app's to reword or
 * retire, so it survives finalisation untouched. This is what makes editing
 * generated text safe to do while the recording is still running.
 */
export function adoptItem(itemId: string): ItemPatch {
  return { itemId, adopted: true };
}

/**
 * Whether the app may still change this item.
 *
 * The line the whole ownership model draws, in one place so a surface cannot draw
 * it differently: anything the user touched is theirs.
 */
export function isUserOwned(override: UserItemOverride | undefined): boolean {
  if (!override) return false;
  return (
    override.adopted || override.removed || override.text !== null || override.checked !== null
  );
}
