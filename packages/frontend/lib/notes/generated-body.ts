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

/** A note's body and the app's half of it, as stored. */
export interface NoteBody {
  body: string;
  generatedBody: string;
}

/**
 * The body a write should land, given the note as stored and the half the writer
 * is actually changing.
 *
 * This is the ONLY place a note body is assembled. Both writers reach it —
 * `lib/db/notes-repo.ts` calls it for the recorder and for the editor alike —
 * because a body assembled anywhere else is a body assembled from one writer's
 * idea of what the other one wrote.
 *
 * That matters most for the writer with the stalest copy: the open editor. It
 * held the note as it was when it opened, so a full-body write from it lands a
 * body missing every block the recorder has produced since — and the next slice,
 * unable to find its own remembered block inside it, files the whole thing as
 * the user's writing and keeps it forever. Sending only the half it owns is what
 * makes that impossible rather than unlikely.
 *
 * A patch touching neither half leaves the body exactly as it is. Recomposing it
 * "just to be safe" is the opposite of safe: a body the server pushed does not
 * necessarily contain the block this device remembers generating, and rebuilding
 * it from parts that no longer agree is how a duplicate gets written by a patch
 * that only meant to pin the note.
 */
export function nextNoteBody(
  current: NoteBody,
  patch: { userBody?: string; generatedBody?: string },
): NoteBody {
  const generatedBody = patch.generatedBody ?? current.generatedBody;
  if (patch.userBody === undefined && patch.generatedBody === undefined) {
    return { body: current.body, generatedBody };
  }
  const userBody = patch.userBody ?? userBodyOf(current.body, current.generatedBody);
  return { body: composeNoteBody(userBody, generatedBody), generatedBody };
}
