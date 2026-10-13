import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createTestDatabase, dropTestDatabase } from '@oxy.so/db/testing';
import { stubEnv, unstubAllEnvs } from '../../__tests__/stubs';

const { closePostgres, connectPostgres, getDb } = await import('../../db/postgres.js');
const { folders } = await import('../../db/schema/folders.js');
const { notes } = await import('../../db/schema/notes.js');
const { clearFolderFromNotes, userOwnsFolder } = await import('../folders.js');
const { eq } = await import('drizzle-orm');

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

describe('folders', () => {
  it('knows only the folders a user owns', async () => {
    const [mine] = await getDb()
      .insert(folders)
      .values({ oxyUserId: 'f-A', name: 'Work' })
      .returning();
    expect(await userOwnsFolder('f-A', mine.id)).toBe(true);
    expect(await userOwnsFolder('f-B', mine.id)).toBe(false);
    expect(await userOwnsFolder('f-A', 'no-such-folder')).toBe(false);
  });

  it('keeps one folder name per user, but not across users', async () => {
    await getDb().insert(folders).values({ oxyUserId: 'f-C', name: 'Same' });
    await getDb().insert(folders).values({ oxyUserId: 'f-D', name: 'Same' });
    await expect(
      getDb().insert(folders).values({ oxyUserId: 'f-C', name: 'Same' }),
    ).rejects.toThrow();
  });

  it('unfiles the notes in a deleted folder and moves their updatedAt', async () => {
    const [folder] = await getDb()
      .insert(folders)
      .values({ oxyUserId: 'f-E', name: 'Old' })
      .returning();
    const [inside, elsewhere] = await getDb()
      .insert(notes)
      .values([
        { oxyUserId: 'f-E', title: 'in', folderId: folder.id },
        { oxyUserId: 'f-E', title: 'out' },
      ])
      .returning();

    await new Promise((resolve) => setTimeout(resolve, 5));
    await getDb().transaction((tx) => clearFolderFromNotes(tx, folder.id, 'f-E'));

    const [after] = await getDb().select().from(notes).where(eq(notes.id, inside.id));
    expect(after.folderId).toBeNull();
    // Devices pull by `updatedAt`; an unfiled note that did not move would stay
    // filed on every other device.
    expect(after.updatedAt.getTime()).toBeGreaterThan(inside.updatedAt.getTime());

    const [untouched] = await getDb().select().from(notes).where(eq(notes.id, elsewhere.id));
    expect(untouched.updatedAt.getTime()).toBe(elsewhere.updatedAt.getTime());
  });

  it("does not unfile another user's notes that happen to name the same folder id", async () => {
    const [folder] = await getDb()
      .insert(folders)
      .values({ oxyUserId: 'f-F', name: 'X' })
      .returning();
    const [theirs] = await getDb()
      .insert(notes)
      .values({ oxyUserId: 'f-G', title: 'theirs', folderId: folder.id })
      .returning();
    await getDb().transaction((tx) => clearFolderFromNotes(tx, folder.id, 'f-F'));
    const [after] = await getDb().select().from(notes).where(eq(notes.id, theirs.id));
    expect(after.folderId).toBe(folder.id);
  });
});
