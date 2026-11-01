import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Statement } from '@/lib/db/client';
const state = vi.hoisted(() => ({
  db: null as DatabaseSync | null,
  patch: vi.fn(),
  post: vi.fn(),
}));
function db(): DatabaseSync {
  if (!state.db) throw new Error('no db');
  return state.db;
}
vi.mock('@/lib/db/client', () => ({
  getActiveViewerId: () => 'alice',
  isDbAvailable: () => true,
  execute: async (sql: string, params: SQLInputValue[] = []) =>
    db()
      .prepare(sql)
      .all(...params),
  executeTransaction: async (statements: Statement[]) => {
    db().exec('BEGIN IMMEDIATE');
    try {
      const counts = statements.map((statement) => {
        const result = db()
          .prepare(statement.sql)
          .run(...((statement.params ?? []) as SQLInputValue[]));
        if (
          statement.expectedRowsAffected !== undefined &&
          Number(result.changes) !== statement.expectedRowsAffected
        )
          throw new Error('unexpected row count');
        return Number(result.changes);
      });
      db().exec('COMMIT');
      return counts;
    } catch (error) {
      db().exec('ROLLBACK');
      throw error;
    }
  },
}));
vi.mock('@/lib/files/attachment-links', () => ({
  linkNoteAttachments: vi.fn(async () => ({})),
  syncAttachmentLinks: vi.fn(),
}));
vi.mock('@/lib/capture/captures-repo', () => ({ deleteNoteRecordings: vi.fn() }));
vi.mock('@/lib/db/erase-local', () => ({ eraseLocalAccountData: vi.fn() }));
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
    post: (...args: unknown[]) => state.post(...args),
    patch: (...args: unknown[]) => state.patch(...args),
    delete: vi.fn(),
  },
}));
import { MIGRATIONS } from '@/lib/db/migrations';
import { createNote, updateNote } from '@/lib/db/notes-repo';
import { flushOutbox } from '@/lib/db/sync';
import {
  ACK_RESEARCH_SQL,
  BACKOFF_RESEARCH_SQL,
  RETIRE_RESEARCH_SQL,
  REVISION_RESEARCH_MIGRATION,
} from '@/docs/research/outbox-revision';

beforeEach(() => {
  state.patch.mockReset();
  state.post.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-13T10:00:00.000Z'));
  state.db = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS) for (const sql of migration) db().exec(sql);
});
afterEach(() => {
  vi.useRealTimers();
  state.db?.close();
});

async function heldPush() {
  await createNote('n', { title: 'First' });
  db()
    .prepare("UPDATE notes SET server_updated_at = ? WHERE id = 'n'")
    .run('2026-10-13T09:00:00.000Z');
  let resolve!: (value: unknown) => void;
  let reject!: (reason: Error) => void;
  let started!: () => void;
  const running = new Promise<void>((r) => {
    started = r;
  });
  state.patch.mockImplementation(() => {
    started();
    return new Promise((ok, fail) => {
      resolve = ok;
      reject = fail;
    });
  });
  const flush = flushOutbox('alice');
  await running;
  expect(state.patch.mock.calls[0]?.[1]).toMatchObject({ title: 'First' });
  return { flush, resolve, reject };
}

it('reproduces the current lost outbox on a same-millisecond edit', async () => {
  const { flush, resolve } = await heldPush();
  await updateNote('n', { title: 'Second' });
  resolve({ data: { note: { updatedAt: '2026-10-13T10:00:01.000Z' } } });
  await flush;
  expect(db().prepare('SELECT title, dirty FROM notes').get()).toMatchObject({
    title: 'Second',
    dirty: 0,
  });
  expect(db().prepare('SELECT COUNT(*) AS n FROM outbox').get()).toMatchObject({ n: 0 });
});

it('reproduces current removal of a newer edit after a create returns 410', async () => {
  await createNote('n', { title: 'First' });
  let reject!: (reason: Error) => void;
  let started!: () => void;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  state.post.mockImplementation(() => {
    started();
    return new Promise((_, fail) => {
      reject = fail;
    });
  });
  const flush = flushOutbox('alice');
  await running;
  expect(state.post.mock.calls[0]?.[1]).toMatchObject({ id: 'n', title: 'First' });
  db()
    .prepare(`INSERT INTO captures (id, note_id, state, started_at, audio_path, created_at, updated_at)
    VALUES ('capture', 'n', 'done', ?, 'audio:fixture', ?, ?)`)
    .run('t', 't', 't');
  await updateNote('n', { title: 'Second' });
  reject(
    Object.assign(new Error('Gone'), { response: { status: 410, data: { code: 'NOTE_DELETED' } } }),
  );
  await flush;
  expect(db().prepare('SELECT title FROM notes').get()).toBeUndefined();
  expect(db().prepare('SELECT note_id, audio_path FROM captures').get()).toMatchObject({
    note_id: 'n',
    audio_path: 'audio:fixture',
  });
});

it('research statements keep a newer intent and its retry state', async () => {
  for (const sql of REVISION_RESEARCH_MIGRATION) db().exec(sql);
  await createNote('n', { title: 'First' });
  const old = db().prepare('SELECT id, revision FROM outbox').get() as {
    id: number;
    revision: number;
  };
  await updateNote('n', { title: 'Second' });
  db().prepare(ACK_RESEARCH_SQL).run('n', '2026-10-13T10:00:00.000Z', old.id, old.revision);
  db().prepare(BACKOFF_RESEARCH_SQL).run(1, 'Offline', 'later', old.id, old.revision);
  db().prepare(RETIRE_RESEARCH_SQL).run(old.id, old.revision);
  expect(db().prepare('SELECT title, dirty FROM notes').get()).toMatchObject({
    title: 'Second',
    dirty: 1,
  });
  expect(db().prepare('SELECT attempts, last_error FROM outbox').get()).toMatchObject({
    attempts: 0,
    last_error: null,
  });
});

it('research migration preserves a pre-existing outbox intent', async () => {
  await createNote('n', { title: 'Offline legacy note' });
  const before = db().prepare('SELECT id, entity_id, op FROM outbox').get();
  for (const sql of REVISION_RESEARCH_MIGRATION) db().exec(sql);
  expect(db().prepare('SELECT id, entity_id, op, revision FROM outbox').get()).toMatchObject({
    ...before,
    revision: 0,
  });
  expect(db().prepare('SELECT title, dirty FROM notes').get()).toMatchObject({
    title: 'Offline legacy note',
    dirty: 1,
  });
});

it('the trigger observes a legacy writer, and row identity detects replacement', async () => {
  for (const sql of REVISION_RESEARCH_MIGRATION) db().exec(sql);
  await createNote('n', { title: 'First' });
  const old = db().prepare('SELECT id, revision FROM outbox').get() as {
    id: number;
    revision: number;
  };
  db()
    .prepare(
      `UPDATE outbox SET op = ?, attempts = 0, last_error = NULL, next_attempt_at = ? WHERE id = ?`,
    )
    .run('upsert', '2026-10-13T10:00:00.000Z', old.id);
  expect(db().prepare('SELECT revision FROM outbox').get()).toMatchObject({
    revision: old.revision + 1,
  });
  db().exec('DELETE FROM outbox');
  await updateNote('n', { title: 'Replacement' });
  const replacement = db().prepare('SELECT id, revision FROM outbox').get() as {
    id: number;
    revision: number;
  };
  expect(replacement.id).not.toBe(old.id);
  expect(replacement.revision).toBe(old.revision);
  db().prepare(ACK_RESEARCH_SQL).run('n', '2026-10-13T10:00:00.000Z', old.id, old.revision);
  db().prepare(RETIRE_RESEARCH_SQL).run(old.id, old.revision);
  expect(db().prepare('SELECT title, dirty FROM notes').get()).toMatchObject({
    title: 'Replacement',
    dirty: 1,
  });
  expect(db().prepare('SELECT id FROM outbox').get()).toMatchObject({ id: replacement.id });
});

it('revision exhaustion rolls back the whole edit even with recursive triggers', async () => {
  for (const sql of REVISION_RESEARCH_MIGRATION) db().exec(sql);
  await createNote('n', { title: 'First' });
  db().exec('PRAGMA recursive_triggers = ON');
  db().exec('UPDATE outbox SET revision = 9007199254740991');
  await expect(updateNote('n', { title: 'Second' })).rejects.toThrow('Outbox revision exhausted');
  expect(db().prepare('SELECT title FROM notes').get()).toMatchObject({ title: 'First' });
});

// An old consumer does not inspect the revision even when the trigger ran.
it('documents the remaining old-consumer acknowledgement gap', async () => {
  for (const sql of REVISION_RESEARCH_MIGRATION) db().exec(sql);
  await createNote('n', { title: 'First' });
  const old = db().prepare('SELECT id FROM outbox').get() as { id: number };
  await updateNote('n', { title: 'Second' });
  db()
    .prepare('UPDATE notes SET dirty = 0 WHERE id = ? AND updated_at = ?')
    .run('n', '2026-10-13T10:00:00.000Z');
  db()
    .prepare(
      `DELETE FROM outbox WHERE id = ? AND NOT EXISTS (SELECT 1 FROM notes WHERE notes.id = outbox.entity_id AND notes.dirty = 1)`,
    )
    .run(old.id);
  expect(db().prepare('SELECT title, dirty FROM notes').get()).toMatchObject({
    title: 'Second',
    dirty: 0,
  });
  expect(db().prepare('SELECT COUNT(*) AS n FROM outbox').get()).toMatchObject({ n: 0 });
});
