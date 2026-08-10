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
import { errorCodeOf } from '@/lib/capture/errors';

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
  /**
   * Write the note that always exists.
   *
   * The rule-based pass. It needs nothing downloaded and cannot be refused by a
   * model, so its failure is a real failure: there is no note.
   */
  finalize(task: ProcessingTask): Promise<void>;
  /**
   * Make that note better, if this device can.
   *
   * Optional by construction. Its failure leaves the note from `finalize`
   * standing, which is why it is a separate call rather than the tail of one —
   * conflated, a model that could not load reported that the notes could not be
   * finished, over a document already on screen.
   *
   * @returns whether anything improved. `false` is an ordinary outcome.
   */
  enhance(task: ProcessingTask): Promise<boolean>;
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

  /**
   * Write the note, then try to improve it.
   *
   * Two stages with two outcomes, and keeping them apart is the whole reason this
   * method is not one `try`. The baseline either produced a note or it did not;
   * the enhancement is an improvement that may not be available on this device
   * and must never make a finished note look lost.
   */
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
          .setLifecycle(this.captureId, {
            generation: 'failed',
            errorCode: errorCodeOf(error, 'deterministic_generate'),
          })
          .catch(() => undefined);
        // No note exists. There is nothing to improve, and running the model
        // would only replace one failure with a more confusing one.
        this.finalizing = null;
        return;
      }

      await this.runEnhancement();
      this.finalizing = null;
    })();
  }

  /**
   * The optional pass.
   *
   * Never rethrows. Every outcome it can have — improved, nothing to add, no
   * model on this device, a model that broke — is a state on the capture, and the
   * note is already written in all four.
   */
  private async runEnhancement(): Promise<void> {
    const task: ProcessingTask = {
      transcriptRevision: this.revision,
      stage: 'final',
      stale: { isStale: false },
    };
    try {
      await this.store.setLifecycle(this.captureId, { enhancement: 'running' });
      const improved = await this.writers.enhance(task);
      await this.store.setLifecycle(this.captureId, {
        // Nothing to add is not a failure and not an improvement. It is this
        // device saying the baseline note is the final answer.
        enhancement: improved ? 'complete' : 'unsupported',
        errorCode: null,
      });
    } catch (error) {
      this.onError?.('enhance', error);
      await this.store
        .setLifecycle(this.captureId, {
          enhancement: 'failed',
          errorCode: errorCodeOf(error, 'model_inference'),
        })
        .catch(() => undefined);
    }
  }

  /**
   * Try the improvement again, without redoing the note.
   *
   * What "Retry enhancement" calls. The baseline note is untouched, which is the
   * point: re-running a rule-based pass that already succeeded costs time and
   * changes nothing.
   */
  async retryEnhancement(): Promise<void> {
    if (this.finalizing) {
      await this.finalizing;
      return;
    }
    this.finalizing = this.runEnhancement().finally(() => {
      this.finalizing = null;
    });
    await this.finalizing;
  }
}
