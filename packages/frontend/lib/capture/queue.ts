/**
 * One capture, one queue, one worker.
 *
 * Today every transcript callback starts `restructureNote()` with an untracked
 * `void`, so a two-hour meeting ends with dozens of full rebuilds in flight at
 * once, each reading the whole transcript, and whichever finishes last wins —
 * which is not the same as whichever read the most. That is the race behind a
 * live note that goes backwards, and it gets worse the longer somebody talks.
 *
 * The fix is not a mutex around the old code. It is that a revision arriving
 * while work is running should REPLACE the one already waiting rather than join
 * it: nobody wants the note rebuilt for revision 7 once revision 9 exists. So the
 * queue holds exactly one pending revision, keeps the newest, and tells the
 * running task it has been overtaken so it can stop early instead of finishing
 * work whose result will be discarded.
 *
 * Finalisation is a barrier rather than another task. Once it begins, live work
 * is refused for good — the finaliser has read the whole recording, and a live
 * pass landing after it would replace a settled note with a partial one.
 *
 * Deliberately free of SQLite, React and the clock: what makes a queue correct is
 * the order things happen in, and that is only testable if nothing here needs a
 * database to run.
 */

import type { ArtifactStage } from '@noted/shared-types';

/**
 * Told to a running task when it has been overtaken.
 *
 * Advisory: a task that ignores it still cannot commit, because the revision
 * guard in the store refuses the write. Checking it only saves the work.
 */
export interface StaleSignal {
  readonly isStale: boolean;
}

export interface ProcessingTask {
  transcriptRevision: number;
  stage: ArtifactStage;
  stale: StaleSignal;
}

export type Processor = (task: ProcessingTask) => Promise<void>;

export interface QueueOptions {
  process: Processor;
  /** Reported rather than thrown: a failed pass must not stop the next one. */
  onError?: (error: unknown, task: ProcessingTask) => void;
}

export class CaptureProcessingQueue {
  private readonly process: Processor;
  private readonly onError: ((error: unknown, task: ProcessingTask) => void) | undefined;

  /** The one revision waiting. A newer one replaces it; they never accumulate. */
  private pending: number | null = null;
  private running: Promise<void> | null = null;
  private current: { revision: number; stale: boolean } | null = null;
  private closed = false;
  /**
   * That a drain loop is live.
   *
   * Separate from `running`, and it has to be: `running` is null for the instant
   * between one task settling and the loop taking the next revision, and a
   * `submit` landing in that instant would otherwise start a second loop and put
   * two workers on one capture — the exact thing this class exists to prevent.
   */
  private draining = false;

  constructor(options: QueueOptions) {
    this.process = options.process;
    this.onError = options.onError;
  }

  /** Whether finalisation has begun. Live work is refused from that moment. */
  get isClosed(): boolean {
    return this.closed;
  }

  /** Whether a task is running right now. */
  get isBusy(): boolean {
    return this.running !== null;
  }

  /**
   * Ask for the live artifact to be rebuilt at `transcriptRevision`.
   *
   * @returns whether the request was accepted. `false` means finalisation has
   *   started and this revision will be picked up by the finaliser instead.
   */
  submit(transcriptRevision: number): boolean {
    if (this.closed) return false;

    this.pending = Math.max(this.pending ?? transcriptRevision, transcriptRevision);
    // The running task's answer is already out of date. It may as well stop.
    if (this.current && transcriptRevision > this.current.revision) this.current.stale = true;

    if (!this.draining) void this.drain();
    return true;
  }

  /**
   * Close the queue to live work and run the finaliser once.
   *
   * Waits for whatever is running — the tail slice usually lands during stop and
   * it is the one carrying whatever was agreed at the end — then runs the final
   * pass. Anything still pending is dropped rather than run first: the finaliser
   * reads the same transcript and reads all of it.
   */
  async finalize(transcriptRevision: number): Promise<void> {
    this.closed = true;
    this.pending = null;
    if (this.current) this.current.stale = true;

    await this.running;
    await this.run({ transcriptRevision, stage: 'final' });
  }

  /** Resolves when nothing is running and nothing is waiting. */
  async idle(): Promise<void> {
    while (this.running !== null || this.pending !== null) {
      await (this.running ?? Promise.resolve());
    }
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending !== null && !this.closed) {
        const transcriptRevision = this.pending;
        this.pending = null;
        await this.run({ transcriptRevision, stage: 'live' });
      }
    } finally {
      this.draining = false;
    }
  }

  private run(input: { transcriptRevision: number; stage: ArtifactStage }): Promise<void> {
    const state = { revision: input.transcriptRevision, stale: false };
    this.current = state;

    const task: ProcessingTask = {
      transcriptRevision: input.transcriptRevision,
      stage: input.stage,
      stale: {
        get isStale() {
          return state.stale;
        },
      },
    };

    const finished = this.process(task)
      .catch((error: unknown) => {
        this.onError?.(error, task);
        // A live pass that failed is forgotten: the next revision deserves a
        // turn whatever happened to this one, and the note it would have written
        // is provisional anyway.
        //
        // A FAILED FINALISATION IS NOT. It is the difference between "Notes
        // ready" and "the recording is safe, but Noted could not finish the
        // notes", and only the caller can record that — so it is rethrown rather
        // than reported and dropped.
        if (task.stage === 'final') throw error;
      })
      .finally(() => {
        this.current = null;
        this.running = null;
      });

    // Bookkeeping only, and deliberately a different promise: `finished` may
    // reject, and a rejected promise nobody awaits is an unhandled rejection.
    this.running = finished.catch(() => undefined);
    return finished;
  }
}
