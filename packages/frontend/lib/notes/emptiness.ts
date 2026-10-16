/**
 * Whether a note has anything in it.
 *
 * Asked when the editor closes, so a note somebody opened, emptied and left does
 * not sit in the grid as a blank card nobody can identify. The same question is
 * asked before a brand-new note is ever created, which is why it lives here
 * rather than being written twice with two slightly different answers.
 *
 * ## What counts as content, and the one that would be a disaster to get wrong
 *
 * A RECORDING is content, even when the user typed nothing at all. That is the
 * whole shape of this product: somebody puts the phone on the table, says
 * nothing into the editor, and the note fills itself. Reading that as empty and
 * discarding it would delete the meeting — so a voice note, or one carrying
 * anything a generator wrote, is never empty.
 *
 * A REMINDER is content too. It is a thing the user set that will go off, and
 * discarding it silently loses something they arranged. Keeping a blank note with
 * a reminder is a small annoyance; deleting it is a missed appointment.
 *
 * Colour, labels and pinned are NOT content. They are how a note is filed, and
 * filing nothing is still nothing — a yellow blank card is no more identifiable
 * than a white one.
 */

import { hasContent, type GeneratedMap, type NoteBlock } from '@/lib/notes/blocks';

export interface EmptinessInput {
  title: string;
  blocks: readonly NoteBlock[];
  /** The recorder's blocks. Any at all means there is a note to keep. */
  generated?: GeneratedMap;
  attachments?: readonly string[];
  reminderAt?: string | null;
  /** `voice` for a note born from a recording. */
  kind?: 'note' | 'voice';
}

export function isEmptyNote(input: EmptinessInput): boolean {
  if (input.kind === 'voice') return false;
  if (Object.keys(input.generated ?? {}).length > 0) return false;
  if (input.reminderAt) return false;
  return (
    input.title.trim() === '' &&
    // A block with no words in it is not content either — it is the empty
    // line the editor offers, or a task row nobody typed into.
    !hasContent(input.blocks) &&
    (input.attachments?.length ?? 0) === 0
  );
}
