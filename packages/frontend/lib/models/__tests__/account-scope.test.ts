import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  viewer: 'account-a' as string | null,
  fileExists: false,
  fileBytes: 32,
  download: vi.fn(),
  unsubscribe: vi.fn(),
  transactionGate: undefined as Promise<void> | undefined,
  writes: [] as { viewer: string; sql: string; params: unknown[] }[],
}));

vi.mock('@/lib/db/client', () => ({
  getActiveViewerId: () => state.viewer,
  execute: vi.fn(async () => []),
  executeTransaction: async (statements: { sql: string; params: unknown[] }[], expected?: string | null) => {
    if (state.transactionGate) await state.transactionGate;
    if (expected !== undefined && (!expected || expected !== state.viewer)) {
      throw new Error('The active account changed before this write could be saved');
    }
    for (const statement of statements) state.writes.push({ viewer: state.viewer!, ...statement });
    return statements.map(() => 1);
  },
}));
vi.mock('@/lib/db/live-query', () => ({ useLiveQuery: vi.fn() }));
vi.mock('@/lib/capture/support', () => ({ hasDownloadableModels: () => true }));
vi.mock('expo-file-system', () => ({
  Paths: { document: 'file:///models' },
  Directory: class { create() {} },
  File: class {
    get exists() { return state.fileExists; }
    get size() { return state.fileBytes; }
    delete() { state.fileExists = false; }
  },
  DownloadTask: class {
    addListener() { return { remove: state.unsubscribe }; }
    downloadAsync() { return state.download(); }
  },
}));

import { download, isPresent, type Weights } from '@/lib/models/weights';
import { selectSttModel } from '@/lib/stt/select-model';
import { SETTING_KEYS, writeSetting } from '@/lib/db/settings-repo';

const weights: Weights = {
  id: 'base', kind: 'stt', directory: 'stt-models', filename: 'base.bin',
  url: 'https://example.invalid/public-base.bin', bytes: 32, sha256: 'test',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  state.viewer = 'account-a';
  state.fileExists = false;
  state.fileBytes = weights.bytes;
  state.writes = [];
  state.transactionGate = undefined;
  state.download.mockReset();
  state.unsubscribe.mockReset();
});

describe('model settings account ownership', () => {
  it('downloads and selects the model for the requesting account', async () => {
    state.download.mockImplementation(async () => {
      state.fileExists = true;
      return { size: weights.bytes, delete: vi.fn() };
    });
    await selectSttModel('base', () => download(weights));
    expect(state.writes.map(({ viewer }) => viewer)).toEqual(['account-a', 'account-a', 'account-a']);
    expect(state.writes.map(({ params }) => params[5]).slice(0, 2)).toEqual(['downloading', 'ready']);
    expect(state.writes[2].params).toEqual([SETTING_KEYS.sttModel, '"base"']);
    expect(isPresent(weights)).toBe(true);
  });

  it('retains public weights but never records completion or selection in the next account', async () => {
    const network = deferred<{ size: number; delete: () => void }>();
    state.download.mockReturnValue(network.promise);
    const pending = selectSttModel('base', () => download(weights, () => undefined));
    const rejection = expect(pending).rejects.toThrow('active account changed');
    await vi.waitFor(() => expect(state.download).toHaveBeenCalledOnce());
    expect(state.writes).toHaveLength(1);
    state.writes = [];
    state.viewer = 'account-b';
    state.fileExists = true;
    network.resolve({ size: weights.bytes, delete: () => { state.fileExists = false; } });
    await rejection;
    expect(state.writes).toEqual([]);
    expect(isPresent(weights)).toBe(true);
    expect(state.unsubscribe).toHaveBeenCalledOnce();
  });

  it('does not record a delayed download failure in the next account', async () => {
    const network = deferred<never>();
    state.download.mockReturnValue(network.promise);
    const pending = download(weights);
    const rejection = expect(pending).rejects.toThrow('offline');
    await vi.waitFor(() => expect(state.download).toHaveBeenCalledOnce());
    state.writes = [];
    state.viewer = 'account-b';
    network.reject(new Error('offline'));
    await rejection;
    expect(state.writes).toEqual([]);
  });

  it('does not select a model when an external download resolves after the account changes', async () => {
    const network = deferred<void>();
    const pending = selectSttModel('small', () => network.promise);
    const rejection = expect(pending).rejects.toThrow('active account changed');
    state.viewer = 'account-b';
    network.resolve();
    await rejection;
    expect(state.writes).toEqual([]);
  });

  it('pins immediate preferences before they wait in the SQLite transaction queue', async () => {
    const queue = deferred<void>();
    state.transactionGate = queue.promise;
    const pending = writeSetting(SETTING_KEYS.liveNotes, false);
    const rejection = expect(pending).rejects.toThrow('active account changed');
    state.viewer = 'account-b';
    queue.resolve();
    await rejection;
    expect(state.writes).toEqual([]);
  });
});
