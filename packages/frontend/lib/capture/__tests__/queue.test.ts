import { describe, expect, it, vi } from 'vitest';

import { CaptureProcessingQueue, type ProcessingTask } from '@/lib/capture/queue';

/** A promise somebody else resolves, so a test can decide when work finishes. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = () => settle();
  });
  return { promise, resolve };
}

/** Let every already-resolved microtask run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

describe('one worker', () => {
  it('never runs two passes at once', async () => {
    // The bug: `void restructureNote(...)` on every transcript callback, so a
    // long meeting had dozens of full rebuilds in flight and the slowest won.
    let running = 0;
    let concurrent = 0;
    const gate = deferred();

    const queue = new CaptureProcessingQueue({
      process: async () => {
        running += 1;
        concurrent = Math.max(concurrent, running);
        await gate.promise;
        running -= 1;
      },
    });

    queue.submit(1);
    queue.submit(2);
    queue.submit(3);
    await settle();
    expect(concurrent).toBe(1);

    gate.resolve();
    await queue.idle();
    expect(concurrent).toBe(1);
  });
});

describe('coalescing', () => {
  it('keeps the newest revision and drops the ones it overtook', async () => {
    // Nobody wants the note rebuilt for revision 7 once revision 9 exists.
    const seen: number[] = [];
    const gate = deferred();
    const queue = new CaptureProcessingQueue({
      process: async (task) => {
        seen.push(task.transcriptRevision);
        if (seen.length === 1) await gate.promise;
      },
    });

    queue.submit(1);
    await settle();
    queue.submit(2);
    queue.submit(3);
    queue.submit(4);

    gate.resolve();
    await queue.idle();
    expect(seen).toEqual([1, 4]);
  });

  it('does not go backwards when an older revision is submitted late', async () => {
    const seen: number[] = [];
    const gate = deferred();
    const queue = new CaptureProcessingQueue({
      process: async (task) => {
        seen.push(task.transcriptRevision);
        if (seen.length === 1) await gate.promise;
      },
    });

    queue.submit(5);
    await settle();
    queue.submit(9);
    queue.submit(7);

    gate.resolve();
    await queue.idle();
    expect(seen).toEqual([5, 9]);
  });
});

describe('the stale signal', () => {
  it('tells a running pass it has been overtaken', async () => {
    // Advisory — the store's revision guard would refuse the write anyway. This
    // only saves a two-hour transcript being rebuilt for an answer nobody wants.
    const gate = deferred();
    const observed: { task?: ProcessingTask } = {};
    const queue = new CaptureProcessingQueue({
      process: async (task) => {
        observed.task = task;
        await gate.promise;
      },
    });

    queue.submit(1);
    await settle();
    expect(observed.task?.stale.isStale).toBe(false);

    queue.submit(2);
    expect(observed.task?.stale.isStale).toBe(true);

    gate.resolve();
    await queue.idle();
  });

  it('does not call a pass stale because an equal revision arrived', async () => {
    const gate = deferred();
    const observed: { task?: ProcessingTask } = {};
    const queue = new CaptureProcessingQueue({
      process: async (task) => {
        observed.task = task;
        await gate.promise;
      },
    });

    queue.submit(3);
    await settle();
    queue.submit(3);
    expect(observed.task?.stale.isStale).toBe(false);

    gate.resolve();
    await queue.idle();
  });
});

describe('the finalisation barrier', () => {
  it('waits for the running pass, then runs the finaliser', async () => {
    // The tail slice usually lands during stop, and it is the one carrying
    // whatever was agreed at the end of the meeting.
    const order: string[] = [];
    const gate = deferred();
    const queue = new CaptureProcessingQueue({
      process: async (task) => {
        order.push(`${task.stage}:${String(task.transcriptRevision)}`);
        if (task.stage === 'live') await gate.promise;
      },
    });

    queue.submit(1);
    await settle();
    const finalized = queue.finalize(2);
    gate.resolve();
    await finalized;

    expect(order).toEqual(['live:1', 'final:2']);
  });

  it('drops live work that was still waiting', async () => {
    const order: string[] = [];
    const gate = deferred();
    const queue = new CaptureProcessingQueue({
      process: async (task) => {
        order.push(task.stage);
        if (task.stage === 'live' && order.length === 1) await gate.promise;
      },
    });

    queue.submit(1);
    await settle();
    queue.submit(2);
    const finalized = queue.finalize(3);
    gate.resolve();
    await finalized;

    // Revision 2 is never rebuilt on its own: the finaliser reads the same
    // transcript and reads all of it.
    expect(order).toEqual(['live', 'final']);
  });

  it('refuses live work for good once finalisation has begun', async () => {
    const stages: string[] = [];
    const queue = new CaptureProcessingQueue({
      process: async (task) => {
        stages.push(task.stage);
      },
    });

    await queue.finalize(1);
    expect(queue.isClosed).toBe(true);
    expect(queue.submit(2)).toBe(false);
    await queue.idle();

    // A live pass landing after finalisation would replace a settled note with
    // a partial one.
    expect(stages).toEqual(['final']);
  });

  it('marks whatever is running as stale the moment it is called', async () => {
    const gate = deferred();
    const observed: { task?: ProcessingTask } = {};
    const queue = new CaptureProcessingQueue({
      process: async (task) => {
        if (task.stage === 'live') {
          observed.task = task;
          await gate.promise;
        }
      },
    });

    queue.submit(1);
    await settle();
    const finalized = queue.finalize(1);
    expect(observed.task?.stale.isStale).toBe(true);
    gate.resolve();
    await finalized;
  });
});

describe('failures', () => {
  it('reports a failed pass and still runs the next revision', async () => {
    // A queue that stops on the first error is a note that stops updating for
    // the rest of the meeting.
    const onError = vi.fn();
    const seen: number[] = [];
    const queue = new CaptureProcessingQueue({
      process: async (task) => {
        seen.push(task.transcriptRevision);
        if (task.transcriptRevision === 1) throw new Error('boom');
      },
      onError,
    });

    queue.submit(1);
    await settle();
    queue.submit(2);
    await queue.idle();

    expect(seen).toEqual([1, 2]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1]).toMatchObject({ transcriptRevision: 1, stage: 'live' });
  });

  it('lets a failed finalisation reject, unlike a failed live pass', async () => {
    // The asymmetry is the point. A live pass that failed is forgotten — the
    // note it would have written was provisional. A failed finalisation is the
    // difference between "Notes ready" and "the recording is safe, but Noted
    // could not finish the notes", and only the caller can record that.
    const onError = vi.fn();
    const queue = new CaptureProcessingQueue({
      process: async (task) => {
        if (task.stage === 'final') throw new Error('no model');
      },
      onError,
    });
    await expect(queue.finalize(1)).rejects.toThrow('no model');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('does not leave a rejected finalisation unhandled behind it', async () => {
    // `running` is separate bookkeeping precisely so nothing awaits a promise
    // that rejects without a handler.
    const queue = new CaptureProcessingQueue({
      process: () => Promise.reject(new Error('no model')),
    });
    await expect(queue.finalize(1)).rejects.toThrow('no model');
    await expect(queue.idle()).resolves.toBeUndefined();
  });
});

describe('idle', () => {
  it('resolves only once nothing is running and nothing is waiting', async () => {
    let finished = 0;
    const gate = deferred();
    const queue = new CaptureProcessingQueue({
      process: async () => {
        await gate.promise;
        finished += 1;
      },
    });

    queue.submit(1);
    await settle();
    queue.submit(2);
    gate.resolve();
    await queue.idle();
    expect(finished).toBe(2);
    expect(queue.isBusy).toBe(false);
  });
});
