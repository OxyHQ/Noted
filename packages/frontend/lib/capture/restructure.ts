/**
 * Turning what was said into the note.
 *
 * Called as transcription produces segments, so the note fills in while the
 * meeting is still happening rather than appearing at the end.
 *
 * The user's own writing is the reason this reads the note first. Someone typing
 * during a meeting is doing the most valuable part of the work, and a structurer
 * that overwrote them would be actively destructive — so their text goes in
 * first, verbatim, their title wins if they gave one, and their checklist keeps
 * its order and its ticks. The transcript is not copied into the body at all: a
 * note is the handful of things worth reading again, and the full transcript
 * stays alongside it for anyone who wants to go back to the source.
 */

import { createLogger } from '@oxyhq/core/logger';

import { execute } from '@/lib/db/client';
import {
  rowsToSegments,
  SEGMENTS_BY_CAPTURE_SQL,
  type TranscriptSegmentRow,
} from '@/lib/capture/captures-repo';
import { newNoteId } from '@/lib/db/ids';
import { getNote, updateNote } from '@/lib/db/notes-repo';
import { structureTranscript, toNotePatch } from '@/lib/structure/structure';

const logger = createLogger('NotedCapture');

/**
 * Rebuild `noteId` from everything `captureId` has transcribed so far.
 *
 * Rebuilt from the whole transcript each time rather than appended to: a later
 * slice can settle a question an earlier one raised, and only a pass over
 * everything can notice that. The transcript is small — minutes of speech, not
 * megabytes — so this stays cheap enough to run on every slice.
 */
export async function restructureNote(
  captureId: string,
  noteId: string,
  startedAt: Date,
): Promise<void> {
  const rows = await execute<TranscriptSegmentRow>(SEGMENTS_BY_CAPTURE_SQL, [captureId]);
  const segments = rowsToSegments(rows);
  if (segments.length === 0) return;

  const note = await getNote(noteId);
  if (!note) {
    // The note was deleted while its recording was still running. Nothing to
    // write to, and nothing wrong: the user threw it away.
    logger.debug('Skipped structuring a note that no longer exists', { noteId });
    return;
  }

  const structured = structureTranscript(segments, {
    startedAt,
    makeId: newNoteId,
    existing: { title: note.title, body: note.body, checklist: note.checklist },
  });

  await updateNote(noteId, toNotePatch(structured));
}
