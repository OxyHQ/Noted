/**
 * Picking a recording back up after something went wrong.
 *
 * Two different failures, two different repairs, and telling them apart is the
 * point: a transcript that never happened needs the audio read again, while a
 * transcript that is fine and a note that is not needs only the note rewritten —
 * re-transcribing there would be minutes of work to fix something that was never
 * broken.
 *
 * Both are idempotent by construction. The capture's own status is moved first,
 * so a second press while one is running sees work in progress rather than
 * starting a duplicate, and a process that dies half-way leaves a row describing
 * what it was doing.
 */

import { createLogger } from '@oxyhq/core/logger';

import { setCaptureLifecycle, type Capture } from '@/lib/capture/captures-repo';
import { enhanceNote, finalizeNote } from '@/lib/capture/restructure';
import { transcribeAfterStop } from '@/lib/capture/transcribe-after';
import { loadSetting, SETTING_KEYS } from '@/lib/db/settings-repo';
import type { CaptureProfile } from '@noted/shared-types';
import { errorCodeOf } from '@/lib/capture/errors';
import type { CaptureRetry } from '@/lib/capture/status';

const logger = createLogger('NotedCapture');

function isLanguage(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Change how the note is organised and write it again.
 *
 * A profile is a claim about what the recording IS — a class, a stand-up, somebody
 * dictating a list — and the user is the authority on that. Changing it has to
 * rewrite the note, or the setting is a preference that does nothing.
 *
 * The profile is stored BEFORE the pass runs, so the generator reads the user's
 * answer rather than being handed it: a pass that took the profile as an argument
 * would leave the row saying one thing and the note showing another the moment
 * anything else regenerated.
 */
export async function regenerateWithProfile(
  capture: Capture,
  profile: CaptureProfile,
): Promise<void> {
  await setCaptureLifecycle(capture.id, { profile });
  await retryCapture({ ...capture, profile }, 'notes');
}

/**
 * Run the repair the status offered.
 *
 * @returns whether anything was attempted. `false` means there was nothing to
 *   retry, which is what a stale button press looks like.
 */
export async function retryCapture(capture: Capture, what: CaptureRetry): Promise<boolean> {
  if (what === null) return false;
  const startedAt = new Date(capture.startedAt);

  if (what === 'enhancement') {
    // Only the improvement. The note is already written, and re-running the
    // rule-based pass that wrote it costs time and changes nothing.
    await setCaptureLifecycle(capture.id, { enhancement: 'running', errorCode: null });
    const language = await loadSetting(SETTING_KEYS.sttLanguage, isLanguage, 'auto');
    try {
      const improved = await enhanceNote(
        capture.id,
        capture.noteId,
        startedAt,
        language,
        capture.transcriptRevision,
      );
      await setCaptureLifecycle(capture.id, {
        enhancement: improved ? 'complete' : 'unsupported',
        errorCode: null,
      });
    } catch (error) {
      logger.error('The model could not improve the note on retry', { error: String(error) });
      await setCaptureLifecycle(capture.id, {
        enhancement: 'failed',
        errorCode: errorCodeOf(error, 'model_inference'),
      });
    }
    return true;
  }

  if (what === 'transcript') {
    if (capture.audioPath === '') {
      // Nothing to read again. Said out loud rather than silently doing nothing,
      // because a Retry button that does nothing is worse than one that is absent.
      logger.warn('Cannot retry a transcript without audio', { captureId: capture.id });
      return false;
    }
    await setCaptureLifecycle(capture.id, { transcription: 'pending', errorCode: null });
    await transcribeAfterStop({
      captureId: capture.id,
      noteId: capture.noteId,
      audioPath: capture.audioPath,
      startedAt,
    });
    return true;
  }

  // `notes` means there is no note at all — the rule-based pass is what has to
  // run again, and it is the one that must always work.
  await setCaptureLifecycle(capture.id, { generation: 'finalizing', errorCode: null });
  try {
    await finalizeNote(capture.id, capture.noteId, startedAt, capture.transcriptRevision);
    await setCaptureLifecycle(capture.id, { generation: 'complete', errorCode: null });
  } catch (error) {
    logger.error('Could not write the notes on retry', { error: String(error) });
    await setCaptureLifecycle(capture.id, {
      generation: 'failed',
      errorCode: errorCodeOf(error, 'deterministic_generate'),
    });
  }
  return true;
}
