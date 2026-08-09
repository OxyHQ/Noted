/**
 * Starting a recording.
 *
 * One place, because starting is more than opening a microphone: a recording
 * needs a note to belong to before it produces anything, and that note has to
 * exist locally so it survives a process that dies mid-meeting.
 */

import { useCallback } from 'react';
import { toast } from '@oxyhq/bloom/toast';
import { createLogger } from '@oxyhq/core/logger';

import { createNote } from '@/lib/db/notes-repo';
import { newNoteId } from '@/lib/db/ids';
import { placeholderTitle } from '@/lib/capture/placeholder-title';
import { isCaptureSupported } from '@/lib/capture/support';
import { useCaptureStore } from '@/lib/stores/capture-store';
import { useTranslation } from '@/hooks/useTranslation';

const logger = createLogger('NotedCapture');

export function useStartCapture(): {
  start: () => Promise<void>;
  isRecording: boolean;
  /** False where the platform cannot record; the control should not be offered. */
  isSupported: boolean;
} {
  const captureId = useCaptureStore((s) => s.captureId);
  const startCapture = useCaptureStore((s) => s.startCapture);
  const { t } = useTranslation();

  const start = useCallback(async () => {
    // One recorder at a time: a second would fight the first for the microphone
    // and neither recording would be complete.
    if (captureId !== null) return;

    try {
      const noteId = newNoteId();
      // A capture is not a note: one note can hold several recordings, so they
      // get separate ids rather than sharing one.
      const captureIdForNote = newNoteId();

      // Titled with the moment it started, because that is the only thing known
      // about a meeting before anyone speaks. It is a PLACEHOLDER, and
      // `placeholder-title` is what lets the structurer and the model recognise
      // it as one and replace it — a title they cannot tell from the user's is a
      // title they will never touch.
      await createNote(noteId, {
        kind: 'voice',
        title: placeholderTitle(new Date()),
      });
      startCapture(captureIdForNote, noteId);
    } catch (error) {
      logger.error('Could not start a capture', { error: String(error) });
      toast.error(t('capture.failed'));
    }
  }, [captureId, startCapture, t]);

  return { start, isRecording: captureId !== null, isSupported: isCaptureSupported() };
}
