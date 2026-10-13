import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createTestDatabase, dropTestDatabase } from '@oxy.so/db/testing';
import { stubEnv, unstubAllEnvs } from '../../__tests__/stubs';

const { closePostgres, connectPostgres, getDb } = await import('../../db/postgres.js');
const { notes } = await import('../../db/schema/notes.js');
const { noteRevisions } = await import('../../db/schema/note-revisions.js');
const { eq } = await import('drizzle-orm');
const {
  REVISION_KEEP,
  REVISION_MIN_INTERVAL_MS,
  deleteRevisionsOf,
  listRevisions,
  restoreRevision,
  snapshotBeforeEdit,
  textOf,
} = await import('../note-revisions.js');

let databaseUrl: string | undefined;
const adminUrl = process.env.TEST_DATABASE_URL;

beforeAll(async () => {
  if (!adminUrl)
    throw new Error('TEST_DATABASE_URL is required for the disposable PostgreSQL fixture');
  databaseUrl = await createTestDatabase({
    adminUrl,
    migrate: async (url) => {
      const target = new URL(url).pathname.slice(1);
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          'bun',
          ['run', 'db:migrate', `--target-database=${target}`, '--phase=all'],
          { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' },
        );
        child.on('error', reject);
        child.on('close', (code) =>
          code === 0 ? resolve() : reject(new Error(`Migration exit ${String(code)}`)),
        );
      });
    },
  });
  stubEnv('DATABASE_URL', databaseUrl);
  await connectPostgres();
});

afterAll(async () => {
  await closePostgres();
  unstubAllEnvs();
  if (databaseUrl) await dropTestDatabase(databaseUrl);
});

async function newNote(owner: string, title: string, body: string) {
  const [note] = await getDb().insert(notes).values({ oxyUserId: owner, title, body }).returning();
  return note;
}

const snapshot = (noteId: string, owner: string, text: { title: string; body: string }, at: Date) =>
  getDb().transaction((tx) =>
    snapshotBeforeEdit(tx, noteId, owner, { ...text, checklist: [] }, at),
  );

describe('note revisions', () => {
  it('snapshots at most once per interval and skips an untouched note', async () => {
    const note = await newNote('rev-A', 'T', 'v1');
    const t0 = new Date('2026-10-13T10:00:00Z');

    expect(await snapshot(note.id, 'rev-A', { title: 'T', body: 'v1' }, t0)).toBe(true);
    const soon = new Date(t0.getTime() + REVISION_MIN_INTERVAL_MS - 1000);
    expect(await snapshot(note.id, 'rev-A', { title: 'T', body: 'v2' }, soon)).toBe(false);
    const later = new Date(t0.getTime() + REVISION_MIN_INTERVAL_MS + 1000);
    expect(await snapshot(note.id, 'rev-A', { title: 'T', body: 'v2' }, later)).toBe(true);

    const empty = await newNote('rev-A', '', '');
    expect(await snapshot(empty.id, 'rev-A', { title: '', body: '' }, t0)).toBe(false);

    const list = await listRevisions(note.id, 'rev-A');
    expect(list.map((r) => r.preview)).toEqual(['v2', 'v1']);
  });

  it('prunes history to the newest REVISION_KEEP versions', async () => {
    const note = await newNote('rev-B', 'T', 'x');
    const t0 = new Date('2026-10-13T00:00:00Z').getTime();
    for (let i = 0; i < REVISION_KEEP + 5; i += 1) {
      const at = new Date(t0 + i * (REVISION_MIN_INTERVAL_MS + 1000));
      await snapshot(note.id, 'rev-B', { title: 'T', body: `v${i}` }, at);
    }
    const list = await listRevisions(note.id, 'rev-B');
    expect(list).toHaveLength(REVISION_KEEP);
    expect(list[0].preview).toBe(`v${REVISION_KEEP + 4}`);
    expect(list.at(-1)?.preview).toBe('v5');
  });

  it('restores an earlier text and keeps the replaced one, so a restore can be undone', async () => {
    const note = await newNote('rev-C', 'Old title', 'old body');
    await snapshot(
      note.id,
      'rev-C',
      { title: 'Old title', body: 'old body' },
      new Date('2026-10-13T09:00:00Z'),
    );
    await getDb()
      .update(notes)
      .set({ title: 'New title', body: 'new body' })
      .where(eq(notes.id, note.id));

    const [target] = await listRevisions(note.id, 'rev-C');
    const restored = await restoreRevision(
      note.id,
      target.id,
      'rev-C',
      new Date('2026-10-13T09:01:00Z'),
    );
    expect(restored && textOf(restored)).toMatchObject({ title: 'Old title', body: 'old body' });

    const after = await listRevisions(note.id, 'rev-C');
    expect(after.map((r) => r.preview)).toEqual(['new body', 'old body']);

    // Undo the restore by restoring the version that held the replaced text.
    const undone = await restoreRevision(note.id, after[0].id, 'rev-C');
    expect(undone && textOf(undone)).toMatchObject({ title: 'New title', body: 'new body' });
  });

  it("never exposes or restores another user's history", async () => {
    const note = await newNote('rev-D', 'Private', 'secret');
    await snapshot(note.id, 'rev-D', { title: 'Private', body: 'secret' }, new Date());
    const [revision] = await listRevisions(note.id, 'rev-D');

    expect(await listRevisions(note.id, 'someone-else')).toEqual([]);
    expect(await restoreRevision(note.id, revision.id, 'someone-else')).toBeNull();
    const [row] = await getDb().select().from(notes).where(eq(notes.id, note.id));
    expect(row.body).toBe('secret');
  });

  it('removes every version when a note is deleted', async () => {
    const note = await newNote('rev-E', 'T', 'body');
    await snapshot(note.id, 'rev-E', { title: 'T', body: 'body' }, new Date());
    await getDb().transaction((tx) => deleteRevisionsOf(tx, [note.id], 'rev-E'));
    expect(
      await getDb().select().from(noteRevisions).where(eq(noteRevisions.noteId, note.id)),
    ).toEqual([]);
  });
});
