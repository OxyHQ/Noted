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

it('observes a viewer switch during a real isolated SQLite transaction', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'noted-sqlite-barrier-'));
  const path = join(directory, 'viewer-A.db');
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE cache_metadata (key TEXT PRIMARY KEY, value TEXT); INSERT INTO cache_metadata VALUES ('viewer_id', 'A'); CREATE TABLE transcript_segments (id TEXT PRIMARY KEY)",
  );
  let releaseCommit: (() => void) | undefined;
  let enteredCommit: (() => void) | undefined;
  const inCommit = new Promise<void>((resolve) => {
    enteredCommit = resolve;
  });
  const blockedCommit = new Promise<void>((resolve) => {
    releaseCommit = resolve;
  });
  const events: string[] = [];
  try {
    vi.resetModules();
    const client = await import('@/lib/db/client-engine');
    const driverDb = {
      async execAsync(sql: string) {
        if (sql === 'COMMIT') {
          events.push('commit-start');
          enteredCommit?.();
          await blockedCommit;
        }
        db.exec(sql);
      },
      async runAsync(sql: string, params: readonly (string | number | null)[] = []) {
        const result = db.prepare(sql).run(...params);
        return { changes: Number(result.changes) };
      },
      async getFirstAsync(sql: string, params: readonly (string | number | null)[] = []) {
        return db.prepare(sql).get(...params) ?? null;
      },
      async getAllAsync() {
        return [];
      },
      async closeAsync() {
        db.close();
        events.push('close');
      },
    };
    client.setDatabaseDriver({ open: async () => driverDb, addChangeListener() {} } as never);
    await client.setActiveViewer('A');
    const write = client.executeTransaction(
      [{ sql: 'INSERT INTO transcript_segments (id) VALUES (?)', params: ['segment-A'] }],
      'A',
    );
    const outcome = write.then(
      () => 'committed',
      () => 'rejected',
    );
    await inCommit;
    await client.setActiveViewer('B');
    expect(client.getActiveViewerId()).toBe('B');
    expect(events).toEqual(['commit-start', 'close']);
    releaseCommit?.();
    const result = await outcome;
    const check = new DatabaseSync(path);
    const row = check.prepare('SELECT COUNT(*) AS n FROM transcript_segments').get() as {
      n: number;
    };
    check.close();
    expect({ result, rows: row.n }).toEqual({ result: 'rejected', rows: 0 });
  } finally {
    releaseCommit?.();
    await rm(directory, { recursive: true, force: true });
  }
});
