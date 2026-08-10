/**
 * A generated item's name, derived from what it says.
 *
 * The live pass rebuilds the note from the whole transcript every few seconds. If
 * each rebuild minted fresh ids, every item would be a new item: the note would
 * reorder on every slice, and the checklist item somebody ticked forty seconds
 * ago would be a different item by the time they looked back at it.
 *
 * So the id is a function of the content. The same point, recognised again in the
 * next rebuild, gets the same id — which is what makes "update in place" possible
 * at all, and what lets a user's edit survive a rebuild it never heard about.
 *
 * Compared the way `lib/structure/similar.ts` compares: case, punctuation and
 * spacing are not content, so a sentence the recogniser punctuated differently
 * the second time is still the same sentence.
 */

import { normaliseForComparison } from '@/lib/structure/similar';

/**
 * djb2, in 32 bits.
 *
 * Not a cryptographic hash and not trying to be: it names a bullet inside one
 * note. What it has to be is STABLE across app versions and platforms, which
 * rules out anything the runtime supplies — a `Map` iteration order, a random
 * seed, or a `String.hashCode` that does not exist here.
 */
function hash32(text: string): number {
  let value = 5381;
  for (let index = 0; index < text.length; index += 1) {
    // `| 0` after each step keeps this in 32-bit territory on every engine
    // rather than drifting into doubles at different points on different ones.
    value = ((value * 33) ^ text.charCodeAt(index)) | 0;
  }
  return value >>> 0;
}

/**
 * The id for an item of `kind` saying `text`.
 *
 * `kind` is part of it because the same sentence can legitimately be two things —
 * a decision quoted inside a note, an action restated as a takeaway — and they
 * are separate items with separate ownership.
 */
export function itemId(kind: string, text: string): string {
  return `${kind}${GENERATED_ID_SEPARATOR}${hash32(normaliseForComparison(text)).toString(36)}`;
}

/**
 * What tells a generated id from one the app minted for the user.
 *
 * `newNoteId` is nanoid's alphabet — letters, digits, `_` and `-` — so a colon
 * cannot appear in an id the user's own checklist item carries. That is what
 * makes this a real discriminator rather than a guess, and it is the replacement
 * for the exact-substring trick this epic exists to delete.
 */
const GENERATED_ID_SEPARATOR = ':';

export function isGeneratedItemId(id: string): boolean {
  return id.includes(GENERATED_ID_SEPARATOR);
}
