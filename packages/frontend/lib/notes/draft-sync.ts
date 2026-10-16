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
 * ## The blocks are the field with two owners
 *
 * Every other field belongs to whoever wrote it last. The blocks do not: they
 * are the user's writing and the recorder's, side by side. So they are merged
 * rather than chosen, block by block against the same ancestor
 * (`mergeBlocks`): a block the user has not touched takes the store's
 * version, one they have keeps theirs, and the recorder's map follows the
 * blocks it still owns.
 */
import type { LocalNote } from '@/lib/db/notes-repo';
import { adoptEdited, mergeBlocks } from '@/lib/notes/blocks';

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
  // Nothing the user wrote since the ancestor: the store's blocks are simply
  // newer (a slice, another device, or our own save landing back). Taken as
  // they are, so the editor is handed the exact list the store holds.
  const blocksUntouched = untouched(base.blocks, draft.blocks);
  const blocks = blocksUntouched
    ? stored.blocks
    : mergeBlocks(base.blocks, draft.blocks, stored.blocks);
  const present = new Set(blocks.map((block) => block.id));
  const generated = blocksUntouched
    ? stored.generated
    : Object.fromEntries(
        Object.entries(adoptEdited(base.blocks, draft.blocks, stored.generated)).filter(([id]) =>
          present.has(id),
        ),
      );

  return {
    // Everything the editor does not own — id, kind, ordering, timestamps —
    // comes from the store as-is.
    ...stored,
    blocks,
    generated,
    title: pick(base.title, draft.title, stored.title),
    color: pick(base.color, draft.color, stored.color),
    labels: pick(base.labels, draft.labels, stored.labels),
    pinned: pick(base.pinned, draft.pinned, stored.pinned),
    archived: pick(base.archived, draft.archived, stored.archived),
    trashed: pick(base.trashed, draft.trashed, stored.trashed),
    attachments: pick(base.attachments, draft.attachments, stored.attachments),
    reminderAt: pick(base.reminderAt, draft.reminderAt, stored.reminderAt),
    // Absent and null both mean "not filed", so they must not count as an edit.
    folderId: untouched(base.folderId ?? null, draft.folderId ?? null)
      ? stored.folderId
      : draft.folderId,
  };
}
