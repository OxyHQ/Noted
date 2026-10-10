import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  viewer: 'alice',
  bearer: 'alice',
  execute: vi.fn(),
  transaction: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/lib/db/client', () => ({
  getActiveViewerId: () => state.viewer,
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
    isAccountActive: (id: string) => state.bearer === id,
    get: (...args: unknown[]) => state.get(...args),
    post: (...args: unknown[]) => state.post(...args),
    patch: (...args: unknown[]) => state.patch(...args),
    delete: (...args: unknown[]) => state.remove(...args),
  },
}));
import { flushOutbox, pullLabels, pullNotes, syncNotes } from '@/lib/db/sync';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.clearAllMocks();
  state.viewer = 'alice';
  state.bearer = 'alice';
  state.execute.mockResolvedValue([]);
  state.transaction.mockImplementation(async (_statements, owner) => {
    if (owner !== state.viewer) throw new Error('The active account changed');
    return [];
  });
});

describe('account-bound sync', () => {
  it('discards a late note response and never advances the new account cursor', async () => {
    const response = deferred<unknown>();
    const started = deferred<void>();
    state.get.mockImplementation(() => {
      started.resolve();
      return response.promise;
    });
    const pending = pullNotes(() => 'copy');
    await started.promise;
    expect(state.get).toHaveBeenCalledWith(expect.any(String), {
      params: {},
      expectedViewerId: 'alice',
    });
    state.viewer = 'bob';
    state.bearer = 'bob';
    response.resolve({ data: { data: [], deleted: ['alice-note'], serverTime: 'alice-cursor' } });
    await expect(pending).rejects.toThrow('active account changed');
    expect(state.transaction).not.toHaveBeenCalled();
    expect(state.execute.mock.calls.every((call) => call[2] === 'alice')).toBe(true);
  });
  it('does not replace a new account label list with a late old-account response', async () => {
    const response = deferred<unknown>();
    state.get.mockReturnValue(response.promise);
    const pending = pullLabels();
    state.viewer = 'bob';
    state.bearer = 'bob';
    response.resolve({
      data: { data: [{ id: 'private-alice-label', name: 'Private', color: null }] },
    });
    await expect(pending).rejects.toThrow('active account changed');
    expect(state.transaction).not.toHaveBeenCalled();
  });
  it.each(['success', 'failure'])(
    'does not acknowledge or back off B’s outbox after A’s delayed %s',
    async (outcome) => {
      const response = deferred<unknown>();
      const started = deferred<void>();
      state.execute.mockResolvedValue([
        { id: 1, entity: 'note', entity_id: 'alice-note', op: 'delete', attempts: 0 },
      ]);
      state.remove.mockImplementation(() => {
        started.resolve();
        return response.promise;
      });
      const pending = flushOutbox();
      await started.promise;
      expect(state.remove).toHaveBeenCalledWith(expect.any(String), { expectedViewerId: 'alice' });
      state.viewer = 'bob';
      state.bearer = 'bob';
      if (outcome === 'success') response.resolve({ data: {} });
      else response.reject(new Error('Connection interrupted'));
      await expect(pending).rejects.toThrow('active account changed');
      expect(state.transaction.mock.calls.every((call) => call[1] === 'alice')).toBe(true);
      expect(
        state.transaction.mock.calls.some((call) =>
          JSON.stringify(call).includes('UPDATE outbox SET attempts'),
        ),
      ).toBe(false);
    },
  );
  it('refuses to send an old outbox when the bearer switches before SQLite switches', async () => {
    state.bearer = 'bob';
    await expect(flushOutbox()).rejects.toThrow('active account changed');
    expect(state.execute).not.toHaveBeenCalled();
    expect(state.post).not.toHaveBeenCalled();
  });
  it('stops the remaining cycle stages when the old account leaves', async () => {
    const response = deferred<unknown>();
    const started = deferred<void>();
    state.get.mockImplementation(() => {
      started.resolve();
      return response.promise;
    });
    const pending = syncNotes(() => 'copy');
    await started.promise;
    state.viewer = 'bob';
    state.bearer = 'bob';
    response.resolve({ data: { data: [], deleted: [], serverTime: 'alice-cursor' } });
    await pending;
    expect(state.get).toHaveBeenCalledTimes(1);
    expect(state.transaction).not.toHaveBeenCalled();
  });
});

it('commits both ordinary pulls to the captured account', async () => {
  state.get.mockResolvedValueOnce({ data: { data: [], deleted: [], serverTime: 'alice-cursor' } });
  await expect(pullNotes(() => 'copy')).resolves.toEqual({ applied: 0, conflicts: 0 });
  expect(state.transaction).toHaveBeenLastCalledWith(
    expect.arrayContaining([expect.objectContaining({ params: ['notes_cursor', 'alice-cursor'] })]),
    'alice',
  );
  state.get.mockResolvedValueOnce({
    data: { data: [{ id: 'label-a', name: 'Work', color: null }] },
  });
  await pullLabels();
  expect(state.transaction).toHaveBeenLastCalledWith(
    expect.arrayContaining([expect.objectContaining({ sql: 'DELETE FROM labels' })]),
    'alice',
  );
});
