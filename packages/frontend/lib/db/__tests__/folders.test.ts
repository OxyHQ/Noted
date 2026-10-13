import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  execute: vi.fn(),
  executeTransaction: vi.fn(),
  getActiveViewerId: () => null,
}));
vi.mock('@/lib/capture/captures-repo', () => ({ deleteNoteRecordings: vi.fn() }));

import { replaceFolders } from '@/lib/db/folders-repo';
import { LOCAL_TABLES, MIGRATIONS } from '@/lib/db/migrations';
import { noteListQuery } from '@/lib/db/notes-repo';

const sqlite = await import('node:sqlite').catch(() => null);

describe('folders on the local store', () => {
  it('is wiped with the rest of an account on sign-out', () => {
    expect(LOCAL_TABLES).toContain('folders');
  });

  if (!sqlite) {
    it.skip('needs node:sqlite, which this runtime does not provide', () => {});
    return;
  }

  const db = new sqlite.DatabaseSync(':memory:');
  for (const migration of MIGRATIONS) for (const statement of migration) db.exec(statement);
  const now = '2026-10-13T00:00:00.000Z';

  const addNote = (id: string, folder: string | null, dirty = 0) =>
    db
      .prepare(
        `INSERT INTO notes (id, folder_id, dirty, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, folder, dirty, now, now);
  const folderOf = (id: string) =>
    (db.prepare('SELECT folder_id AS f FROM notes WHERE id = ?').get(id) as { f: string | null }).f;
  const apply = (folders: { id: string; name: string }[]) => {
    for (const { sql, params } of replaceFolders(folders, now)) {
      db.prepare(sql).run(...((params ?? []) as string[]));
    }
  };

  addNote('in-work', 'work');
  addNote('in-home', 'home');
  addNote('loose', null);

  it('filters the list to one folder', () => {
    const { sql, params } = noteListQuery({ folder: 'work' });
    const ids = (db.prepare(sql).all(...(params as string[])) as { id: string }[]).map((r) => r.id);
    expect(ids).toEqual(['in-work']);
  });

  it("replaces the stored list with the server's", () => {
    apply([
      { id: 'work', name: 'Work' },
      { id: 'home', name: 'Home' },
    ]);
    apply([{ id: 'work', name: 'Work 2' }]);
    const rows = db.prepare('SELECT id, name FROM folders').all();
    expect(rows).toEqual([{ id: 'work', name: 'Work 2' }]);
  });

  it('unfiles only notes with unsent edits whose folder is gone', () => {
    addNote('dirty-gone', 'deleted-elsewhere', 1);
    addNote('clean-unknown', 'not-heard-of-yet', 0);
    addNote('dirty-kept', 'work', 1);

    apply([{ id: 'work', name: 'Work' }]);

    // Its edits would be refused as `Unknown folder` on every retry.
    expect(folderOf('dirty-gone')).toBeNull();
    // A clean note names a folder this device simply has not pulled yet; the
    // server's version is the right one and unfiling it would diverge from it.
    expect(folderOf('clean-unknown')).toBe('not-heard-of-yet');
    expect(folderOf('dirty-kept')).toBe('work');
  });
});
