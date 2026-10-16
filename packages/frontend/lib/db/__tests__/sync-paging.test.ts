import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
  get: vi.fn(),
  erase: vi.fn(),
}));
vi.mock('@/lib/db/client', () => ({
  getActiveViewerId: () => 'alice',
  isDbAvailable: () => true,
  execute: (...args: unknown[]) => state.execute(...args),
  executeTransaction: (...args: unknown[]) => state.transaction(...args),
}));
vi.mock('@/lib/db/erase-local', () => ({
  eraseLocalAccountData: (...args: unknown[]) => state.erase(...args),
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

type Batch = { sql: string; params?: unknown[] }[];
const batches = () => state.transaction.mock.calls.map(([batch]) => batch as Batch);
const cursorWrites = () =>
  batches().flatMap((batch) =>
    batch
      .filter((s) => s.sql.includes('INSERT INTO sync_state') && s.params?.[0] === 'notes_cursor')
      .map((s) => s.params?.[1]),
  );

const page = (cursor: string, hasMore: boolean, extra: Record<string, unknown> = {}) => ({
  data: { notes: [], deleted: [], cursor, hasMore, full: false, reset: false, ...extra },
});

beforeEach(() => {
  vi.clearAllMocks();
  state.transaction.mockResolvedValue([]);
  state.execute.mockResolvedValue([]);
});

describe('paged pull', () => {
  it('follows the cursor to the last page, committing each cursor with its rows', async () => {
    let stored: string | null = null;
    state.execute.mockImplementation(async (sql: string, params: unknown[]) =>
      sql.includes('sync_state') && params[0] === 'notes_cursor' && stored
        ? [{ value: stored }]
        : [],
    );
    state.transaction.mockImplementation(async (batch: Batch) => {
      for (const s of batch) {
        if (s.sql.includes('INSERT INTO sync_state') && s.params?.[0] === 'notes_cursor') {
          stored = s.params?.[1] as string;
        }
      }
      return [];
    });
    state.get
      .mockResolvedValueOnce(page('C1', true))
      .mockResolvedValueOnce(page('C2', true))
      .mockResolvedValueOnce(page('C3', false, { labels: [], folders: [] }));

    await pullNotes(() => 'copy');

    expect(state.get.mock.calls.map(([, options]) => options.params)).toEqual([
      { limit: 200 },
      { cursor: 'C1', limit: 200 },
      { cursor: 'C2', limit: 200 },
    ]);
    expect(cursorWrites()).toEqual(['C1', 'C2', 'C3']);
  });

  it('stops rather than loop when the cursor does not advance', async () => {
    state.execute.mockImplementation(async (sql: string) =>
      sql.includes('sync_state') ? [{ value: 'C1' }] : [],
    );
    state.get.mockResolvedValue(page('C1', true));

    await pullNotes(() => 'copy');

    expect(state.get).toHaveBeenCalledTimes(1);
  });

  it('sweeps, at the end of a whole-set pass, what the pass did not see and the device has not changed', async () => {
    state.get.mockResolvedValueOnce(page('C1', false, { full: true, labels: [], folders: [] }));

    await pullNotes(() => 'copy');

    const sql = batches()
      .flat()
      .map((s) => s.sql);
    expect(
      sql.some((s) => s.includes('DELETE FROM notes WHERE dirty = 0 AND (sync_pass IS NULL')),
    ).toBe(true);
  });

  it('drops everything this device holds when the workspace was reset, before taking the pass', async () => {
    state.get.mockResolvedValueOnce(page('C1', false, { full: true, reset: true }));

    await pullNotes(() => 'copy');

    expect(state.erase).toHaveBeenCalledWith('alice');
    expect(state.erase.mock.invocationCallOrder[0]).toBeLessThan(
      state.transaction.mock.invocationCallOrder[0] as number,
    );
  });
});
