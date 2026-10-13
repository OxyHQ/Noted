import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
  get: vi.fn(),
}));
vi.mock('@/lib/db/client', () => ({
  getActiveViewerId: () => 'alice',
  isDbAvailable: () => true,
  execute: (...args: unknown[]) => state.execute(...args),
  executeTransaction: (...args: unknown[]) => state.transaction(...args),
}));
vi.mock('@/lib/db/artifacts-repo', () => ({
  artifactUpsertStatement: vi.fn(),
  overrideUpsertStatement: vi.fn(),
  listFinalArtifacts: vi.fn().mockResolvedValue([]),
  getNoteOverrides: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/api/client', () => ({
  default: {
    isAccountActive: () => true,
    get: (...args: unknown[]) => state.get(...args),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));
import { pullNotes } from '@/lib/db/sync';

const cursorWrites = () =>
  state.transaction.mock.calls.flatMap(([batch]) =>
    (batch as { sql: string; params?: unknown[] }[])
      .filter((s) => s.sql.includes('INSERT INTO sync_state'))
      .map((s) => s.params?.[1]),
  );

beforeEach(() => {
  vi.clearAllMocks();
  state.transaction.mockResolvedValue([]);
  state.execute.mockResolvedValue([]);
});

describe('paged pull', () => {
  it('follows nextCursor until the last page, committing each cursor with its rows', async () => {
    state.get
      .mockResolvedValueOnce({
        data: { data: [], deleted: [], serverTime: 'T1', hasMore: true, nextCursor: 'C1' },
      })
      .mockResolvedValueOnce({
        data: { data: [], deleted: [], serverTime: 'T2', hasMore: true, nextCursor: 'C2' },
      })
      .mockResolvedValueOnce({ data: { data: [], deleted: [], serverTime: 'T3', hasMore: false } });

    await pullNotes(() => 'copy');

    expect(state.get.mock.calls.map(([, options]) => options.params)).toEqual([
      { limit: 500 },
      { since: 'C1', limit: 500 },
      { since: 'C2', limit: 500 },
    ]);
    // Intermediate pages commit their own cursor; only the last one commits the
    // server clock.
    expect(cursorWrites()).toEqual(['C1', 'C2', 'T3']);
  });

  it('treats a server that ignores paging as a single page', async () => {
    state.get.mockResolvedValueOnce({ data: { data: [], deleted: [], serverTime: 'T1' } });

    await pullNotes(() => 'copy');

    expect(state.get).toHaveBeenCalledTimes(1);
    expect(cursorWrites()).toEqual(['T1']);
  });

  it('stops rather than loop when the cursor does not advance', async () => {
    state.execute.mockImplementation(async (sql: string) =>
      sql.includes('sync_state') ? [{ value: 'C1' }] : [],
    );
    state.get.mockResolvedValue({
      data: { data: [], deleted: [], serverTime: 'T', hasMore: true, nextCursor: 'C1' },
    });

    await pullNotes(() => 'copy');

    expect(state.get).toHaveBeenCalledTimes(1);
  });
});
