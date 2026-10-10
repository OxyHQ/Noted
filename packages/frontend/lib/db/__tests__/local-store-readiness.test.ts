/** Exercise the real React hooks across session transitions; only platform I/O is mocked. */
import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const { create, act } = createRequire(import.meta.url)('react-test-renderer');
import { useLocalStore } from '@/lib/db/use-local-store';
import { LocalStoreContext, type LocalStoreState } from '@/lib/db/local-store-context';
import { useLiveQuery, type LiveQueryResult } from '@/lib/db/live-query';

const fake = vi.hoisted(() => ({
  session: { isAuthenticated: false, user: undefined as { id: string } | undefined },
  viewer: null as string | null,
  recover: vi.fn(), sync: vi.fn(), clearCapture: vi.fn(),
  setViewer: vi.fn(), clearViewer: vi.fn(),
  subscriptions: [] as { onData: (rows: { title: string }[]) => void; onError: (message: string) => void }[],
  unsubscribes: [] as ReturnType<typeof vi.fn>[],
}));
vi.mock('@oxy.so/services', () => ({ useOxy: () => fake.session }));
vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove() {} }) } }));
vi.mock('@react-native-community/netinfo', () => ({ default: { addEventListener: () => () => {} } }));
vi.mock('@/lib/capture/captures-repo', () => ({ recoverInterruptedCaptures: () => fake.recover() }));
vi.mock('@/lib/db/sync', () => ({ syncNotes: () => fake.sync() }));
vi.mock('@/lib/db/ids', () => ({ newNoteId: () => 'id' }));
vi.mock('@/lib/db/client', () => ({
  getActiveViewerId: () => fake.viewer,
  setActiveViewer: (id: string) => fake.setViewer(id),
  clearActiveViewer: () => fake.clearViewer(),
  subscribe: (_sql: string, _params: unknown[], handlers: typeof fake.subscriptions[number]) => {
    fake.subscriptions.push(handlers);
    const unsubscribe = vi.fn(); fake.unsubscribes.push(unsubscribe);
    return Promise.resolve(unsubscribe);
  },
}));
vi.mock('@/lib/stores/notes-ui-store', () => ({ useNotesUIStore: { getState: () => ({ clearSelection() {}, setActiveLabel() {}, setSearchQuery() {} }) } }));
vi.mock('@/lib/stores/undo-store', () => ({ useUndoStore: { getState: () => ({ dismissUndo() {} }) } }));
vi.mock('@/lib/stores/capture-store', () => ({ useCaptureStore: { getState: () => ({ clearCapture: fake.clearCapture }) } }));

let state: LocalStoreState;
let query: LiveQueryResult<readonly { title: string }[]>;
let tree: { update: (element: React.ReactNode) => void; unmount: () => void } | undefined;
const mapRows = (rows: readonly { title: string }[]) => rows;
function Query() { query = useLiveQuery({ sql: 'SELECT title FROM notes', mapRows }); return null; }
function Harness() {
  state = useLocalStore();
  return React.createElement(LocalStoreContext.Provider, { value: state }, React.createElement(Query));
}
async function render() {
  await act(async () => {
    if (tree) tree.update(React.createElement(Harness));
    else tree = create(React.createElement(Harness));
  });
}
function signIn(id: string) { fake.session = { isAuthenticated: true, user: { id } }; }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fake.session = { isAuthenticated: false, user: undefined }; fake.viewer = null;
  fake.subscriptions.length = 0; fake.unsubscribes.length = 0;
  vi.clearAllMocks();
  fake.recover.mockResolvedValue(0);
  fake.setViewer.mockImplementation(async id => { fake.viewer = id; });
  fake.clearViewer.mockImplementation(async () => { fake.viewer = null; });
});
afterEach(async () => { await act(async () => tree?.unmount()); tree = undefined; });

describe('local store readiness', () => {
  it('signed-out startup issues no SQLite query and does not report a loading query', async () => {
    await render();
    expect(state.isReady).toBe(false); expect(query.isLoading).toBe(false);
    expect(query.data).toEqual([]); expect(fake.subscriptions).toHaveLength(0);
    expect(fake.setViewer).not.toHaveBeenCalled();
  });
  it('waits for opening and capture recovery before subscribing', async () => {
    const recovery = deferred(); fake.recover.mockReturnValue(recovery.promise);
    signIn('alice'); await render();
    expect(state.isReady).toBe(false); expect(fake.subscriptions).toHaveLength(0);
    await act(async () => recovery.resolve());
    expect(state.isReady).toBe(true); expect(fake.subscriptions).toHaveLength(1);
  });
  it('clears old rows on account switch and sign-out, before the next database opens', async () => {
    signIn('alice'); await render();
    await act(async () => fake.subscriptions[0].onData([{ title: 'Alice private note' }]));
    expect(query.data[0].title).toBe('Alice private note');
    const recovery = deferred(); fake.recover.mockReturnValue(recovery.promise);
    signIn('bob'); await render();
    expect(query.data).toEqual([]); expect(state.isReady).toBe(false);
    expect(fake.unsubscribes[0]).toHaveBeenCalled();
    await act(async () => recovery.resolve());
    expect(state.viewerId).toBe('bob'); expect(fake.subscriptions).toHaveLength(2);
    fake.session = { isAuthenticated: false, user: undefined }; await render();
    expect(query.data).toEqual([]); expect(query.isLoading).toBe(false);
    expect(fake.clearViewer).toHaveBeenCalled(); expect(fake.clearCapture).toHaveBeenCalled();
  });
  it('shows a recoverable error and opens the same account again on retry', async () => {
    fake.recover.mockRejectedValueOnce(new Error('Storage unavailable'));
    signIn('alice'); await render();
    expect(state.error).toContain('Storage unavailable');
    expect(state.isReady).toBe(false); expect(fake.subscriptions).toHaveLength(0);
    await act(async () => state.retry());
    expect(fake.clearViewer).toHaveBeenCalled(); expect(state.isReady).toBe(true);
    expect(state.error).toBeNull(); expect(fake.subscriptions).toHaveLength(1);
  });
  it('ignores completion of the old account after switching while opening', async () => {
    const alice = deferred(); const bob = deferred();
    fake.recover.mockReturnValueOnce(alice.promise).mockReturnValueOnce(bob.promise);
    signIn('alice'); await render(); signIn('bob'); await render();
    await act(async () => alice.resolve());
    expect(state.isReady).toBe(false); expect(fake.subscriptions).toHaveLength(0);
    await act(async () => bob.resolve());
    expect(state.isReady).toBe(true); expect(state.viewerId).toBe('bob');
    expect(fake.subscriptions).toHaveLength(1);
  });
});
