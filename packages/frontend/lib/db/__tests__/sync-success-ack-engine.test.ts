import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SQLiteBindValue } from 'expo-sqlite';
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ patch: vi.fn() }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn(), addDatabaseChangeListener: vi.fn() }));
vi.mock('@/lib/files/attachment-links', () => ({
  linkNoteAttachments: vi.fn(async () => ({})),
  syncAttachmentLinks: vi.fn(),
}));
vi.mock('@/lib/capture/captures-repo', () => ({ deleteNoteRecordings: vi.fn() }));
vi.mock('@/lib/db/artifacts-repo', () => ({
  artifactUpsertStatement: vi.fn(),
  overrideUpsertStatement: vi.fn(),
  listFinalArtifacts: vi.fn(async () => []),
  getNoteOverrides: vi.fn(async () => []),
}));
vi.mock('@/lib/api/client', () => ({
  default: {
    isAccountActive: () => true,
    get: vi.fn(),
    post: vi.fn(),
    patch: (...args: unknown[]) => state.patch(...args),
    delete: vi.fn(),
  },
}));
import { clearActiveViewer, execute, setActiveViewer, setDatabaseDriver } from '@/lib/db/client';
import { createNote, updateNote } from '@/lib/db/notes-repo';
import { flushOutbox } from '@/lib/db/sync';

it('retains and then sends the edit through the real database engine', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-13T10:00:00.000Z'));
  const db = new DatabaseSync(':memory:');
  setDatabaseDriver({
    open: async () => ({
      execAsync: async (sql) => {
        db.exec(sql);
      },
      runAsync: async (sql, params = []) => ({
        changes: Number(db.prepare(sql).run(...(params as SQLInputValue[])).changes),
      }),
      getAllAsync: async <T>(sql: string, params: SQLiteBindValue[] = []) =>
        db.prepare(sql).all(...(params as SQLInputValue[])) as T[],
      getFirstAsync: async <T>(sql: string, params: SQLiteBindValue[] = []) =>
        (db.prepare(sql).get(...(params as SQLInputValue[])) as T | undefined) ?? null,
      closeAsync: async () => {
        db.close();
      },
    }),
    addChangeListener: () => {},
  });
  try {
    await setActiveViewer('alice');
    await createNote('n', { title: 'First' });
    await execute(
      "UPDATE notes SET server_updated_at = '2026-10-13T09:00:00.000Z' WHERE id = 'n'",
      [],
      'alice',
    );
    let release!: (value: unknown) => void;
    let started!: () => void;
    const running = new Promise<void>((done) => {
      started = done;
    });
    state.patch.mockImplementationOnce(() => {
      started();
      return new Promise((done) => {
        release = done;
      });
    });
    const flush = flushOutbox('alice');
    await running;
    await updateNote('n', { title: 'Second' });
    release({ data: { note: { updatedAt: '2026-10-13T10:00:01.000Z' } } });
    await flush;
    expect(await execute('SELECT title, dirty FROM notes', [], 'alice')).toMatchObject([
      { title: 'Second', dirty: 1 },
    ]);
    expect(await execute('SELECT COUNT(*) AS n FROM outbox', [], 'alice')).toMatchObject([
      { n: 1 },
    ]);
    state.patch.mockResolvedValueOnce({
      data: { note: { updatedAt: '2026-10-13T10:00:02.000Z' } },
    });
    await flushOutbox('alice');
    expect(await execute('SELECT title, dirty FROM notes', [], 'alice')).toMatchObject([
      { title: 'Second', dirty: 0 },
    ]);
    expect(await execute('SELECT COUNT(*) AS n FROM outbox', [], 'alice')).toMatchObject([
      { n: 0 },
    ]);
  } finally {
    await clearActiveViewer();
    vi.useRealTimers();
  }
});
