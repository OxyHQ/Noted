/**
 * Keeping an open editor and the store in agreement about one note.
 *
 * The editor holds a draft because a text field cannot be re-rendered from the
 * database on every keystroke and still keep a caret. That draft used to be
 * hydrated once and never again, which was fine while the editor was the only
 * thing writing notes — and stopped being fine the moment a recording could
 * rewrite a note that was already open. The card read the store and the editor
 * read its frozen draft, so the same note showed two different things, and any
 * keystroke then wrote the frozen version back over the recording.
 *
 * ## Why this is a three-way merge and not "reload when it changes"
 *
 * Reloading whenever the store moves throws away whatever the user has typed
 * since. Reloading only when nothing is pending throws it away slightly less
 * often. Both are guesses about which side is right, made without the one piece
 * of information that settles it: what the note looked like when the editor last
 * agreed with the store.
 *
 * With that common ancestor, no guess is needed. A field the user has not
 * touched still matches the ancestor, so the store's value is taken. A field
 * they have touched does not, so theirs is kept. Nothing is compared between the
 * two live versions, which is what makes this safe to run on every store change,
 * mid-sentence, as often as a recording produces one.
 *
 * ## The body is the field with two owners
 *
 * Every other field belongs to whoever wrote it last. The body does not: it is
 * the user's writing and the app's generated block, composed. So it is merged
 * rather than chosen — the user's half comes out of the draft using the block
 * that is actually inside it, and goes back on top of whatever the app has
 * written since. Extracting with the DRAFT's block rather than the store's is
 * the whole trick: they differ exactly when a slice has landed since the editor
 * last looked, which is the case this exists for.
 */

import type { LocalNote } from '@/lib/db/notes-repo';
import { composeNoteBody, userBodyOf } from '@/lib/notes/generated-body';

/**
 * Whether the user has left a field alone since the draft last agreed with the
 * store.
 *
 * Arrays are compared by their serialised form: a checklist is small, and the
 * editor replaces it wholesale on every change, so there is no identity to
 * compare that would not report a change on every render.
 */
function untouched(base: unknown, draft: unknown): boolean {
  if (base === draft) return true;
  if (Array.isArray(base) && Array.isArray(draft)) {
    return JSON.stringify(base) === JSON.stringify(draft);
  }
  return false;
}

function pick<T>(base: T, draft: T, stored: T): T {
  return untouched(base, draft) ? stored : draft;
}

/**
 * The draft an open editor should hold now that the store has moved.
 *
 * @param base   the note as it was when the draft last agreed with the store
 * @param draft  what the editor is showing, including anything typed since
 * @param stored the note as it is now
 */
export function reconcileDraft(base: LocalNote, draft: LocalNote, stored: LocalNote): LocalNote {
  // Normally the editor does not own this half at all, so the draft still holds
  // the block it was given and the store's wins. The exception is a conversion
  // between a body and a checklist: that moves every generated line into
  // something the user owns and clears the draft's record of it. Running it
  // through the same rule as every other field is what keeps a slice landing in
  // the moment after that conversion from putting the block straight back.
  const generatedBody = pick(base.generatedBody, draft.generatedBody, stored.generatedBody);

  // Extracted with the block each side actually holds. The draft's and the
  // base's differ exactly when a slice has landed since the editor last looked,
  // which is the case this exists for.
  const baseUserBody = userBodyOf(base.body, base.generatedBody);
  const draftUserBody = userBodyOf(draft.body, draft.generatedBody);

  return {
    // Everything the editor does not own — id, kind, ordering, timestamps —
    // comes from the store as-is. The body below is composed with the
    // `generatedBody` above, which is what keeps the pair consistent for the
    // next reconcile: the block recorded is the block sitting inside the text.
    ...stored,
    generatedBody,
    title: pick(base.title, draft.title, stored.title),
    body:
      draftUserBody === baseUserBody && generatedBody === stored.generatedBody
        ? stored.body
        : composeNoteBody(draftUserBody, generatedBody),
    checklist: pick(base.checklist, draft.checklist, stored.checklist),
    color: pick(base.color, draft.color, stored.color),
    labels: pick(base.labels, draft.labels, stored.labels),
    pinned: pick(base.pinned, draft.pinned, stored.pinned),
    archived: pick(base.archived, draft.archived, stored.archived),
    trashed: pick(base.trashed, draft.trashed, stored.trashed),
    attachments: pick(base.attachments, draft.attachments, stored.attachments),
    reminderAt: pick(base.reminderAt, draft.reminderAt, stored.reminderAt),
  };
}
