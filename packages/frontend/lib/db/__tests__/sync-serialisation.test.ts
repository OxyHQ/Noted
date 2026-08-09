/**
 * That two sync triggers arriving together produce one cycle, not two.
 *
 * This is the bug, not a hypothetical: the store's own timer and the socket's
 * timer were separate, so mounting, foregrounding, reconnecting and a server
 * event could each start a cycle within the same moment. `flushOutbox` reads the
 * ready entries and then sends them, so a second drain starting inside that
 * window sends every one of them a second time — the console filled with
 * `DELETE /notes/… 404` for notes the first drain had just deleted, and two
 * pulls read the same cursor before either wrote it and processed the same 43
 * tombstones each.
 *
 * The network is mocked here; the DATABASE is not what is under test, the
 * overlap is.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.fn();
const executeTransaction = vi.fn();

vi.mock('@/lib/db/client', () => ({
  execute: (...args: unknown[]) => execute(...args),
  executeTransaction: (...args: unknown[]) => executeTransaction(...args),
  isDbAvailable: () => true,
}));

const get = vi.fn();
vi.mock('@/lib/api/client', () => ({
  default: { get: (...args: unknown[]) => get(...args), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/db/labels-repo', () => ({ saveLabels: vi.fn(() => Promise.resolve()) }));

const { syncNotes } = await import('@/lib/db/sync');

/**
 * Hold the outbox's very first read open.
 *
 * That read is what a cycle does before anything else, and the gap between it
 * and the requests it triggers IS the window a second cycle used to start in.
 */
function heldOutboxRead(): { hold: () => Promise<unknown>; release: () => void } {
  let release = (): void => undefined;
  const promise = new Promise<unknown>((settle) => {
    release = () => {
      settle([]);
    };
  });
  return { hold: () => promise, release };
}

/** Two reads per cycle: the outbox's ready entries and the pull cursor. */
const READS_PER_CYCLE = 2;

describe('syncNotes', () => {
  beforeEach(() => {
    execute.mockReset().mockResolvedValue([]);
    executeTransaction.mockReset().mockResolvedValue([]);
    get.mockReset().mockResolvedValue({
      data: { data: [], deleted: [], serverTime: '2026-03-04T10:00:00.000Z' },
    });
  });

  it('does not run a second cycle alongside one already running', async () => {
    const gate = heldOutboxRead();
    execute.mockImplementationOnce(gate.hold).mockResolvedValue([]);

    const running = syncNotes(() => 'conflict-id');
    const overlapping = syncNotes(() => 'conflict-id');

    // One read, not two: the second trigger did not start its own drain. This is
    // the assertion the bug fails — a second drain re-sends every outbox entry
    // the first one is already sending.
    expect(execute).toHaveBeenCalledTimes(1);

    gate.release();
    await Promise.all([running, overlapping]);
  });

  it('runs once more afterwards, so the second trigger is not simply dropped', async () => {
    // The trigger carried information — something changed — and the cycle
    // already running may have read past it.
    const gate = heldOutboxRead();
    execute.mockImplementationOnce(gate.hold).mockResolvedValue([]);

    const running = syncNotes(() => 'conflict-id');
    void syncNotes(() => 'conflict-id');
    gate.release();
    await running;

    expect(execute.mock.calls.length).toBeGreaterThan(READS_PER_CYCLE);
  });

  it('collapses a burst of triggers into a single follow-up', async () => {
    const gate = heldOutboxRead();
    execute.mockImplementationOnce(gate.hold).mockResolvedValue([]);

    const running = syncNotes(() => 'conflict-id');
    for (let index = 0; index < 10; index += 1) void syncNotes(() => 'conflict-id');
    gate.release();
    await running;

    // Two cycles' worth of work, not eleven. Without the collapse a burst of
    // triggers becomes a burst of round trips.
    expect(execute.mock.calls.length).toBeLessThanOrEqual(READS_PER_CYCLE * 2);
  });
});
