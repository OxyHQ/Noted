import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Statement } from '@/lib/db/client';
const state = vi.hoisted(() => ({
  db: null as DatabaseSync | null,
  patch: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
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
    delete: (...args: unknown[]) => state.delete(...args),
  },
}));
import { MIGRATIONS } from '@/lib/db/migrations';
import { createNote, deleteNote, updateNote } from '@/lib/db/notes-repo';
import { flushOutbox } from '@/lib/db/sync';

beforeEach(() => {
  state.patch.mockReset();
  state.post.mockReset();
  state.delete.mockReset();
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

it('keeps an edit queued when a successful PATCH has the same millisecond', async () => {
  const { flush, resolve } = await heldPush();
  await updateNote('n', { title: 'Second' });
  resolve({ data: { note: { updatedAt: '2026-10-13T12:00:01.123456+02:00' } } });
  await flush;
  expect(db().prepare('SELECT title, dirty FROM notes').get()).toMatchObject({
    title: 'Second',
    dirty: 1,
  });
  expect(db().prepare('SELECT COUNT(*) AS n FROM outbox').get()).toMatchObject({ n: 1 });
  state.patch.mockResolvedValue({ data: { note: { updatedAt: '2026-10-13T10:00:02.000Z' } } });
  await flushOutbox('alice');
  expect(state.patch.mock.calls[1]?.[1]).toMatchObject({
    title: 'Second',
    baseUpdatedAt: '2026-10-13T12:00:01.123456+02:00',
  });
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
  expect(db().prepare('SELECT COUNT(*) AS n FROM outbox').get()).toMatchObject({ n: 0 });
  expect(db().prepare('SELECT note_id, audio_path FROM captures').get()).toMatchObject({
    note_id: 'n',
    audio_path: 'audio:fixture',
  });
});

it('retires an unchanged successful upsert', async () => {
  const { flush, resolve } = await heldPush();
  resolve({ data: { note: { updatedAt: '2026-10-13T10:00:01.000Z' } } });
  await flush;
  expect(db().prepare('SELECT dirty FROM notes').get()).toMatchObject({ dirty: 0 });
  expect(db().prepare('SELECT COUNT(*) AS n FROM outbox').get()).toMatchObject({ n: 0 });
});

it.each([
  ['missing note', { data: {} }],
  ['missing version', { data: { note: {} } }],
  ['invalid version', { data: { note: { updatedAt: 'not a timestamp' } } }],
])('retains and retries an upsert after a response with %s', async (_label, response) => {
  await createNote('n', { title: 'First' });
  db()
    .prepare("UPDATE notes SET server_updated_at = ? WHERE id = 'n'")
    .run('2026-10-13T09:00:00.000Z');
  state.patch.mockResolvedValueOnce(response);
  expect(await flushOutbox('alice')).toEqual({ sent: 0, failed: 1 });
  expect(db().prepare('SELECT title, dirty, server_updated_at FROM notes').get()).toMatchObject({
    title: 'First',
    dirty: 1,
    server_updated_at: '2026-10-13T09:00:00.000Z',
  });
  expect(db().prepare('SELECT attempts FROM outbox').get()).toMatchObject({ attempts: 1 });
  vi.setSystemTime(new Date('2026-10-13T11:00:00.000Z'));
  state.patch.mockResolvedValueOnce({ data: { note: { updatedAt: '2026-10-13T11:00:01Z' } } });
  await flushOutbox('alice');
  expect(state.patch.mock.calls[1]?.[1]).toMatchObject({
    title: 'First',
    baseUpdatedAt: '2026-10-13T09:00:00.000Z',
  });
  expect(db().prepare('SELECT COUNT(*) AS n FROM outbox').get()).toMatchObject({ n: 0 });
});

it('keeps a later deletion when the earlier request fails', async () => {
  const { flush, reject } = await heldPush();
  await deleteNote('n');
  reject(new Error('Network unavailable'));
  expect(await flush).toEqual({ sent: 0, failed: 1 });
  expect(db().prepare('SELECT op FROM outbox').get()).toMatchObject({ op: 'delete' });
  expect(db().prepare('SELECT deleted_at FROM notes').get()).toMatchObject({
    deleted_at: '2026-10-13T10:00:00.000Z',
  });
  vi.setSystemTime(new Date('2026-10-13T11:00:00.000Z'));
  state.delete.mockResolvedValue({});
  await flushOutbox('alice');
  expect(db().prepare('SELECT COUNT(*) AS n FROM notes').get()).toMatchObject({ n: 0 });
  expect(db().prepare('SELECT COUNT(*) AS n FROM outbox').get()).toMatchObject({ n: 0 });
});

it('keeps the existing confirmed deletion behavior', async () => {
  await createNote('n', { title: 'Delete me' });
  await deleteNote('n');
  state.delete.mockResolvedValue({});
  await flushOutbox('alice');
  expect(state.delete).toHaveBeenCalledTimes(1);
  expect(db().prepare('SELECT COUNT(*) AS n FROM notes').get()).toMatchObject({ n: 0 });
  expect(db().prepare('SELECT COUNT(*) AS n FROM outbox').get()).toMatchObject({ n: 0 });
});

it('leaves a later deletion queued after a successful older update', async () => {
  const { flush, resolve } = await heldPush();
  await deleteNote('n');
  resolve({ data: { note: { updatedAt: '2026-10-13T10:00:01.000Z' } } });
  await flush;
  expect(db().prepare('SELECT op FROM outbox').get()).toMatchObject({ op: 'delete' });
  expect(db().prepare('SELECT dirty, deleted_at FROM notes').get()).toMatchObject({
    dirty: 1,
    deleted_at: '2026-10-13T10:00:00.000Z',
  });
  state.delete.mockResolvedValue({});
  await flushOutbox('alice');
  expect(db().prepare('SELECT COUNT(*) AS n FROM notes').get()).toMatchObject({ n: 0 });
  expect(db().prepare('SELECT COUNT(*) AS n FROM outbox').get()).toMatchObject({ n: 0 });
});

it('keeps an edit queued when a successful create is followed by its app-data patch', async () => {
  await createNote('n', { title: 'First' });
  let resolve!: (value: unknown) => void;
  let started!: () => void;
  const running = new Promise<void>((done) => {
    started = done;
  });
  state.post.mockImplementation(() => {
    started();
    return new Promise((done) => {
      resolve = done;
    });
  });
  state.patch.mockResolvedValue({
    data: { note: { updatedAt: '2026-10-13T10:00:01.000Z', appData: { revision: 1 } } },
  });
  const flush = flushOutbox('alice');
  await running;
  await updateNote('n', { title: 'Second' });
  resolve({
    status: 201,
    data: { note: { updatedAt: '2026-10-13T10:00:00.000Z', appData: { revision: 0 } } },
  });
  await flush;
  expect(db().prepare('SELECT title, dirty FROM notes').get()).toMatchObject({
    title: 'Second',
    dirty: 1,
  });
  expect(db().prepare('SELECT COUNT(*) AS n FROM outbox').get()).toMatchObject({ n: 1 });
  await flushOutbox('alice');
  expect(state.patch.mock.calls[1]?.[1]).toMatchObject({ title: 'Second' });
  expect(db().prepare('SELECT COUNT(*) AS n FROM outbox').get()).toMatchObject({ n: 0 });
});

it('retries an accepted create if its app-data patch fails', async () => {
  await createNote('n', { title: 'First' });
  state.post.mockResolvedValueOnce({
    status: 201,
    data: { note: { updatedAt: '2026-10-13T10:00:01Z', appData: { revision: 0 } } },
  });
  state.patch.mockRejectedValueOnce(new Error('Network unavailable'));
  expect(await flushOutbox('alice')).toEqual({ sent: 0, failed: 1 });
  expect(db().prepare('SELECT dirty, server_updated_at FROM notes').get()).toMatchObject({
    dirty: 1,
    server_updated_at: null,
  });
  expect(db().prepare('SELECT attempts FROM outbox').get()).toMatchObject({ attempts: 1 });
  vi.setSystemTime(new Date('2026-10-13T11:00:00.000Z'));
  state.post.mockResolvedValueOnce({
    status: 200,
    data: { note: { updatedAt: '2026-10-13T10:00:01Z', appData: { revision: 0 } } },
  });
  state.patch.mockResolvedValueOnce({
    data: { note: { updatedAt: '2026-10-13T11:00:01Z', appData: { revision: 1 } } },
  });
  await flushOutbox('alice');
  expect(state.patch.mock.calls[1]?.[1]).toMatchObject({
    title: 'First',
    baseUpdatedAt: '2026-10-13T10:00:01Z',
  });
  expect(db().prepare('SELECT dirty FROM notes').get()).toMatchObject({ dirty: 0 });
  expect(db().prepare('SELECT COUNT(*) AS n FROM outbox').get()).toMatchObject({ n: 0 });
});

it('rolls back the entire successful acknowledgement when retirement fails', async () => {
  const { flush, resolve } = await heldPush();
  db().exec(
    `CREATE TRIGGER fail_retirement BEFORE DELETE ON outbox BEGIN SELECT RAISE(ABORT, 'retirement failed'); END`,
  );
  resolve({ data: { note: { updatedAt: '2026-10-13T10:00:01.000Z' } } });
  const result = await flush;
  expect(result).toEqual({ sent: 0, failed: 1 });
  expect(db().prepare('SELECT dirty, server_updated_at FROM notes').get()).toMatchObject({
    dirty: 1,
    server_updated_at: '2026-10-13T09:00:00.000Z',
  });
  expect(db().prepare('SELECT attempts FROM outbox').get()).toMatchObject({ attempts: 1 });
});

it('does not acknowledge or attach a server baseline to a replacement row', async () => {
  const { flush, resolve } = await heldPush();
  const original = db().prepare('SELECT id, revision FROM outbox').get() as {
    id: number;
    revision: number;
  };
  db().exec('DELETE FROM outbox');
  db().exec('DELETE FROM notes');
  await createNote('n', { title: 'Replacement' });
  const replacement = db().prepare('SELECT id, revision FROM outbox').get() as {
    id: number;
    revision: number;
  };
  expect(replacement.id).not.toBe(original.id);
  expect(replacement.revision).toBe(original.revision);
  resolve({ data: { note: { updatedAt: '2026-10-13T10:00:01.000Z', appData: { revision: 7 } } } });
  await flush;
  expect(
    db().prepare('SELECT title, dirty, server_updated_at, app_data_revision FROM notes').get(),
  ).toMatchObject({
    title: 'Replacement',
    dirty: 1,
    server_updated_at: null,
    app_data_revision: 0,
  });
  expect(db().prepare('SELECT id FROM outbox').get()).toMatchObject({ id: replacement.id });
});

it('notices a legacy writer that updates an existing row after migration', async () => {
  const { flush, resolve } = await heldPush();
  db().exec('BEGIN IMMEDIATE');
  db()
    .prepare('UPDATE notes SET title = ?, dirty = 1, updated_at = ? WHERE id = ?')
    .run('Legacy edit', '2026-10-13T10:00:00.000Z', 'n');
  db()
    .prepare(`INSERT INTO outbox (entity, entity_id, op, payload_json, attempts, next_attempt_at, created_at)
    VALUES (?, ?, ?, '{}', 0, ?, ?)
    ON CONFLICT (entity, entity_id) DO UPDATE SET op = excluded.op, attempts = 0,
      last_error = NULL, next_attempt_at = excluded.next_attempt_at`)
    .run('note', 'n', 'upsert', '2026-10-13T10:00:00.000Z', '2026-10-13T10:00:00.000Z');
  db().exec('COMMIT');
  expect(db().prepare('SELECT revision FROM outbox').get()).toMatchObject({ revision: 1 });
  resolve({ data: { note: { updatedAt: '2026-10-13T10:00:01.000Z' } } });
  await flush;
  expect(db().prepare('SELECT title, dirty FROM notes').get()).toMatchObject({
    title: 'Legacy edit',
    dirty: 1,
  });
  expect(db().prepare('SELECT COUNT(*) AS n FROM outbox').get()).toMatchObject({ n: 1 });
});

it('observes a legacy writer on a second SQLite connection before acknowledging', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'noted-ack-'));
  state.db?.close();
  state.db = new DatabaseSync(join(dir, 'notes.sqlite'));
  for (const migration of MIGRATIONS) for (const sql of migration) db().exec(sql);
  const peer = new DatabaseSync(join(dir, 'notes.sqlite'));
  try {
    const { flush, resolve } = await heldPush();
    peer.exec('BEGIN IMMEDIATE');
    peer
      .prepare('UPDATE notes SET title = ?, dirty = 1, updated_at = ? WHERE id = ?')
      .run('Other connection', '2026-10-13T10:00:00.000Z', 'n');
    peer
      .prepare(`INSERT INTO outbox (entity, entity_id, op, payload_json, attempts, next_attempt_at, created_at)
      VALUES (?, ?, ?, '{}', 0, ?, ?) ON CONFLICT (entity, entity_id) DO UPDATE SET
      op = excluded.op, attempts = 0, last_error = NULL, next_attempt_at = excluded.next_attempt_at`)
      .run('note', 'n', 'upsert', '2026-10-13T10:00:00.000Z', '2026-10-13T10:00:00.000Z');
    expect(() => db().exec('BEGIN IMMEDIATE')).toThrow();
    peer.exec('COMMIT');
    resolve({ data: { note: { updatedAt: '2026-10-13T10:00:01.000Z' } } });
    await flush;
    expect(db().prepare('SELECT title, dirty FROM notes').get()).toMatchObject({
      title: 'Other connection',
      dirty: 1,
    });
    expect(db().prepare('SELECT COUNT(*) AS n FROM outbox').get()).toMatchObject({ n: 1 });
  } finally {
    peer.close();
    state.db?.close();
    state.db = null;
    rmSync(dir, { recursive: true, force: true });
  }
});

it('migrates a pending legacy row without changing its original columns', async () => {
  state.db?.close();
  state.db = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS.slice(0, -1)) for (const sql of migration) db().exec(sql);
  await createNote('n', { title: 'Offline' });
  const before = db().prepare('SELECT * FROM outbox').get();
  db().exec('BEGIN IMMEDIATE');
  for (const sql of MIGRATIONS.at(-1) ?? []) db().exec(sql);
  db().exec('COMMIT');
  expect(db().prepare('SELECT * FROM outbox').get()).toMatchObject({ ...before, revision: 0 });
  expect(db().prepare('SELECT title, dirty FROM notes').get()).toMatchObject({
    title: 'Offline',
    dirty: 1,
  });
});

it('rolls back a producer if its revision cannot be represented safely', async () => {
  await createNote('n', { title: 'Before' });
  db().exec('PRAGMA recursive_triggers = ON');
  db().exec('UPDATE outbox SET revision = 9007199254740991');
  await expect(updateNote('n', { title: 'After' })).rejects.toThrow('Outbox revision exhausted');
  expect(db().prepare('SELECT title FROM notes').get()).toMatchObject({ title: 'Before' });
  expect(db().prepare('SELECT COUNT(*) AS n FROM outbox').get()).toMatchObject({ n: 1 });
});
