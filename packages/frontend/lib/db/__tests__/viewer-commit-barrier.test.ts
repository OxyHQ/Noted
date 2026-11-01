import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';

vi.mock('expo-sqlite', () => ({
  addDatabaseChangeListener: () => ({ remove() {} }),
  openDatabaseAsync: vi.fn(),
}));
vi.mock('@/lib/db/migrations', () => ({
  migrate: async () => {},
  convertMarkdownNotes: async () => 0,
}));
vi.mock('@/lib/db/ids', () => ({ newNoteId: () => 'unused' }));

async function fixture(
  block: 'COMMIT' | 'ROLLBACK' | null,
  failCommit = false,
  failBegin = false,
  failRollback = false,
  failClose = false,
  ambiguousCommit = false,
  ambiguousBegin = false,
) {
  vi.resetModules();
  const client = await import('@/lib/db/client-engine');
  const directory = await mkdtemp(join(tmpdir(), 'noted-viewer-transaction-'));
  const path = join(directory, 'viewer-A.db');
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE cache_metadata (key TEXT PRIMARY KEY, value TEXT); INSERT INTO cache_metadata VALUES ('viewer_id', 'A'); CREATE TABLE transcript_segments (id TEXT PRIMARY KEY)",
  );
  let release: (() => void) | undefined;
  let entered: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const began = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let closed = false;
  let closeFails = failClose;
  const events: string[] = [];
  const driverDb = {
    async execAsync(sql: string) {
      if (sql === block) {
        events.push(`${sql}-start`);
        entered?.();
        await blocked;
      }
      if (sql === 'COMMIT' && failCommit) throw new Error('commit failed');
      if (sql === 'BEGIN IMMEDIATE' && failBegin) throw new Error('begin failed');
      if (sql === 'ROLLBACK' && failRollback) throw new Error('rollback failed');
      db.exec(sql);
      if (sql === 'BEGIN IMMEDIATE' && ambiguousBegin)
        throw new Error('begin acknowledgement lost');
      if (sql === 'COMMIT' && ambiguousCommit) throw new Error('commit acknowledgement lost');
      if (sql === block) events.push(`${sql}-done`);
    },
    async runAsync(sql: string, params: readonly (string | number | null)[] = []) {
      return { changes: Number(db.prepare(sql).run(...params).changes) };
    },
    async getFirstAsync(sql: string, params: readonly (string | number | null)[] = []) {
      return db.prepare(sql).get(...params) ?? null;
    },
    async getAllAsync() {
      return [];
    },
    async closeAsync() {
      if (closeFails) throw new Error('close failed');
      db.close();
      closed = true;
      events.push('close');
    },
  };
  client.setDatabaseDriver({ open: async () => driverDb, addChangeListener() {} } as never);
  await client.setActiveViewer('A');
  return {
    client,
    driverDb,
    db,
    path,
    events,
    began,
    allowClose: () => {
      closeFails = false;
    },
    release: () => release?.(),
    async dispose() {
      release?.();
      if (!closed) db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

const insert = (id: string) => ({
  sql: 'INSERT INTO transcript_segments (id) VALUES (?)',
  params: [id],
});

it('keeps the viewer and connection until a real SQLite commit completes', async () => {
  const test = await fixture('COMMIT');
  try {
    const write = test.client.executeTransactionPinnedToViewer([insert('segment-A')], 'A');
    await test.began;
    let switched = false;
    const switchViewer = test.client.setActiveViewer('B').then(() => {
      switched = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(switched).toBe(false);
    expect(test.client.getActiveViewerId()).toBe('A');
    expect(test.events).toEqual(['COMMIT-start']);
    test.release();
    await expect(write).resolves.toEqual([1]);
    await switchViewer;
    expect(test.events).toEqual(['COMMIT-start', 'COMMIT-done', 'close']);
    const check = new DatabaseSync(test.path);
    expect(check.prepare('SELECT id FROM transcript_segments').all()).toEqual([
      { id: 'segment-A' },
    ]);
    check.close();
  } finally {
    await test.dispose();
  }
});

it('keeps the viewer until a real rollback completes and leaves no partial row', async () => {
  const test = await fixture('ROLLBACK');
  try {
    const write = test.client.executeTransactionPinnedToViewer(
      [insert('segment-A'), insert('segment-A')],
      'A',
    );
    const outcome = write.then(
      () => 'unexpected',
      () => 'rejected',
    );
    await test.began;
    let switched = false;
    const switchViewer = test.client.setActiveViewer('B').then(() => {
      switched = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(switched).toBe(false);
    test.release();
    expect(await outcome).toBe('rejected');
    await switchViewer;
    expect(test.events).toEqual(['ROLLBACK-start', 'ROLLBACK-done', 'close']);
    const check = new DatabaseSync(test.path);
    expect(check.prepare('SELECT id FROM transcript_segments').all()).toEqual([]);
    check.close();
  } finally {
    await test.dispose();
  }
});

it('releases both queues after a commit error and rolls back', async () => {
  const test = await fixture(null, true);
  try {
    await expect(
      test.client.executeTransactionPinnedToViewer([insert('segment-A')], 'A'),
    ).rejects.toThrow('commit failed');
    await test.client.setActiveViewer('B');
    const check = new DatabaseSync(test.path);
    expect(check.prepare('SELECT id FROM transcript_segments').all()).toEqual([]);
    check.close();
  } finally {
    await test.dispose();
  }
});

it('quarantines a failed BEGIN without trying to roll back or close', async () => {
  const test = await fixture(null, false, true);
  try {
    const exec = vi.spyOn(test.driverDb, 'execAsync');
    await expect(
      test.client.executeTransactionPinnedToViewer([insert('segment-A')], 'A'),
    ).rejects.toBeInstanceOf(test.client.TransactionOutcomeUncertainError);
    expect(test.client.isDbAvailable()).toBe(false);
    expect(exec.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(false);
    await expect(test.client.recoverQuarantinedConnection()).rejects.toThrow(
      'ownership is unknown',
    );
    await expect(test.client.setActiveViewer('B')).rejects.toThrow('needs recovery');
  } finally {
    await test.dispose();
  }
});

it('preserves an actual BEGIN whose acknowledgement failed for manual recovery', async () => {
  const test = await fixture(null, false, false, false, false, false, true);
  try {
    await expect(
      test.client.executeTransactionPinnedToViewer([insert('segment-A')], 'A'),
    ).rejects.toBeInstanceOf(test.client.TransactionOutcomeUncertainError);
    expect(test.db.isTransaction).toBe(true);
    expect(test.client.isDbAvailable()).toBe(false);
    await expect(test.client.recoverQuarantinedConnection()).rejects.toThrow(
      'ownership is unknown',
    );
    await expect(test.client.setActiveViewer('B')).rejects.toThrow('needs recovery');
  } finally {
    await test.dispose();
  }
});

it('does not roll back a transaction that existed before BEGIN was attempted', async () => {
  const test = await fixture(null);
  try {
    test.db.exec('BEGIN IMMEDIATE');
    test.db.prepare('INSERT INTO transcript_segments (id) VALUES (?)').run('prior');
    await expect(
      test.client.executeTransactionPinnedToViewer([insert('segment-A')], 'A'),
    ).rejects.toBeInstanceOf(test.client.TransactionOutcomeUncertainError);
    expect(test.db.isTransaction).toBe(true);
    expect(test.db.prepare('SELECT id FROM transcript_segments').all()).toEqual([{ id: 'prior' }]);
    expect(test.client.getActiveViewerId()).toBe('A');
    await expect(test.client.setActiveViewer('B')).rejects.toThrow('needs recovery');
    await expect(test.client.recoverQuarantinedConnection()).rejects.toThrow(
      'ownership is unknown',
    );
  } finally {
    await test.dispose();
  }
});

it('quarantines rollback failure without closing an uncertain connection', async () => {
  const test = await fixture(null, false, false, true);
  try {
    await expect(
      test.client.executeTransactionPinnedToViewer([insert('duplicate'), insert('duplicate')], 'A'),
    ).rejects.toBeInstanceOf(test.client.TransactionOutcomeUncertainError);
    expect(test.client.isDbAvailable()).toBe(false);
    await expect(test.client.setActiveViewer('B')).rejects.toThrow('needs recovery');
    await expect(test.client.clearActiveViewer()).rejects.toThrow('needs recovery');
    await expect(test.client.closeDb()).rejects.toThrow('needs recovery');
    await expect(
      test.client.execute('SELECT id FROM transcript_segments', [], 'A'),
    ).rejects.toThrow('needs recovery');
    expect(test.client.getActiveViewerId()).toBe('A');
    await expect(test.client.recoverQuarantinedConnection()).rejects.toThrow(
      'Automatic recovery is disabled',
    );
    expect(test.client.isDbAvailable()).toBe(false);
    await expect(test.client.setActiveViewer('B')).rejects.toThrow('reconciliation');
    const check = new DatabaseSync(test.path);
    expect(check.prepare('SELECT id FROM transcript_segments').all()).toEqual([]);
    check.close();
  } finally {
    await test.dispose();
  }
});

it('reports an uncertain outcome when a real SQLite commit succeeds but its acknowledgement fails', async () => {
  const test = await fixture(null, false, false, false, false, true);
  try {
    const write = test.client.executeTransactionPinnedToViewer([insert('maybe-committed')], 'A');
    await expect(write).rejects.toBeInstanceOf(test.client.TransactionOutcomeUncertainError);
    expect(test.client.isDbAvailable()).toBe(false);
    await expect(test.client.recoverQuarantinedConnection()).rejects.toThrow(
      'Automatic recovery is disabled',
    );
    await expect(test.client.setActiveViewer('B')).rejects.toThrow('reconciliation');
    const check = new DatabaseSync(test.path);
    expect(check.prepare('SELECT id FROM transcript_segments').all()).toEqual([
      { id: 'maybe-committed' },
    ]);
    check.close();
  } finally {
    await test.dispose();
  }
});

it('documents that a fresh engine does not retain the in-memory reconciliation gate', async () => {
  const test = await fixture(null, false, false, false, false, true);
  try {
    await expect(
      test.client.executeTransactionPinnedToViewer([insert('maybe-committed')], 'A'),
    ).rejects.toBeInstanceOf(test.client.TransactionOutcomeUncertainError);
    await expect(test.client.recoverQuarantinedConnection()).rejects.toThrow(
      'Automatic recovery is disabled',
    );
    expect(test.client.isDbAvailable()).toBe(false);

    // This explicit close only models process termination for the temporary database.
    await test.driverDb.closeAsync();

    vi.resetModules();
    const freshClient = await import('@/lib/db/client-engine');
    const freshDb = new DatabaseSync(test.path);
    const driverDb = {
      async execAsync(sql: string) {
        freshDb.exec(sql);
      },
      async runAsync(sql: string, params: readonly (string | number | null)[] = []) {
        return { changes: Number(freshDb.prepare(sql).run(...params).changes) };
      },
      async getFirstAsync(sql: string, params: readonly (string | number | null)[] = []) {
        return freshDb.prepare(sql).get(...params) ?? null;
      },
      async getAllAsync(sql: string, params: readonly (string | number | null)[] = []) {
        return freshDb.prepare(sql).all(...params);
      },
      async closeAsync() {
        freshDb.close();
      },
    };
    freshClient.setDatabaseDriver({ open: async () => driverDb, addChangeListener() {} } as never);
    await freshClient.setActiveViewer('A');
    expect(await freshClient.execute('SELECT id FROM transcript_segments', [], 'A')).toEqual([
      { id: 'maybe-committed' },
    ]);
    await freshClient.closeDb();
  } finally {
    await test.dispose();
  }
});

it('never attempts close when uncertain connection ownership is unverified', async () => {
  const test = await fixture(null, false, false, true, true);
  try {
    await expect(
      test.client.executeTransactionPinnedToViewer([insert('duplicate'), insert('duplicate')], 'A'),
    ).rejects.toThrow();
    const close = vi.spyOn(test.driverDb, 'closeAsync');
    await expect(test.client.recoverQuarantinedConnection()).rejects.toThrow(
      'Automatic recovery is disabled',
    );
    expect(close).not.toHaveBeenCalled();
    expect(test.client.isDbAvailable()).toBe(false);
    expect(test.client.getActiveViewerId()).toBe('A');
    await expect(test.client.setActiveViewer('B')).rejects.toThrow('needs recovery');
    test.allowClose();
    await expect(test.client.recoverQuarantinedConnection()).rejects.toThrow(
      'Automatic recovery is disabled',
    );
    expect(close).not.toHaveBeenCalled();
    await expect(test.client.setActiveViewer('B')).rejects.toThrow('reconciliation');
    const check = new DatabaseSync(test.path);
    expect(check.prepare('SELECT id FROM transcript_segments').all()).toEqual([]);
    check.close();
  } finally {
    await test.dispose();
  }
});

it('rejects work submitted during and after recovery until reconciliation exists', async () => {
  const test = await fixture(null, false, false, true);
  try {
    await expect(
      test.client.executeTransactionPinnedToViewer([insert('duplicate'), insert('duplicate')], 'A'),
    ).rejects.toBeInstanceOf(test.client.TransactionOutcomeUncertainError);
    const recovery = test.client.recoverQuarantinedConnection().then(
      () => 'unexpected',
      () => 'blocked',
    );
    const staleWrite = test.client.executeTransactionPinnedToViewer([insert('must-not-run')], 'A');
    const staleSwitch = test.client.setActiveViewer('B');
    const writeOutcome = staleWrite.then(
      () => 'unexpected',
      () => 'blocked',
    );
    const switchOutcome = staleSwitch.then(
      () => 'unexpected',
      () => 'blocked',
    );
    expect(await recovery).toBe('blocked');
    expect(await writeOutcome).toBe('blocked');
    expect(await switchOutcome).toBe('blocked');
    expect(test.client.getActiveViewerId()).toBe('A');
    await expect(test.client.setActiveViewer('B')).rejects.toThrow('reconciliation');
    await expect(
      test.client.executeTransactionPinnedToViewer([insert('still-blocked')], 'A'),
    ).rejects.toThrow('reconciliation');
    const check = new DatabaseSync(test.path);
    expect(check.prepare('SELECT id FROM transcript_segments').all()).toEqual([]);
    check.close();
  } finally {
    await test.dispose();
  }
});

it('rejects a viewer change already queued when rollback becomes uncertain', async () => {
  const test = await fixture('ROLLBACK', false, false, true);
  try {
    const write = test.client.executeTransactionPinnedToViewer(
      [insert('duplicate'), insert('duplicate')],
      'A',
    );
    const writeOutcome = write.then(
      () => 'unexpected',
      () => 'rejected',
    );
    await test.began;
    const switchOutcome = test.client.setActiveViewer('B').then(
      () => 'unexpected',
      () => 'blocked',
    );
    test.release();
    expect(await writeOutcome).toBe('rejected');
    expect(await switchOutcome).toBe('blocked');
    expect(test.client.getActiveViewerId()).toBe('A');
    expect(test.client.isDbAvailable()).toBe(false);
    await expect(test.client.recoverQuarantinedConnection()).rejects.toThrow(
      'Automatic recovery is disabled',
    );
    await expect(test.client.setActiveViewer('B')).rejects.toThrow('reconciliation');
  } finally {
    await test.dispose();
  }
});

it('models a shared wrapper close that leaves the native SQLite transaction open', async () => {
  const test = await fixture(null);
  try {
    test.db.exec('BEGIN IMMEDIATE');
    test.db.prepare('INSERT INTO transcript_segments (id) VALUES (?)').run('uncommitted');
    let references = 2;
    const wrapper = {
      async closeAsync() {
        references--;
        if (references === 0) test.db.close();
      },
    };
    await wrapper.closeAsync();
    expect(references).toBe(1);
    expect(test.db.isTransaction).toBe(true);
    expect(test.db.prepare('SELECT id FROM transcript_segments').all()).toEqual([
      { id: 'uncommitted' },
    ]);
  } finally {
    await test.dispose();
  }
});

it('queues a second transaction without re-entering lifecycle or deadlocking', async () => {
  const test = await fixture('COMMIT');
  try {
    const first = test.client.executeTransactionPinnedToViewer([insert('first')], 'A');
    await test.began;
    const second = test.client.executeTransactionPinnedToViewer([insert('second')], 'A');
    test.release();
    await expect(first).resolves.toEqual([1]);
    await expect(second).resolves.toEqual([1]);
    expect(test.db.prepare('SELECT id FROM transcript_segments ORDER BY id').all()).toEqual([
      { id: 'first' },
      { id: 'second' },
    ]);
  } finally {
    await test.dispose();
  }
});

it('shows that an awaited nested transaction inside a driver must be prohibited', async () => {
  const test = await fixture(null);
  let releaseNestedWait: (() => void) | undefined;
  try {
    let entered: (() => void) | undefined;
    const enteredDriver = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const cancelWait = new Promise<void>((resolve) => {
      releaseNestedWait = resolve;
    });
    let nested: Promise<number[]> | undefined;
    let outerDone = false;
    let nestedDone = false;
    let first = true;
    const originalRun = test.driverDb.runAsync.bind(test.driverDb);
    test.driverDb.runAsync = async (sql, params = []) => {
      if (first && sql.includes('transcript_segments')) {
        first = false;
        nested = test.client.executeTransactionPinnedToViewer([insert('nested')], 'A');
        void nested.then(() => {
          nestedDone = true;
        });
        entered?.();
        await Promise.race([nested, cancelWait]);
      }
      return originalRun(sql, params);
    };
    const outer = test.client
      .executeTransactionPinnedToViewer([insert('outer')], 'A')
      .then((result) => {
        outerDone = true;
        return result;
      });
    await enteredDriver;
    const observed = await Promise.race([
      outer.then(() => 'unexpected-completion'),
      new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 25)),
    ]);
    expect(observed).toBe('timed-out');
    expect(outerDone).toBe(false);
    expect(nestedDone).toBe(false);
    releaseNestedWait?.();
    await expect(outer).resolves.toEqual([1]);
    await expect(nested).resolves.toEqual([1]);
  } finally {
    releaseNestedWait?.();
    await test.dispose();
  }
});

it('rejects a queued old-viewer transaction when a viewer switch wins lifecycle', async () => {
  const test = await fixture('COMMIT');
  try {
    const first = test.client.executeTransactionPinnedToViewer([insert('first')], 'A');
    await test.began;
    const second = test.client.executeTransactionPinnedToViewer([insert('second')], 'A');
    const outcome = second.then(
      () => 'unexpected',
      () => 'rejected',
    );
    const switchViewer = test.client.setActiveViewer('B');
    test.release();
    await expect(first).resolves.toEqual([1]);
    await switchViewer;
    expect(await outcome).toBe('rejected');
    const check = new DatabaseSync(test.path);
    expect(check.prepare('SELECT id FROM transcript_segments').all()).toEqual([{ id: 'first' }]);
    check.close();
  } finally {
    await test.dispose();
  }
});

it('rejects a stale or absent viewer before opening a transaction', async () => {
  const test = await fixture(null);
  try {
    await expect(
      test.client.executeTransactionPinnedToViewer([insert('wrong')], 'B'),
    ).rejects.toThrow('account changed');
    await expect(
      test.client.executeTransactionPinnedToViewer([insert('wrong')], ''),
    ).rejects.toThrow('account changed');
    expect(test.db.prepare('SELECT id FROM transcript_segments').all()).toEqual([]);
  } finally {
    await test.dispose();
  }
});
