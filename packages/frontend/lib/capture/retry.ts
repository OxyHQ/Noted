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
import { enhanceNote } from '@/lib/capture/restructure';
import { transcribeAfterStop } from '@/lib/capture/transcribe-after';
import { loadSetting, SETTING_KEYS } from '@/lib/db/settings-repo';
import type { CaptureRetry } from '@/lib/capture/status';

const logger = createLogger('NotedCapture');

function isLanguage(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
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

  await setCaptureLifecycle(capture.id, { generation: 'finalizing', errorCode: null });
  const language = await loadSetting(SETTING_KEYS.sttLanguage, isLanguage, 'auto');
  try {
    await enhanceNote(capture.id, capture.noteId, startedAt, language, capture.transcriptRevision);
    await setCaptureLifecycle(capture.id, { generation: 'complete', errorCode: null });
  } catch (error) {
    logger.error('Could not finish the notes on retry', { error: String(error) });
    await setCaptureLifecycle(capture.id, { generation: 'failed', errorCode: 'finalize' });
  }
  return true;
}
