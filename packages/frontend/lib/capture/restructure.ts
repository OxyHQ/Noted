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

import { createLogger } from '@oxy.so/core/logger';

import { execute, getActiveViewerId } from '@/lib/db/client';
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
import type { TodoItem } from '@/lib/notes/blocks';
import type { GeneratedNoteArtifact } from '@noted/shared-types';
import { committed } from '@/lib/artifact/artifact';
import { composeNote } from '@/lib/artifact/compose';
import { buildDeterministicArtifact, cleanedBlocks } from '@/lib/artifact/generate/deterministic';
import { enhancementToArtifact } from '@/lib/artifact/generate/from-enhancement';
import { finalizeArtifact } from '@/lib/artifact/finalize';
import { overridesById } from '@/lib/artifact/ownership';
import { reduceLiveArtifact } from '@/lib/artifact/reduce';
import { getSummarizer } from '@/lib/enhance/summarizer';
import type { OnDeviceSummarizer } from '@/lib/enhance/contract';
import { errorCodeOf, NoteProcessingError } from '@/lib/capture/errors';
import type { EnhancementOutcome } from '@/lib/capture/enhancement-outcome';
import { groundingOf, isCheckable } from '@/lib/artifact/grounding';

const logger = createLogger('NotedCapture');

/**
 * Run the model, turning whatever it throws into a stage.
 *
 * A summarizer that knows which stage it failed at says so by throwing a
 * `NoteProcessingError`, and that code is kept. Anything else — an opaque
 * exception from inside a runtime — becomes `model_inference`, because guessing
 * between download, load and generation by matching error TEXT is how a code
 * becomes wrong the next time that library rewords a message.
 */
async function runModel(
  summarizer: OnDeviceSummarizer,
  request: Parameters<OnDeviceSummarizer['enhance']>[0],
): Promise<Awaited<ReturnType<OnDeviceSummarizer['enhance']>>> {
  try {
    return await summarizer.enhance(request);
  } catch (error) {
    throw new NoteProcessingError(errorCodeOf(error, 'model_inference'), error);
  }
}

interface CaptureContext {
  viewerId: string | null;
  note: LocalNote;
  segments: TranscriptSegment[];
  artifacts: NoteArtifacts;
  overrides: ReturnType<typeof overridesById>;
  userBody: string;
  userTitle: string;
  userItems: readonly TodoItem[];
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
  viewerId: string | null,
): Promise<CaptureContext | null> {
  const segments = rowsToSegments(
    await execute<TranscriptSegmentRow>(SEGMENTS_BY_CAPTURE_SQL, [captureId], viewerId),
  );
  if (segments.length === 0) return null;

  const note = await getNote(noteId, viewerId);
  if (!note) {
    logger.debug('Skipped structuring a note that no longer exists', { noteId });
    return null;
  }

  const authored = userAuthoredPart(note, startedAt);
  return {
    viewerId,
    note,
    segments,
    artifacts: await getCaptureArtifacts(captureId, viewerId),
    overrides: overridesById(await getNoteOverrides(noteId, viewerId)),
    // What the app wrote last time is left out: its blocks are known by id
    // (`note.generated`), so the user's are everything else. Without this the
    // model would be shown its own previous output and summarise itself.
    userBody: authored.body,
    userTitle: authored.title,
    userItems: authored.checklist,
  };
}

/** Persist an artifact and the note it composes to, unless something newer won. */
async function commit(
  context: CaptureContext,
  artifact: Parameters<typeof saveArtifact>[0],
  startedAt: Date,
): Promise<boolean> {
  const landed = await saveArtifact(artifact, context.viewerId);
  if (!landed) {
    // An ordinary outcome: a newer revision, or the settled artifact, got there
    // first. Retrying is how a stale pass eventually wins, so it does not.
    logger.debug('A newer artifact already holds this slot', { captureId: artifact.captureId });
    return false;
  }

  const composed = composeNote({
    user: { title: context.userTitle, todos: context.userItems.map((item) => item.text) },
    live: artifact.stage === 'live' ? artifact : context.artifacts.live,
    final: artifact.stage === 'final' ? artifact : context.artifacts.final,
    overrides: [...context.overrides.values()],
    fallbackTitle: startedAt.toLocaleString(),
  });

  // Only the app's own blocks, in one write: the store replaces those it
  // knows are its (`withGenerated`) and nothing the user wrote, against the
  // note as stored, so a stale read here cannot cost anyone their typing.
  await updateNote(
    context.note.id,
    { title: composed.title, rendered: composed.rendered },
    context.viewerId,
  );
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
  expectedViewerId = getActiveViewerId(),
): Promise<void> {
  const context = await readContext(captureId, noteId, startedAt, expectedViewerId);
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
export async function finalizeNote(
  captureId: string,
  noteId: string,
  startedAt: Date,
  transcriptRevision = 0,
  expectedViewerId = getActiveViewerId(),
): Promise<void> {
  const context = await readContext(captureId, noteId, startedAt, expectedViewerId);
  if (!context) return;

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
}

/**
 * Make the settled note better, if this device can.
 *
 * A separate operation from writing it, and separating them is the fix for the
 * loudest bug this file had: a model that could not load reported "Noted could
 * not finish the notes" over a document already on the user's screen. Everything
 * here is optional. The note exists before this runs and still exists if it
 * fails.
 *
 * @returns whether the note actually improved. `false` means this device had
 *   nothing to add — no model, or a model with no opinion — which is a complete
 *   answer rather than a failure.
 */
export async function enhanceNote(
  captureId: string,
  noteId: string,
  startedAt: Date,
  language: string,
  transcriptRevision = 0,
  expectedViewerId = getActiveViewerId(),
): Promise<EnhancementOutcome> {
  const context = await readContext(captureId, noteId, startedAt, expectedViewerId);
  // No capture and no settled artifact are both "there is nothing to improve",
  // which is a state of the WORK rather than of the device — reporting them as
  // unsupported hardware is what this whole outcome type exists to stop.
  if (!context) return { kind: 'stale', currentRevision: transcriptRevision };

  // Read back what was actually persisted rather than rebuilding it. The stored
  // artifact is what the user is looking at; regenerating a second opinion here
  // and improving THAT would show them a note nobody committed.
  const settled = context.artifacts.final;
  if (!settled) return { kind: 'stale', currentRevision: transcriptRevision };

  const now = new Date().toISOString();
  return enhanceWithModel(context, {
    captureId,
    noteId,
    startedAt,
    language,
    transcriptRevision,
    now,
    settled,
    fallbackTitle: settled.title?.text ?? startedAt.toLocaleString(),
  });
}

interface ModelPassInput {
  captureId: string;
  noteId: string;
  startedAt: Date;
  language: string;
  transcriptRevision: number;
  now: string;
  settled: GeneratedNoteArtifact;
  fallbackTitle: string;
}

async function enhanceWithModel(
  context: CaptureContext,
  input: ModelPassInput,
): Promise<EnhancementOutcome> {
  const { captureId, noteId, startedAt, language, transcriptRevision, now, settled } = input;

  const summarizer = getSummarizer();
  const capability = await summarizer.capability();
  if (capability.kind !== 'ready') return { kind: 'unavailable', capability };

  const attempt = await runModel(summarizer, {
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
  if (!attempt.ok) {
    if (attempt.kind === 'unavailable')
      return { kind: 'unavailable', capability: attempt.capability };
    // The model ran and its answer was unusable. That is retryable and it is
    // NOT a statement about the device — which is exactly the confusion the old
    // boolean created.
    // The counts go into the log with the reason, because "every block came
    // back with no source" and "the model cited lines it was never shown" look
    // identical from the outside and need opposite fixes.
    logger.info('The model produced no usable document', {
      reason: attempt.reason,
      ...attempt.diagnostics,
    });
    return { kind: 'invalid-output', reason: attempt.reason };
  }

  const fromModel = enhancementToArtifact({
    enhancement: attempt.value,
    captureId,
    noteId,
    stage: 'final',
    profile: settled.profile,
    intent: settled.intent,
    expansions: settled.pendingExpansions ?? [],
    transcriptRevision,
    now,
    fallbackTitle: input.fallbackTitle,
  });

  // A document nobody can check does not replace fragments they can. Measured:
  // one run produced sixteen fluent paragraphs with not one source between
  // them, and it would have won purely by reading better.
  if (!isCheckable(fromModel)) {
    const grounding = groundingOf(fromModel);
    logger.info('The model document was not checkable; keeping the structured note', {
      units: grounding.units,
      grounded: grounding.grounded,
    });
    return { kind: 'no-change', reason: 'nothing_useful' };
  }

  const enhanced = committed(
    finalizeArtifact({ previous: settled, next: fromModel, overrides: context.overrides, now }),
    { transcriptRevision, now },
  );
  const landed = await commit(context, enhanced, startedAt);
  if (!landed) {
    // A newer artifact won the compare-and-swap. Ordinary superseded work: the
    // user has something at least as fresh, and calling that "unsupported" told
    // them their device had failed at the moment it had actually raced itself.
    return { kind: 'stale', currentRevision: transcriptRevision };
  }

  logger.info('Note rewritten by the on-device model', { noteId, ...attempt.diagnostics });
  return { kind: 'improved', artifactRevision: enhanced.artifactRevision };
}
