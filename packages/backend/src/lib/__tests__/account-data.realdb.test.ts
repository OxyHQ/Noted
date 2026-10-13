import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createTestDatabase, dropTestDatabase } from '@oxy.so/db/testing';
import { stubEnv, unstubAllEnvs } from '../../__tests__/stubs';

const { closePostgres, connectPostgres } = await import('../../db/postgres.js');
const { labels } = await import('../../db/schema/labels.js');
const { notes } = await import('../../db/schema/notes.js');
const { feedback } = await import('../../db/schema/feedback.js');
const { folders } = await import('../../db/schema/folders.js');
const { eraseAccountData, exportAccountData, EXPORT_FORMAT } = await import('../account-data.js');

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
  const db = await connectPostgres();
  await db.insert(notes).values([
    { oxyUserId: 'user-A', title: 'A live', body: 'a' },
    { oxyUserId: 'user-A', title: 'A trashed', body: 'a', trashed: true },
    { oxyUserId: 'user-A', title: 'A gone', body: '', deletedAt: new Date() },
    { oxyUserId: 'user-B', title: 'B live', body: 'b' },
  ]);
  await db.insert(labels).values([
    { oxyUserId: 'user-A', name: 'A label' },
    { oxyUserId: 'user-B', name: 'B label' },
  ]);
  await db.insert(folders).values([
    { oxyUserId: 'user-A', name: 'A folder' },
    { oxyUserId: 'user-B', name: 'B folder' },
  ]);
  await db.insert(feedback).values([
    { oxyUserId: 'user-A', type: 'other', message: 'from A' },
    { oxyUserId: 'user-B', type: 'other', message: 'from B' },
  ]);
});

afterAll(async () => {
  await closePostgres();
  unstubAllEnvs();
  if (databaseUrl) await dropTestDatabase(databaseUrl);
});

describe('account data', () => {
  it("exports only the caller's live and trashed notes, not deleted ones", async () => {
    const data = await exportAccountData('user-A');
    expect(data.format).toBe(EXPORT_FORMAT);
    expect(data.notes.map((n) => n.title).sort()).toEqual(['A live', 'A trashed']);
    expect(data.labels.map((l) => l.name)).toEqual(['A label']);
    expect(data.folders.map((f) => f.name)).toEqual(['A folder']);
  });

  it("erases one user's rows and leaves everyone else's untouched", async () => {
    await eraseAccountData('user-A');

    const erased = await exportAccountData('user-A');
    expect(erased.notes).toEqual([]);
    expect(erased.labels).toEqual([]);
    expect(erased.folders).toEqual([]);
    expect(erased.feedback).toEqual([]);

    const kept = await exportAccountData('user-B');
    expect(kept.notes.map((n) => n.title)).toEqual(['B live']);
    expect(kept.labels.map((l) => l.name)).toEqual(['B label']);
    expect(kept.folders.map((f) => f.name)).toEqual(['B folder']);
    expect(kept.feedback).toHaveLength(1);
  });
});
