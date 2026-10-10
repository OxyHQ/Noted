import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLockManager, deferred } from './browser-lock-fixture';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
const state = vi.hoisted(() => ({ viewer: 'alice', execute: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/db/client', () => ({
  execute: state.execute,
  executeTransaction: vi.fn().mockResolvedValue([]),
  getActiveViewerId: () => state.viewer,
  isDbAvailable: () => true,
}));
vi.mock('@/lib/api/client', () => ({
  default: {
    isAccountActive: (viewer: string) => viewer === state.viewer,
    get: state.get,
  },
}));
vi.mock('@/lib/db/artifacts-repo', () => ({}));
vi.mock('@/lib/db/labels-repo', () => ({ saveLabels: vi.fn() }));

beforeEach(() => {
  vi.stubGlobal('navigator', { locks: createLockManager() });
  state.viewer = 'alice';
  state.execute.mockReset().mockResolvedValue([]);
  state.get
    .mockReset()
    .mockResolvedValue({ data: { data: [], deleted: [], serverTime: '2026-10-10T10:00:00Z' } });
});
afterEach(() => vi.unstubAllGlobals());

async function tab() {
  vi.resetModules();
  return import('@/lib/db/sync');
}

describe('cross-tab synchronization', () => {
  it('holds the viewer lock across the network wait, not only SQLite statements', async () => {
    const first = await tab();
    const second = await tab();
    const response = deferred<unknown>();
    state.get.mockImplementationOnce(() => response.promise);
    const firstCycle = first.syncNotes(() => 'conflict');
    await vi.waitFor(() => expect(state.get).toHaveBeenCalledOnce());
    const reads = state.execute.mock.calls.length;
    const secondCycle = second.syncNotes(() => 'conflict');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(state.execute).toHaveBeenCalledTimes(reads);
    response.resolve({ data: { data: [], deleted: [], serverTime: '2026-10-10T10:00:00Z' } });
    await Promise.all([firstCycle, secondCycle]);
    expect(state.get).toHaveBeenCalledTimes(4);
  });

  it('rejects the queued account implicitly before reading after its session changes', async () => {
    const first = await tab();
    const second = await tab();
    const response = deferred<unknown>();
    state.get.mockImplementationOnce(() => response.promise);
    const firstCycle = first.syncNotes(() => 'conflict');
    await vi.waitFor(() => expect(state.get).toHaveBeenCalledOnce());
    const reads = state.execute.mock.calls.length;
    const secondCycle = second.syncNotes(() => 'conflict');
    state.viewer = 'bob';
    response.resolve({ data: { data: [], deleted: [] } });
    await Promise.all([firstCycle, secondCycle]);
    expect(state.execute).toHaveBeenCalledTimes(reads);
    expect(state.get).toHaveBeenCalledOnce();
  });
});
