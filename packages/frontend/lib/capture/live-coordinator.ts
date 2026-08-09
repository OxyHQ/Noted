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
import { enhanceNote, restructureNote } from '@/lib/capture/restructure';

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
      live: () => restructureNote(captureId, noteId, startedAt),
      finalize: async () => {
        await restructureNote(captureId, noteId, startedAt);
        // The model reads the whole recording once, here. Its failure is not the
        // capture's failure — the structured note is already written — so it is
        // swallowed rather than allowed to mark the note unfinished.
        await enhanceNote(captureId, noteId, startedAt, input.language).catch(
          (error: unknown) => {
            logger.error('Could not enhance the note', { error: String(error) });
          },
        );
      },
    },
    onError: (stage, error) => {
      logger.error('Capture processing failed', { stage, error: String(error) });
    },
  });
}
