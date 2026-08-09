/**
 * Telling two lines apart when the recogniser wrote the same speech twice.
 *
 * Exact-match de-duplication is not enough for a note that is rebuilt as the
 * recording runs. A slice that ends mid-sentence leaves a truncated version
 * behind, and the next slice transcribes the whole thing — so the note ends up
 * carrying both:
 *
 * > - There's a moment where it appears to be thinking, what's actually happening?
 * > - When you send a message to an AI, there's a moment where it appears to be
 * >   thinking, what's actually happening?
 *
 * Those are one line, written twice. Speakers also restate themselves, and the
 * recogniser rarely spells a restatement identically.
 */

/** Lowercase, punctuation-free, single-spaced — what "the same words" means here. */
export function normaliseForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordsOf(normalised: string): string[] {
  return normalised === '' ? [] : normalised.split(' ');
}

/**
 * How much of the shorter line has to appear in the longer one.
 *
 * The overlap coefficient rather than Jaccard: a fragment and the full sentence
 * it came from share every word the fragment has, but Jaccard divides by the
 * union and so scores that pair low — which is exactly the pair this exists to
 * catch.
 */
export const NEAR_DUPLICATE_OVERLAP = 0.7;

/**
 * Below this many distinct words, overlap says nothing.
 *
 * Every word of "Yes" appears in "Yes, we can ship it", which is a perfect score
 * for two remarks that are not the same remark.
 */
const MIN_WORDS_TO_COMPARE = 3;

/**
 * Whether two lines say the same thing, allowing for how speech is transcribed.
 *
 * There is no separate "one line contains the other" branch, and there was one
 * until a test was asked to make it fail on its own. Containment means every
 * word of the shorter line appears in the longer, which scores 1.0 by this
 * measure anyway — so it was a second rule to read carrying no behaviour of its
 * own.
 */
export function isNearDuplicate(a: string, b: string): boolean {
  const left = normaliseForComparison(a);
  const right = normaliseForComparison(b);
  if (left === '' || right === '') return false;
  if (left === right) return true;

  const leftWords = new Set(wordsOf(left));
  const rightWords = new Set(wordsOf(right));
  const shorter = leftWords.size <= rightWords.size ? leftWords : rightWords;
  const longer = leftWords.size <= rightWords.size ? rightWords : leftWords;
  if (shorter.size < MIN_WORDS_TO_COMPARE) return false;

  let shared = 0;
  for (const word of shorter) if (longer.has(word)) shared += 1;
  return shared / shorter.size >= NEAR_DUPLICATE_OVERLAP;
}

/**
 * Drop repeats, keeping the fullest wording of each.
 *
 * The longer line wins deliberately. When the pair is a slice-truncated
 * fragment and the complete sentence, the complete one is the one worth
 * reading; keeping whichever arrived first would keep the fragment.
 */
export function dropNearDuplicates<T>(items: readonly T[], textOf: (item: T) => string): T[] {
  const kept: T[] = [];
  for (const item of items) {
    const text = textOf(item);
    const existing = kept.findIndex((other) => isNearDuplicate(textOf(other), text));
    if (existing === -1) {
      kept.push(item);
      continue;
    }
    if (text.length > textOf(kept[existing]).length) kept[existing] = item;
  }
  return kept;
}
