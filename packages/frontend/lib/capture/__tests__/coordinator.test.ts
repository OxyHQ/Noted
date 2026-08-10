import { describe, expect, it, vi } from 'vitest';

import { CaptureCoordinator, type CaptureLifecycleStore } from '@/lib/capture/coordinator';
import {
  canTransitionCapture,
  canTransitionGeneration,
  canTransitionTranscription,
  type CaptureLifecycle,
} from '@/lib/capture/lifecycle';
import type { ProcessingTask } from '@/lib/capture/queue';
import { NoteProcessingError } from '@/lib/capture/errors';
import { captureStatus } from '@/lib/capture/status';

const CAPTURE_ID = 'cap_1';
const NOTE_ID = 'note_1';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = () => settle();
  });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

/**
 * A store that remembers what it was told.
 *
 * The point of the ports: the coordinator's whole job is the ORDER of these
 * calls, and order is only testable if none of it needs SQLite to run.
 */
class FakeStore implements CaptureLifecycleStore {
  lifecycle: CaptureLifecycle = {
    capture: 'starting',
    transcription: 'idle',
    generation: 'idle',
    enhancement: 'pending',
  };
  readonly history: CaptureLifecycle[] = [{ ...this.lifecycle }];
  readonly calls: string[] = [];
  revision = 0;
  errorCode: string | null = null;
  finished: { durationMs: number; audioPath: string } | null = null;

  setLifecycle(
    _captureId: string,
    patch: Partial<CaptureLifecycle> & { errorCode?: string | null },
  ): Promise<unknown> {
    const { errorCode, ...statuses } = patch;
    this.lifecycle = { ...this.lifecycle, ...statuses };
    if (errorCode !== undefined) this.errorCode = errorCode;
    this.history.push({ ...this.lifecycle });
    this.calls.push('setLifecycle');
    return Promise.resolve(this.lifecycle);
  }

  bumpTranscriptRevision(): Promise<number | null> {
    this.revision += 1;
    this.calls.push('bump');
    return Promise.resolve(this.revision);
  }

  finish(_captureId: string, durationMs: number, audioPath: string): Promise<void> {
    this.finished = { durationMs, audioPath };
    this.lifecycle = { ...this.lifecycle, capture: 'stopped' };
    this.history.push({ ...this.lifecycle });
    this.calls.push('finish');
    return Promise.resolve();
  }

  fail(_captureId: string, errorCode: string): Promise<void> {
    this.errorCode = errorCode;
    this.lifecycle = { ...this.lifecycle, capture: 'failed' };
    this.history.push({ ...this.lifecycle });
    this.calls.push('fail');
    return Promise.resolve();
  }
}

function build(
  writers: Partial<{
    live: (task: ProcessingTask) => Promise<void>;
    finalize: (task: ProcessingTask) => Promise<void>;
    enhance: (task: ProcessingTask) => Promise<boolean>;
  }> = {},
): { coordinator: CaptureCoordinator; store: FakeStore; onError: ReturnType<typeof vi.fn> } {
  const store = new FakeStore();
  const onError = vi.fn();
  const coordinator = new CaptureCoordinator({
    captureId: CAPTURE_ID,
    noteId: NOTE_ID,
    store,
    writers: {
      live: writers.live ?? (() => Promise.resolve()),
      finalize: writers.finalize ?? (() => Promise.resolve()),
      enhance: writers.enhance ?? (() => Promise.resolve(true)),
    },
    onError,
  });
  return { coordinator, store, onError };
}

describe('stopping is not finishing', () => {
  it('returns as soon as the recording is safe, without waiting for the model', async () => {
    // The reported symptom: pressing stop appeared to hang. The microphone was
    // already closed and the audio already written; the button was waiting for a
    // model to load.
    const model = deferred();
    let finalized = false;
    const { coordinator, store } = build({
      finalize: async () => {
        await model.promise;
        finalized = true;
      },
    });

    await coordinator.markRecording();
    await coordinator.markStopped(61_000, 'captures/cap_1/audio.wav');

    expect(store.finished).toEqual({ durationMs: 61_000, audioPath: 'captures/cap_1/audio.wav' });
    expect(store.lifecycle.capture).toBe('stopped');
    expect(finalized).toBe(false);

    model.resolve();
    await coordinator.finalization;
    expect(finalized).toBe(true);
    expect(store.lifecycle.generation).toBe('complete');
  });

  it('says it is organising the notes before it starts', async () => {
    // What "Finalizing transcript… / Organizing notes…" is read from. Without
    // it the UI has to guess between "working" and "finished".
    const model = deferred();
    const { coordinator, store } = build({ finalize: () => model.promise });

    await coordinator.markRecording();
    await coordinator.markStopped(1_000, 'a.wav');
    await settle();
    expect(store.lifecycle.generation).toBe('finalizing');

    model.resolve();
    await coordinator.finalization;
  });
});

describe('the lifecycle it emits', () => {
  it('only ever makes legal moves', async () => {
    // The transition tables are written down in `lifecycle.ts` and would
    // otherwise be documentation. This is what gives them teeth: a coordinator
    // that jumped straight to `complete`, or reopened a stopped microphone,
    // fails here.
    const { coordinator, store } = build();
    await coordinator.markRecording();
    await coordinator.markStopping();
    await coordinator.markStopped(1_000, 'a.wav');
    await coordinator.finalization;

    expect(store.history.length).toBeGreaterThan(3);
    for (let index = 1; index < store.history.length; index += 1) {
      const from = store.history[index - 1];
      const to = store.history[index];
      expect(canTransitionCapture(from.capture, to.capture), `capture ${from.capture} → ${to.capture}`).toBe(true);
      expect(
        canTransitionTranscription(from.transcription, to.transcription),
        `transcription ${from.transcription} → ${to.transcription}`,
      ).toBe(true);
      expect(
        canTransitionGeneration(from.generation, to.generation),
        `generation ${from.generation} → ${to.generation}`,
      ).toBe(true);
    }
  });

  it('ends with the transcript and the note both settled', async () => {
    const { coordinator, store } = build();
    await coordinator.markRecording();
    await coordinator.markStopped(1_000, 'a.wav');
    await coordinator.finalization;
    expect(store.lifecycle).toEqual({
      capture: 'stopped',
      transcription: 'complete',
      generation: 'complete',
      enhancement: 'complete',
    });
  });
});

describe('transcript revisions', () => {
  it('takes the revision from the store rather than counting its own', async () => {
    // A number the coordinator invented would be a second opinion about which
    // work is current, and the store is what every commit is judged against.
    const seen: number[] = [];
    const { coordinator, store } = build({
      live: (task) => {
        seen.push(task.transcriptRevision);
        return Promise.resolve();
      },
    });

    await coordinator.transcriptChanged();
    await settle();
    await coordinator.transcriptChanged();
    await settle();

    expect(seen).toEqual([1, 2]);
    expect(store.revision).toBe(2);
  });

  it('does nothing for a capture that no longer exists', async () => {
    // The note was deleted while its recording was running. Nothing to write to,
    // and nothing wrong.
    const live = vi.fn(() => Promise.resolve());
    const store = new FakeStore();
    store.bumpTranscriptRevision = () => Promise.resolve(null);
    const coordinator = new CaptureCoordinator({
      captureId: CAPTURE_ID,
      noteId: NOTE_ID,
      store,
      writers: {
        live,
        finalize: () => Promise.resolve(),
        enhance: () => Promise.resolve(true),
      },
    });

    await coordinator.transcriptChanged();
    await settle();
    expect(live).not.toHaveBeenCalled();
  });

  it('finalises at the newest revision it was told about', async () => {
    let finalRevision = -1;
    const { coordinator } = build({
      finalize: (task) => {
        finalRevision = task.transcriptRevision;
        return Promise.resolve();
      },
    });

    await coordinator.transcriptChanged();
    await coordinator.transcriptChanged();
    await coordinator.transcriptChanged();
    await coordinator.markStopped(1_000, 'a.wav');
    await coordinator.finalization;
    expect(finalRevision).toBe(3);
  });

  it('refuses live work submitted after finalisation started', async () => {
    const model = deferred();
    const live = vi.fn(() => Promise.resolve());
    const { coordinator } = build({ live, finalize: () => model.promise });

    await coordinator.markStopped(1_000, 'a.wav');
    await settle();
    await coordinator.transcriptChanged();
    model.resolve();
    await coordinator.finalization;

    // A late slice does not get its own live rebuild on top of the settled note.
    expect(live).not.toHaveBeenCalled();
  });
});

describe('failure', () => {
  it('leaves the recording safe and the note retryable', async () => {
    // "The recording is safe, but Noted could not finish the notes" is only
    // honest if the capture status says so.
    const { coordinator, store, onError } = build({
      finalize: () => Promise.reject(new Error('no model')),
    });

    await coordinator.markStopped(1_000, 'a.wav');
    await coordinator.finalization;

    expect(store.lifecycle.capture).toBe('stopped');
    expect(store.lifecycle.generation).toBe('failed');
    // The stage, not one word for eight different failures.
    expect(store.errorCode).toBe('deterministic_generate');
    expect(onError).toHaveBeenCalled();
  });

  it('records why a capture that never recorded failed', async () => {
    const { coordinator, store } = build();
    await coordinator.markFailed('permission');
    expect(store.lifecycle.capture).toBe('failed');
    expect(store.errorCode).toBe('permission');
  });
});

describe('retry', () => {
  it('does not start a second pass over the same recording', async () => {
    const model = deferred();
    const finalize = vi.fn(() => model.promise);
    const { coordinator } = build({ finalize });

    await coordinator.markStopped(1_000, 'a.wav');
    await settle();
    const again = coordinator.retryFinalization();
    expect(finalize).toHaveBeenCalledTimes(1);

    model.resolve();
    await again;
  });

  it('runs again once the first attempt is over', async () => {
    let attempts = 0;
    const { coordinator, store } = build({
      finalize: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error('no model')) : Promise.resolve();
      },
    });

    await coordinator.markStopped(1_000, 'a.wav');
    await coordinator.finalization;
    expect(store.lifecycle.generation).toBe('failed');

    await coordinator.retryFinalization();
    expect(attempts).toBe(2);
    expect(store.lifecycle.generation).toBe('complete');
    expect(store.errorCode).toBeNull();
  });
});

describe('a note that exists and an improvement that failed', () => {
  // The reported bug, as behaviour. The user recorded a talk, the note was
  // written, the model died compiling a shader — and the app said "Noted could
  // not finish the notes" about a document on their screen.
  it('keeps the note complete and reports only the enhancement as failed', async () => {
    const { coordinator, store } = build({
      enhance: () => Promise.reject(new Error('shader has no f16')),
    });

    await coordinator.markStopped(1_000, 'a.wav');
    await coordinator.finalization;

    expect(store.lifecycle.generation).toBe('complete');
    expect(store.lifecycle.enhancement).toBe('failed');
    expect(captureStatus(store.lifecycle).kind).toBe('enhancementFailed');
    expect(captureStatus(store.lifecycle).retry).toBe('enhancement');
  });

  it('records which stage failed, so a retry can act on it', async () => {
    const { store, coordinator } = build({
      enhance: () => Promise.reject(new NoteProcessingError('model_load')),
    });
    await coordinator.markStopped(1_000, 'a.wav');
    await coordinator.finalization;
    expect(store.errorCode).toBe('model_load');
  });

  it('retries only the improvement, leaving the note alone', async () => {
    const finalize = vi.fn(() => Promise.resolve());
    let attempts = 0;
    const { coordinator, store } = build({
      finalize,
      enhance: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error('no model')) : Promise.resolve(true);
      },
    });

    await coordinator.markStopped(1_000, 'a.wav');
    await coordinator.finalization;
    expect(store.lifecycle.enhancement).toBe('failed');

    await coordinator.retryEnhancement();
    expect(attempts).toBe(2);
    expect(store.lifecycle.enhancement).toBe('complete');
    // Re-running a rule-based pass that already succeeded costs time and changes
    // nothing.
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it('calls a device with nothing to add unsupported, not failed', async () => {
    // No model here is not a broken note. It is this device saying the baseline
    // is the final answer.
    const { coordinator, store } = build({ enhance: () => Promise.resolve(false) });
    await coordinator.markStopped(1_000, 'a.wav');
    await coordinator.finalization;
    expect(store.lifecycle.enhancement).toBe('unsupported');
    expect(captureStatus(store.lifecycle).kind).toBe('basicReady');
    expect(captureStatus(store.lifecycle).retry).toBeNull();
  });
});

describe('a note that does not exist', () => {
  it('is the only thing that reports the notes as failed', async () => {
    const enhance = vi.fn(() => Promise.resolve(true));
    const { coordinator, store } = build({
      finalize: () => Promise.reject(new NoteProcessingError('artifact_persist')),
      enhance,
    });

    await coordinator.markStopped(1_000, 'a.wav');
    await coordinator.finalization;

    expect(store.lifecycle.generation).toBe('failed');
    expect(store.errorCode).toBe('artifact_persist');
    expect(captureStatus(store.lifecycle).kind).toBe('notesFailed');
    // Nothing to improve. Running the model would replace one failure with a
    // more confusing one.
    expect(enhance).not.toHaveBeenCalled();
  });
});
