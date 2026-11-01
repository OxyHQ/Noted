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

it('waits for COMMIT, but the viewer lifecycle can change while COMMIT is pending', async () => {
  vi.resetModules();
  const client = await import('@/lib/db/client-engine');
  let releaseCommit: (() => void) | undefined;
  let enteredCommit: (() => void) | undefined;
  const inCommit = new Promise<void>((resolve) => {
    enteredCommit = resolve;
  });
  const blockedCommit = new Promise<void>((resolve) => {
    releaseCommit = resolve;
  });
  const events: string[] = [];
  const fakeDb = {
    async execAsync(sql: string) {
      if (sql === 'COMMIT') {
        events.push('commit-start');
        enteredCommit?.();
        await blockedCommit;
        events.push('commit-return');
      }
    },
    async runAsync() {
      return { changes: 1 };
    },
    async getFirstAsync() {
      return { value: 'A' };
    },
    async getAllAsync() {
      return [];
    },
    async closeAsync() {
      events.push('close');
    },
  };
  client.setDatabaseDriver({ open: async () => fakeDb, addChangeListener() {} } as never);
  await client.setActiveViewer('A');
  let writeReturned = false;
  const write = client
    .executeTransaction(
      [{ sql: 'INSERT INTO transcript_segments (id) VALUES (?)', params: ['segment-A'] }],
      'A',
    )
    .then((result) => {
      writeReturned = true;
      return result;
    });
  await inCommit;
  expect(writeReturned).toBe(false);
  await client.setActiveViewer('B');
  expect(client.getActiveViewerId()).toBe('B');
  expect(events).toEqual(['commit-start', 'close']);
  releaseCommit?.();
  await expect(write).resolves.toEqual([1]);
  expect(events).toEqual(['commit-start', 'close', 'commit-return']);
});
