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

it('quarantines rollback failure until the uncertain connection closes', async () => {
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
    await test.client.recoverQuarantinedConnection();
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
    await test.client.recoverQuarantinedConnection();
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

it('retains viewer and quarantine if recovery close fails, then permits a retry', async () => {
  const test = await fixture(null, false, false, true, true);
  try {
    await expect(
      test.client.executeTransactionPinnedToViewer([insert('duplicate'), insert('duplicate')], 'A'),
    ).rejects.toThrow();
    await expect(test.client.recoverQuarantinedConnection()).rejects.toThrow('close failed');
    expect(test.client.isDbAvailable()).toBe(false);
    expect(test.client.getActiveViewerId()).toBe('A');
    await expect(test.client.setActiveViewer('B')).rejects.toThrow('needs recovery');
    test.allowClose();
    await test.client.recoverQuarantinedConnection();
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
    const recovery = test.client.recoverQuarantinedConnection();
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
    await recovery;
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
    await test.client.recoverQuarantinedConnection();
    await expect(test.client.setActiveViewer('B')).rejects.toThrow('reconciliation');
  } finally {
    await test.dispose();
  }
});

it('keeps the viewer locked while a recovery rollback is pending', async () => {
  const test = await fixture(null, false, false, true);
  let releaseRecovery: (() => void) | undefined;
  try {
    await expect(
      test.client.executeTransactionPinnedToViewer([insert('duplicate'), insert('duplicate')], 'A'),
    ).rejects.toThrow();
    let recoveryEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      recoveryEntered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseRecovery = resolve;
    });
    const originalExec = test.driverDb.execAsync.bind(test.driverDb);
    test.driverDb.execAsync = async (sql) => {
      if (sql === 'ROLLBACK') {
        recoveryEntered?.();
        await blocked;
      }
      return originalExec(sql);
    };
    const recover = test.client.recoverQuarantinedConnection();
    await entered;
    let changed = false;
    const switching = test.client.setActiveViewer('B').then(
      () => {
        changed = true;
        return 'unexpected';
      },
      () => 'blocked',
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(changed).toBe(false);
    expect(test.client.getActiveViewerId()).toBe('A');
    releaseRecovery?.();
    await recover;
    expect(await switching).toBe('blocked');
    expect(test.client.getActiveViewerId()).toBe('A');
  } finally {
    releaseRecovery?.();
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
