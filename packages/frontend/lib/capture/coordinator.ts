/**
 * One capture, one owner.
 *
 * The two platform recorders were the same product logic written twice, and both
 * copies did the same three things wrong. They started note rebuilds with an
 * untracked `void` on every transcript callback, so nothing bounded how many ran
 * or which one won. They reported `saved` on screen while the stored capture was
 * still `transcribing`, so what the user saw and what recovery believed were
 * different facts. And they awaited the whole model pass inside `stop()`, so
 * pressing stop could sit there while a model loaded — the microphone was already
 * closed and the audio already safe, and the button looked broken anyway.
 *
 * This owns those three. The platform files keep what genuinely differs — opening
 * a microphone, writing a file, starting a foreground service — and hand the
 * events here.
 *
 * ## Stopping is not finishing
 *
 * `stopped()` resolves as soon as the recording is safe: the microphone is
 * released, the audio is written, the row says so. Finalisation runs afterwards
 * and is exposed as {@link finalization} for whoever wants to wait for it — a
 * test, or a screen showing "Organizing notes…". Nothing on the stop path awaits
 * it.
 *
 * ## Ports, not imports
 *
 * The store and the note writers arrive as arguments. Every interesting property
 * of this class is about ORDER — that a stale pass cannot land after a fresh one,
 * that finalisation closes the queue, that a failure still leaves the recording
 * safe — and order is only testable if none of it needs SQLite to run.
 */

import type { CaptureLifecycle } from '@/lib/capture/lifecycle';
import { CaptureProcessingQueue, type ProcessingTask } from '@/lib/capture/queue';

export interface CaptureLifecycleStore {
  setLifecycle(
    captureId: string,
    patch: Partial<CaptureLifecycle> & { errorCode?: string | null },
  ): Promise<unknown>;
  /** @returns the new revision, or null when the capture is gone. */
  bumpTranscriptRevision(captureId: string): Promise<number | null>;
  finish(captureId: string, durationMs: number, audioPath: string): Promise<void>;
  fail(captureId: string, errorCode: string): Promise<void>;
}

export interface CaptureNoteWriters {
  /** Rebuild the provisional note from the transcript so far. */
  live(task: ProcessingTask): Promise<void>;
  /** Read the whole recording once and write the settled note. */
  finalize(task: ProcessingTask): Promise<void>;
}

export interface CoordinatorInput {
  captureId: string;
  noteId: string;
  store: CaptureLifecycleStore;
  writers: CaptureNoteWriters;
  onError?: (stage: string, error: unknown) => void;
}

export class CaptureCoordinator {
  readonly captureId: string;
  readonly noteId: string;

  private readonly store: CaptureLifecycleStore;
  private readonly writers: CaptureNoteWriters;
  private readonly onError: ((stage: string, error: unknown) => void) | undefined;
  private readonly queue: CaptureProcessingQueue;

  /** The newest revision anything has been told about. */
  private revision = 0;
  private finalizing: Promise<void> | null = null;

  constructor(input: CoordinatorInput) {
    this.captureId = input.captureId;
    this.noteId = input.noteId;
    this.store = input.store;
    this.writers = input.writers;
    this.onError = input.onError;
    this.queue = new CaptureProcessingQueue({
      process: (task) => (task.stage === 'final' ? this.writers.finalize(task) : this.writers.live(task)),
      onError: (error, task) => this.onError?.(task.stage, error),
    });
  }

  /** The microphone is open and words are on their way. */
  async markRecording(): Promise<void> {
    await this.store.setLifecycle(this.captureId, {
      capture: 'recording',
      transcription: 'live',
      generation: 'live',
    });
  }

  /**
   * New transcript has landed.
   *
   * The revision is taken from the store rather than counted here, because the
   * store is what every commit is judged against — a number this class invented
   * would be a second opinion about which work is current.
   */
  async transcriptChanged(): Promise<void> {
    const revision = await this.store.bumpTranscriptRevision(this.captureId);
    if (revision === null) return;
    this.revision = revision;
    this.queue.submit(revision);
  }

  /** The stop button was pressed; the microphone is closing. */
  async markStopping(): Promise<void> {
    await this.store.setLifecycle(this.captureId, { capture: 'stopping' });
  }

  /**
   * The microphone is closed and the audio is on disk.
   *
   * Returns once the recording is safe. Finalisation is started, not awaited —
   * see {@link finalization}.
   */
  async markStopped(durationMs: number, audioPath: string): Promise<void> {
    await this.store.finish(this.captureId, durationMs, audioPath);
    await this.store.setLifecycle(this.captureId, { transcription: 'complete' });
    this.beginFinalization();
  }

  /** Something went wrong badly enough that there is no recording to finish. */
  async markFailed(errorCode: string): Promise<void> {
    await this.store.fail(this.captureId, errorCode);
  }

  /**
   * Whatever finalisation is running, or has run.
   *
   * Never rejects: a failed finalisation is a state on the capture, not an
   * exception for the recorder to handle — the audio and the live note are both
   * still there.
   */
  get finalization(): Promise<void> {
    return this.finalizing ?? Promise.resolve();
  }

  /**
   * Run the final pass again.
   *
   * What the "Retry" beside a failed note calls. Idempotent while one is running:
   * asking twice returns the same promise rather than starting a second pass over
   * the same recording.
   */
  retryFinalization(): Promise<void> {
    if (this.finalizing) return this.finalizing;
    this.beginFinalization();
    return this.finalization;
  }

  private beginFinalization(): void {
    if (this.finalizing) return;
    this.finalizing = (async () => {
      try {
        await this.store.setLifecycle(this.captureId, { generation: 'finalizing' });
        await this.queue.finalize(this.revision);
        await this.store.setLifecycle(this.captureId, {
          generation: 'complete',
          errorCode: null,
        });
      } catch (error) {
        this.onError?.('finalize', error);
        await this.store
          .setLifecycle(this.captureId, { generation: 'failed', errorCode: 'finalize' })
          .catch(() => undefined);
      } finally {
        this.finalizing = null;
      }
    })();
  }
}
