import type { ChecklistItem } from '@noted/shared-types';

/**
 * The name a recording carries until something can do better.
 *
 * A meeting has no title before anyone speaks, so a new recording is filed under
 * the moment it started. That is a placeholder, not a decision — and the
 * difference matters, because everything downstream treats a title as the user's
 * and refuses to touch it. Left indistinguishable from one somebody typed, the
 * date would outlive every attempt to name the note properly: the structurer
 * would decline to replace it, and so would the model.
 *
 * So the placeholder is generated in one place and recognised in one place. The
 * comparison is exact, against a value regenerated from the same start time —
 * not a guess at what a date looks like.
 */

export function placeholderTitle(startedAt: Date): string {
  return startedAt.toLocaleString();
}

/**
 * Whether this title is still the one the app filled in.
 *
 * A title the user has edited — even to something that also looks like a date —
 * stops matching, which is the point: from then on it is theirs.
 */
export function isPlaceholderTitle(title: string, startedAt: Date): boolean {
  return title.trim() === placeholderTitle(startedAt).trim();
}

/**
 * The title to hand to a writer, with the placeholder removed.
 *
 * Empty means "nothing of the user's to protect here", which is exactly what
 * both the structurer and the model already do the right thing with.
 */
export function userTitleOf(title: string, startedAt: Date): string {
  return isPlaceholderTitle(title, startedAt) ? '' : title;
}

/** What the user themselves contributed to a note. */
export interface UserAuthored {
  title: string;
  body: string;
  checklist: readonly ChecklistItem[];
}

/**
 * The user's own contribution to a note, as a writer should see it.
 *
 * Both writers — the structurer and the model — take this and treat every field
 * in it as untouchable. Building it here rather than at each call site is what
 * keeps the placeholder from leaking back in: there is one way to describe what
 * the user wrote, and it already knows the date is not one of the things they
 * wrote.
 */
export function userAuthoredPart(
  note: { title: string; body: string; checklist: readonly ChecklistItem[] },
  startedAt: Date,
): UserAuthored {
  return {
    title: userTitleOf(note.title, startedAt),
    body: note.body,
    checklist: note.checklist,
  };
}
