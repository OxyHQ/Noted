/**
 * The coordinator, plugged into this app's store and note writers.
 *
 * `lib/capture/coordinator.ts` is deliberately ignorant of SQLite so its ordering
 * can be tested in node. This is the other half: the two-line adapter that gives
 * it the real store and the real writers, in one place rather than once per
 * platform recorder — the duplication between those two files is what let them
 * drift apart in the first place.
 */

import { createLogger } from '@oxyhq/core/logger';

import {
  bumpTranscriptRevision,
  failCapture,
  finishCapture,
  setCaptureLifecycle,
} from '@/lib/capture/captures-repo';
import { CaptureCoordinator } from '@/lib/capture/coordinator';
import { enhanceNote, finalizeNote, restructureNote } from '@/lib/capture/restructure';

const logger = createLogger('NotedCapture');

export function createLiveCoordinator(input: {
  captureId: string;
  noteId: string;
  startedAt: Date;
  language: string;
}): CaptureCoordinator {
  const { captureId, noteId, startedAt } = input;

  return new CaptureCoordinator({
    captureId,
    noteId,
    store: {
      setLifecycle: (id, patch) => setCaptureLifecycle(id, patch),
      bumpTranscriptRevision,
      finish: finishCapture,
      fail: failCapture,
    },
    writers: {
      // The deterministic pass. It is the floor: it runs everywhere, needs
      // nothing downloaded, and is what makes every failure below survivable.
      // The task's revision travels with it, because that is what the store's
      // guard compares against when it decides whether this pass may still land.
      live: (task) => restructureNote(captureId, noteId, startedAt, task.transcriptRevision),
      // The note that always exists. Its failure is a real failure.
      finalize: (task) => finalizeNote(captureId, noteId, startedAt, task.transcriptRevision),
      // The improvement. Its failure leaves the note above standing.
      enhance: (task) =>
        enhanceNote(captureId, noteId, startedAt, input.language, task.transcriptRevision),
    },
    onError: (stage, error) => {
      logger.error('Capture processing failed', { stage, error: String(error) });
    },
  });
}
