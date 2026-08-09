/**
 * The store's connection lifecycle.
 *
 * This suite mocks `expo-sqlite`, which the vitest config otherwise rules out —
 * "a green suite built on mocks of those would only be testing the mocks". The
 * exception is deliberate and narrow: what is under test here is the ORDERING
 * this module imposes on opens, closes and account switches, not SQLite. The one
 * behaviour the fake encodes is the constraint that broke in production — on web
 * the database lives in OPFS, which grants a single sync access handle per file,
 * so a second open while the first is live fails with `NoModificationAllowedError`
 * rather than queueing. A fake that permits concurrent opens could not tell a
 * correct implementation from the one that shipped.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  /** How long the fake takes to release a file handle. */
  closeMs: 20,
  open: new Set<string>(),
  opens: 0,
  collisions: 0,
  concurrent: 0,
  maxConcurrent: 0,
}));

interface FakeRow {
  value: string;
}

vi.mock('expo-sqlite', () => {
  function createDatabase(name: string) {
    const metadata = new Map<string, string>();
    return {
      execAsync: () => Promise.resolve(),
      runAsync: (_sql: string, params: readonly (string | number | null)[]) => {
        metadata.set(String(params[0]), String(params[1]));
        return Promise.resolve({ changes: 1, lastInsertRowId: 0 });
      },
      getFirstAsync: (_sql: string, params: readonly (string | number | null)[]) => {
        const value = metadata.get(String(params[0]));
        return Promise.resolve<FakeRow | null>(value === undefined ? null : { value });
      },
      getAllAsync: () => Promise.resolve([]),
      closeAsync: async () => {
        // Closing flushes and releases the OPFS handle, so it is not
        // instantaneous. The delay is what gives a racing open a window to
        // collide in — with an immediate close, an unserialised implementation
        // looks correct by luck.
        await new Promise((resolve) => setTimeout(resolve, state.closeMs));
        state.open.delete(name);
        state.concurrent -= 1;
      },
    };
  }

  return {
    addDatabaseChangeListener: () => ({ remove: () => undefined }),
    openDatabaseAsync: async (name: string) => {
      // Opening is asynchronous on every platform; without a suspension point
      // here a racing second caller could never interleave, and the test would
      // pass against an unserialised implementation.
      await Promise.resolve();
      if (state.open.has(name)) {
        state.collisions += 1;
        throw new Error(
          "NoModificationAllowedError: Failed to execute 'createSyncAccessHandle': An access handle " +
            'or Writable stream associated with the same file is being created',
        );
      }
      state.open.add(name);
      state.opens += 1;
      state.concurrent += 1;
      state.maxConcurrent = Math.max(state.maxConcurrent, state.concurrent);
      return createDatabase(name);
    },
  };
});

vi.mock('@/lib/db/migrations', () => ({
  LOCAL_TABLES: ['notes'],
  migrate: () => Promise.resolve(),
}));

/** A fresh module instance, since the store keeps its connection in module state. */
async function loadClient() {
  vi.resetModules();
  return import('@/lib/db/client');
}

function delay(ms: number): Promise<'timed-out'> {
  return new Promise((resolve) => setTimeout(() => resolve('timed-out'), ms));
}

/** Long enough for a stranded promise to be distinguishable from a slow one. */
const HANG_THRESHOLD_MS = 100;

beforeEach(() => {
  state.open.clear();
  state.opens = 0;
  state.collisions = 0;
  state.concurrent = 0;
  state.maxConcurrent = 0;
});

describe('local store connection lifecycle', () => {
  it('detects a second open of the same file', async () => {
    // The floor under every assertion below: if this fake cannot see a
    // collision, `collisions === 0` proves nothing anywhere else in the file.
    const { openDatabaseAsync } = await import('expo-sqlite');
    await openDatabaseAsync('same.db');
    await expect(openDatabaseAsync('same.db')).rejects.toThrow(/NoModificationAllowedError/);
    expect(state.collisions).toBe(1);
  });

  it('opens the file once for queries that arrive before sign-in', async () => {
    const client = await loadClient();

    // Two screens subscribing in the same commit that starts the session
    // restore — the shape of every cold start.
    const first = client.execute('SELECT id FROM notes');
    const second = client.execute('SELECT id FROM labels');
    await client.setActiveViewer('user-1');

    await expect(first).resolves.toEqual([]);
    await expect(second).resolves.toEqual([]);
    expect(state.opens).toBe(1);
    expect(state.collisions).toBe(0);
  });

  it('does not strand waiting queries when a sign-out arrives before the session restores', async () => {
    const client = await loadClient();

    const pending = client.execute('SELECT id FROM notes');
    // The authenticated layout runs its effect once with no session yet, then
    // again once the restore lands. The first pass must not close a gate the
    // second pass is about to open.
    await client.clearActiveViewer();
    await client.setActiveViewer('user-1');

    await expect(Promise.race([pending, delay(HANG_THRESHOLD_MS)])).resolves.toEqual([]);
  });

  it('never reopens a file that is still being closed', async () => {
    // The production failure, in order: a query is in flight, the store is torn
    // down under it, and a second query arrives while the close is still
    // running. Nothing here memoises — the connection has already been dropped —
    // so an unordered implementation opens the same file a second time and OPFS
    // refuses it, wedging the pool for the rest of the session.
    const client = await loadClient();
    await client.setActiveViewer('user-1');
    // Awaited, so the file is genuinely open — the close below has something to
    // release, which is the whole point. Racing the very first query instead
    // proves nothing: it never opens anything, so there is no handle to collide
    // with.
    await client.execute('SELECT id FROM notes');
    expect(state.opens).toBe(1);

    const clearing = client.clearActiveViewer();
    // Issued while the close is still running. The connection has already been
    // dropped, so nothing memoised protects this: an unordered implementation
    // opens the same file again and OPFS refuses it, wedging the pool for the
    // rest of the session.
    const during = Promise.race([
      client.execute('SELECT id FROM notes'),
      delay(HANG_THRESHOLD_MS),
    ]);
    await Promise.allSettled([clearing, during]);

    expect(state.collisions).toBe(0);
    expect(state.opens).toBe(1);
  });

  it('never opens the next account while the previous one is still closing', async () => {
    const client = await loadClient();
    await client.setActiveViewer('user-1');

    const query = client.execute('SELECT id FROM notes');
    const switching = client.setActiveViewer('user-2');
    await Promise.all([query, switching]);
    await client.execute('SELECT id FROM notes');

    expect(state.maxConcurrent).toBe(1);
    expect(state.collisions).toBe(0);
    expect(client.getActiveViewerId()).toBe('user-2');
  });

  it('waits for the next account rather than failing a query issued during sign-out', async () => {
    const client = await loadClient();
    await client.setActiveViewer('user-1');
    await client.clearActiveViewer();

    const pending = client.execute('SELECT id FROM notes');
    await expect(Promise.race([pending, delay(HANG_THRESHOLD_MS)])).resolves.toBe('timed-out');

    await client.setActiveViewer('user-2');
    await expect(pending).resolves.toEqual([]);
    expect(state.collisions).toBe(0);
  });
});
