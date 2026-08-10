/**
 * Turning what was said into the note.
 *
 * Two passes, one shape. The live pass runs as transcription produces segments,
 * so the note fills in while the meeting is still happening; the final pass runs
 * once the recording is over and can settle things only the whole recording
 * explains. Both build a `GeneratedNoteArtifact`, both go through the same
 * composer, and the note therefore has the same structure whether or not a model
 * was involved — only the wording is better when one was.
 *
 * The user's own writing is the reason both read the note first. Somebody typing
 * during a meeting is doing the most valuable part of the work, and a pass that
 * overwrote them would be actively destructive — so their text, their title and
 * their checklist items are separated out and handed back untouched. The
 * transcript is never copied into the body: a note is the handful of things worth
 * reading again, and the full transcript stays alongside it.
 */

import type { ChecklistItem } from '@noted/shared-types';
import { createLogger } from '@oxyhq/core/logger';

import { execute } from '@/lib/db/client';
import {
  rowsToSegments,
  SEGMENTS_BY_CAPTURE_SQL,
  type TranscriptSegment,
  type TranscriptSegmentRow,
} from '@/lib/capture/captures-repo';
import { getNote, updateNote, type LocalNote } from '@/lib/db/notes-repo';
import {
  getCaptureArtifacts,
  getNoteOverrides,
  saveArtifact,
  type NoteArtifacts,
} from '@/lib/db/artifacts-repo';
import { userAuthoredPart } from '@/lib/capture/placeholder-title';
import { userBodyOf } from '@/lib/notes/generated-body';
import { committed } from '@/lib/artifact/artifact';
import { composeNote } from '@/lib/artifact/compose';
import { buildDeterministicArtifact, cleanedBlocks } from '@/lib/artifact/generate/deterministic';
import { enhancementToArtifact } from '@/lib/artifact/generate/from-enhancement';
import { finalizeArtifact } from '@/lib/artifact/finalize';
import { isGeneratedItemId } from '@/lib/artifact/item-id';
import { overridesById } from '@/lib/artifact/ownership';
import { reduceLiveArtifact } from '@/lib/artifact/reduce';
import { getSummarizer } from '@/lib/enhance/summarizer';

const logger = createLogger('NotedCapture');

/**
 * The checklist items the user owns.
 *
 * Generated ids carry a `:` and minted ones cannot, so this is a real
 * discriminator rather than the exact-substring guess it replaces — and it works
 * for an item the user has since reworded, which the old trick never could.
 */
function userChecklist(checklist: readonly ChecklistItem[]): ChecklistItem[] {
  return checklist.filter((item) => !isGeneratedItemId(item.id));
}

interface CaptureContext {
  note: LocalNote;
  segments: TranscriptSegment[];
  artifacts: NoteArtifacts;
  overrides: ReturnType<typeof overridesById>;
  userBody: string;
  userTitle: string;
  userItems: ChecklistItem[];
}

/**
 * Everything a pass needs, read once.
 *
 * @returns null when there is nothing to write — no transcript yet, or a note the
 *   user deleted while its recording was still running. Neither is an error.
 */
async function readContext(
  captureId: string,
  noteId: string,
  startedAt: Date,
): Promise<CaptureContext | null> {
  const segments = rowsToSegments(
    await execute<TranscriptSegmentRow>(SEGMENTS_BY_CAPTURE_SQL, [captureId]),
  );
  if (segments.length === 0) return null;

  const note = await getNote(noteId);
  if (!note) {
    logger.debug('Skipped structuring a note that no longer exists', { noteId });
    return null;
  }

  const authored = userAuthoredPart(note, startedAt);
  return {
    note,
    segments,
    artifacts: await getCaptureArtifacts(captureId),
    overrides: overridesById(await getNoteOverrides(noteId)),
    // What the app wrote last time comes out before anything is rebuilt.
    // Without this the note keeps its own previous output as if the user had
    // typed it, and every slice appends another copy of the same sections.
    userBody: userBodyOf(note.body, note.generatedBody),
    userTitle: authored.title,
    userItems: userChecklist(note.checklist),
  };
}

/** Persist an artifact and the note it composes to, unless something newer won. */
async function commit(
  context: CaptureContext,
  artifact: Parameters<typeof saveArtifact>[0],
  startedAt: Date,
): Promise<boolean> {
  const landed = await saveArtifact(artifact);
  if (!landed) {
    // An ordinary outcome: a newer revision, or the settled artifact, got there
    // first. Retrying is how a stale pass eventually wins, so it does not.
    logger.debug('A newer artifact already holds this slot', { captureId: artifact.captureId });
    return false;
  }

  const composed = composeNote({
    user: { title: context.userTitle, body: context.userBody, checklist: context.userItems },
    live: artifact.stage === 'live' ? artifact : context.artifacts.live,
    final: artifact.stage === 'final' ? artifact : context.artifacts.final,
    overrides: [...context.overrides.values()],
    fallbackTitle: startedAt.toLocaleString(),
  });

  // Both halves of the body, in one write. The store composes them — this pass
  // never assembles a body itself, so it cannot assemble one from a stale half.
  await updateNote(context.note.id, {
    title: composed.title,
    checklist: composed.checklist,
    userBody: context.userBody,
    generatedBody: composed.generatedBody,
  });
  return true;
}

/**
 * Rebuild `noteId`'s provisional note from everything `captureId` has transcribed.
 *
 * Rebuilt from the whole transcript each time rather than appended to: a later
 * slice can settle a question an earlier one raised, and only a pass over
 * everything notices that. The result is then RECONCILED against what is already
 * on screen, so a point that survives keeps its id and its place — replacing the
 * note wholesale is what made a live note reorder under the reader.
 */
export async function restructureNote(
  captureId: string,
  noteId: string,
  startedAt: Date,
  transcriptRevision = 0,
): Promise<void> {
  const context = await readContext(captureId, noteId, startedAt);
  if (!context) return;

  const built = buildDeterministicArtifact({
    noteId,
    captureId,
    segments: context.segments,
    startedAt,
    stage: 'live',
    transcriptRevision,
    now: new Date().toISOString(),
  });

  const reduced = reduceLiveArtifact(context.artifacts.live, built, context.overrides);
  await commit(
    context,
    committed(reduced, { transcriptRevision, now: new Date().toISOString() }),
    startedAt,
  );
}

/**
 * Settle the note, once, with the whole recording in view.
 *
 * The deterministic reading is always produced first and always usable, so every
 * failure below is survivable: no model, no download, a refused reply, a crash —
 * the user still has their note. A model that answers replaces the artifact's
 * contents; one that does not is not an error, it is the floor being enough.
 */
export async function enhanceNote(
  captureId: string,
  noteId: string,
  startedAt: Date,
  language: string,
  transcriptRevision = 0,
): Promise<boolean> {
  const context = await readContext(captureId, noteId, startedAt);
  if (!context) return false;

  const now = new Date().toISOString();
  const deterministic = buildDeterministicArtifact({
    noteId,
    captureId,
    segments: context.segments,
    startedAt,
    stage: 'final',
    transcriptRevision,
    now,
  });

  const settled = finalizeArtifact({
    previous: context.artifacts.live,
    next: deterministic,
    overrides: context.overrides,
    now,
  });
  await commit(context, committed(settled, { transcriptRevision, now }), startedAt);

  const summarizer = getSummarizer();
  if ((await summarizer.availability()) !== 'ready') return false;

  const enhancement = await summarizer.enhance({
    // The model is shown the cleaned, block-grouped transcript rather than
    // whisper's raw segments: the filler and repetitions removed there are
    // tokens a phone's context window would otherwise spend on nothing. Each
    // line carries its segments, so a citation can be resolved to real evidence.
    transcript: cleanedBlocks(context.segments).map((block) => ({
      atMs: block.startMs,
      text: block.text,
      segmentIds: block.segmentIds,
    })),
    // Shown what the USER wrote, never the app's own previous output, or it
    // summarises itself.
    existing: {
      title: context.userTitle,
      body: context.userBody,
      checklist: context.userItems,
    },
    language,
    profile: settled.profile,
    intent: settled.intent,
    // The only thing that lets the model contribute knowledge of its own, and it
    // is whatever the user authorised out loud — usually nothing.
    expansions: settled.pendingExpansions ?? [],
  });
  if (!enhancement) {
    logger.info('The model had nothing to add; keeping the structured note');
    return false;
  }

  const fromModel = enhancementToArtifact({
    enhancement,
    captureId,
    noteId,
    stage: 'final',
    profile: settled.profile,
    intent: settled.intent,
    expansions: settled.pendingExpansions ?? [],
    transcriptRevision,
    now,
    fallbackTitle: deterministic.title?.text ?? startedAt.toLocaleString(),
  });

  const landed = await commit(
    context,
    committed(
      finalizeArtifact({
        previous: settled,
        next: fromModel,
        overrides: context.overrides,
        now,
      }),
      { transcriptRevision, now },
    ),
    startedAt,
  );
  if (landed) logger.info('Note rewritten by the on-device model', { noteId });
  return landed;
}
