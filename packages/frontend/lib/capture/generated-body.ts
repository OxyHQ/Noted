/**
 * Telling apart what the user wrote from what the app wrote.
 *
 * Without this the note eats itself. Every slice of transcript rebuilds the
 * note, and the rebuild treats the current body as the user's writing and
 * preserves it — so the block the app generated last time is kept, and a new one
 * is appended after it. Four slices, four identical copies of the same
 * "Open questions" section, which is exactly what a real recording produced.
 *
 * The fix is to remember what the app generated, so the next pass can replace it
 * instead of building on top of it.
 *
 * ## What this cannot tell apart, said plainly
 *
 * The block is found by its exact text. If someone types INSIDE it, it no longer
 * matches and whatever they left becomes their writing — which is also what
 * happens if they type immediately after it. Those two are the same edit as far
 * as a string is concerned, and pretending otherwise would need markers in the
 * note that the user can see. Treating an unrecognised body as the user's is the
 * safe direction: the worst case is one stale block kept as theirs, never a
 * silently deleted sentence.
 */

/** Blank line between the two, so Markdown keeps them as separate blocks. */
const SEPARATOR = '\n\n';

/** Three or more newlines is a gap, not a paragraph break. */
const PILED_BLANK_LINES = /\n{3,}/g;

/**
 * What the user wrote, with the app's previous contribution taken out.
 *
 * Anything that is not exactly the remembered block is the user's, including a
 * block they have edited.
 */
export function userBodyOf(currentBody: string, previousGenerated: string): string {
  const previous = previousGenerated.trim();
  if (previous === '') return currentBody.trim();
  // Removing a block from the middle leaves the blank lines that surrounded it
  // back to back, which Markdown renders as a gap that widens on every slice.
  return currentBody.replace(previous, '').replace(PILED_BLANK_LINES, SEPARATOR).trim();
}

/**
 * Put the note back together.
 *
 * The user's writing comes first, always: they were in the meeting and chose to
 * type that, and burying it under generated text would be the app talking over
 * them.
 */
export function composeNoteBody(userBody: string, generated: string): string {
  const user = userBody.trim();
  const written = generated.trim();
  if (user === '') return written;
  if (written === '') return user;
  return `${user}${SEPARATOR}${written}`;
}
