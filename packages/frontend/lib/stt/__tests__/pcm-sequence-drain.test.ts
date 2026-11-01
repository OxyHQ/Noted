import { describe, expect, it, vi } from 'vitest';
import { PcmSequenceDrain } from '../pcm-sequence-drain';

describe('experimental PCM sequence drain', () => {
  it('waits for out-of-order events even when the stop marker arrives first', async () => {
    const output: number[] = [];
    const drain = new PcmSequenceDrain('capture-A', 16, (bytes) => output.push(...bytes));
    expect(drain.receive('capture-A', 2, Uint8Array.of(3))).toBe(true);
    const finished = drain.waitForStop(2, 1000);
    expect(drain.receive('capture-A', 0, Uint8Array.of(1))).toBe(true);
    expect(output).toEqual([1]);
    expect(drain.receive('capture-A', 1, Uint8Array.of(2))).toBe(true);
    await expect(finished).resolves.toBeUndefined();
    expect(output).toEqual([1, 2, 3]);
  });

  it('preserves ordering for repeated permutations and stop positions', async () => {
    let seed = 42;
    for (let run = 0; run < 100; run++) {
      const order = Array.from({ length: 32 }, (_, index) => index);
      for (let i = order.length - 1; i > 0; i--) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const j = seed % (i + 1);
        [order[i], order[j]] = [order[j], order[i]];
      }
      const output: number[] = [];
      const drain = new PcmSequenceDrain('A', 32, (bytes) => output.push(...bytes));
      let stopped: Promise<void> | undefined;
      for (let i = 0; i < order.length; i++) {
        if (i === run % 32) stopped = drain.waitForStop(31, 1000);
        expect(drain.receive('A', order[i], Uint8Array.of(order[i]))).toBe(true);
      }
      await expect(stopped).resolves.toBeUndefined();
      expect(output).toEqual(Array.from({ length: 32 }, (_, index) => index));
    }
  });

  it('rejects missing events after the bounded deadline', async () => {
    vi.useFakeTimers();
    try {
      const drain = new PcmSequenceDrain('A', 16, () => {});
      const finished = drain.waitForStop(0, 100);
      const rejection = expect(finished).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(100);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['duplicate', 'wrong operation', 'overflow'] as const)(
    'rejects %s while a stop waits for data',
    async (kind) => {
      const drain = new PcmSequenceDrain('A', 2, () => {});
      const finished = drain.waitForStop(1, 1000);
      expect(drain.receive('A', 1, Uint8Array.of(1))).toBe(true);
      if (kind === 'duplicate') drain.receive('A', 1, Uint8Array.of(1));
      if (kind === 'wrong operation') drain.receive('B', 0, Uint8Array.of(1));
      if (kind === 'overflow') drain.receive('A', 0, Uint8Array.of(1, 2));
      await expect(finished).rejects.toThrow('PCM event');
    },
  );

  it('rejects a marker preceding already delivered or buffered events', async () => {
    const sent = new PcmSequenceDrain('A', 16, () => {});
    sent.receive('A', 0, Uint8Array.of(1));
    await expect(sent.waitForStop(-1, 1000)).rejects.toThrow('precedes');
    const buffered = new PcmSequenceDrain('A', 16, () => {});
    buffered.receive('A', 2, Uint8Array.of(1));
    await expect(buffered.waitForStop(1, 1000)).rejects.toThrow('precedes');
  });

  it('refuses events after an empty stream has already drained', async () => {
    const delivered: number[] = [];
    const drain = new PcmSequenceDrain('A', 16, (bytes) => delivered.push(...bytes));
    await expect(drain.waitForStop(-1, 1000)).resolves.toBeUndefined();
    expect(drain.receive('A', 0, Uint8Array.of(1))).toBe(false);
    expect(delivered).toEqual([]);
  });

  it('propagates delivery errors and rejects duplicate stop markers', async () => {
    const drain = new PcmSequenceDrain('A', 16, () => {
      throw new Error('sink failed');
    });
    const finished = drain.waitForStop(0, 1000);
    drain.receive('A', 0, Uint8Array.of(1));
    await expect(finished).rejects.toThrow('sink failed');
    await expect(drain.waitForStop(0, 1000)).rejects.toThrow('Invalid PCM stop marker');
  });

  it('rejects a duplicate event re-entering from the delivery callback', async () => {
    let drain: PcmSequenceDrain;
    drain = new PcmSequenceDrain('A', 16, () => {
      expect(drain.receive('A', 0, Uint8Array.of(1))).toBe(false);
    });
    const finished = drain.waitForStop(0, 1000);
    expect(drain.receive('A', 0, Uint8Array.of(1))).toBe(false);
    await expect(finished).rejects.toThrow('PCM event');
  });
});
