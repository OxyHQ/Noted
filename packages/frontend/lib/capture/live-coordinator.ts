/**
 * The coordinator, plugged into this app's store and note writers.
 *
 * `lib/capture/coordinator.ts` is deliberately ignorant of SQLite so its ordering
 * can be tested in node. This is the other half: the two-line adapter that gives
 * it the real store and the real writers, in one place rather than once per
 * platform recorder — the duplication between those two files is what let them
 * drift apart in the first place.
 */

import { getActiveViewerId } from '@/lib/db/client';
import { createLogger } from '@oxy.so/core/logger';

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
  expectedViewerId?: string | null;
  captureId: string;
  noteId: string;
  startedAt: Date;
  language: string;
}): CaptureCoordinator {
  const { captureId, noteId, startedAt, expectedViewerId = getActiveViewerId() } = input;

  return new CaptureCoordinator({
    captureId,
    noteId,
    store: {
      setLifecycle: (id, patch) => setCaptureLifecycle(id, patch, expectedViewerId),
      bumpTranscriptRevision: (id) => bumpTranscriptRevision(id, expectedViewerId),
      finish: (id, duration, path) => finishCapture(id, duration, path, expectedViewerId),
      fail: (id, error) => failCapture(id, error, expectedViewerId),
    },
    writers: {
      // The deterministic pass. It is the floor: it runs everywhere, needs
      // nothing downloaded, and is what makes every failure below survivable.
      // The task's revision travels with it, because that is what the store's
      // guard compares against when it decides whether this pass may still land.
      live: (task) => restructureNote(captureId, noteId, startedAt, task.transcriptRevision, expectedViewerId),
      // The note that always exists. Its failure is a real failure.
      finalize: (task) => finalizeNote(captureId, noteId, startedAt, task.transcriptRevision, expectedViewerId),
      // The improvement. Its failure leaves the note above standing.
      enhance: (task) =>
        enhanceNote(captureId, noteId, startedAt, input.language, task.transcriptRevision, expectedViewerId),
    },
    onError: (stage, error) => {
      logger.error('Capture processing failed', { stage, error: String(error) });
    },
  });
}
