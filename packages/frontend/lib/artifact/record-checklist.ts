/**
 * Storing what a checklist edit meant.
 *
 * The deciding is in `checklist-sync.ts`, which is pure and tested; this is the
 * two-line writer that puts the result somewhere. Kept apart so the rule can be
 * exercised without a database, and so a screen has one call to make rather than
 * a loop to get right.
 */

import { createLogger } from '@oxyhq/core/logger';
import type { ChecklistItem } from '@noted/shared-types';

import { overridesForChecklistChange } from '@/lib/artifact/checklist-sync';
import { setNoteOverride } from '@/lib/db/artifacts-repo';

const logger = createLogger('NotedNotes');

/**
 * Record the user's decisions about the generated items in a checklist.
 *
 * Failures are logged rather than surfaced: the edit itself has already been
 * written to the note, so the screen is correct either way — what is lost is the
 * edit surviving a regeneration, which is worth a log line and not worth a dialog
 * over somebody's shopping list.
 */
export async function recordChecklistOverrides(
  noteId: string,
  before: readonly ChecklistItem[],
  after: readonly ChecklistItem[],
): Promise<void> {
  if (noteId === '' || noteId === 'new') return;

  for (const patch of overridesForChecklistChange(before, after)) {
    try {
      await setNoteOverride(noteId, patch);
    } catch (error) {
      logger.error('Could not record a checklist edit', { error: String(error) });
    }
  }
}
