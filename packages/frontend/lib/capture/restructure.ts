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
import { userAuthoredPart } from '@/lib/capture/placeholder-title';
import { structureTranscript, toNotePatch } from '@/lib/structure/structure';
import { enhancementToNotePatch } from '@/lib/enhance/apply';
import { getSummarizer } from '@/lib/enhance/summarizer';

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
    // The start-time placeholder is not a title anyone chose, so it does not
    // get a title's protection.
    existing: userAuthoredPart(note, startedAt),
  });

  await updateNote(noteId, toNotePatch(structured));
}

/**
 * Have a language model read the meeting and rewrite the note.
 *
 * Runs once, when the recording stops — not per slice like `restructureNote`. A
 * model that has read the whole meeting writes a better note than one that has
 * read the first two minutes, and running it repeatedly would spend a phone's
 * battery producing drafts nobody reads.
 *
 * The deterministic note is already written by the time this runs, which is what
 * makes every failure here survivable: no model, no download, a refused reply, a
 * crash — the user still has their note. Nothing about this is on the critical
 * path.
 */
export async function enhanceNote(
  captureId: string,
  noteId: string,
  startedAt: Date,
  language: string,
): Promise<boolean> {
  const summarizer = getSummarizer();
  if ((await summarizer.availability()) !== 'ready') return false;

  const rows = await execute<TranscriptSegmentRow>(SEGMENTS_BY_CAPTURE_SQL, [captureId]);
  const segments = rowsToSegments(rows);
  if (segments.length === 0) return false;

  const note = await getNote(noteId);
  if (!note) return false;

  // Reuse the deterministic pass for its cleaned, block-grouped transcript
  // rather than handing whisper's raw segments to the model: the filler and the
  // repetitions it removes are tokens the model would otherwise spend context
  // on, and a phone's context window is the scarce thing here.
  const existing = userAuthoredPart(note, startedAt);
  const structured = structureTranscript(segments, {
    startedAt,
    makeId: newNoteId,
    existing,
  });

  const enhancement = await summarizer.enhance({
    transcript: structured.transcript,
    existing,
    language,
  });
  if (!enhancement) {
    logger.info('The model had nothing to add; keeping the structured note');
    return false;
  }

  await updateNote(
    noteId,
    enhancementToNotePatch(enhancement, {
      makeId: newNoteId,
      existing,
      fallbackTitle: structured.title,
    }),
  );
  logger.info('Note rewritten by the on-device model', { noteId });
  return true;
}
