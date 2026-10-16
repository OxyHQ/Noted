/**
 * Nilo's `removedAttachments` — the attachments Oxy told Nilo it no longer
 * serves — reach the note the editor reads, from the server's note only.
 */
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  db: null as null | {
    prepare(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown };
  },
  get: vi.fn(),
}));
vi.mock('@/lib/files/attachment-links', () => ({
  linkNoteAttachments: vi.fn(async () => ({ linked: 0, failed: 0 })),
  syncAttachmentLinks: vi.fn(async () => ({ linked: 0, failed: 0 })),
}));
vi.mock('@/lib/capture/captures-repo', () => ({ deleteNoteRecordings: vi.fn() }));
vi.mock('@/lib/db/erase-local', () => ({ eraseLocalAccountData: vi.fn() }));
vi.mock('@/lib/db/labels-repo', () => ({ saveLabels: vi.fn(), replaceLabels: vi.fn(() => []) }));
vi.mock('@/lib/db/folders-repo', () => ({ saveFolders: vi.fn(), replaceFolders: vi.fn(() => []) }));
vi.mock('@/lib/db/artifacts-repo', () => ({
  artifactUpsertStatement: vi.fn(),
  overrideUpsertStatement: vi.fn(),
  listFinalArtifacts: vi.fn().mockResolvedValue([]),
  getNoteOverrides: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/db/client', () => ({
  getActiveViewerId: () => 'alice',
  isDbAvailable: () => true,
  execute: async (sql: string, params: unknown[] = []) => state.db?.prepare(sql).all(...params),
  executeTransaction: async (statements: { sql: string; params?: unknown[] }[]) => {
    for (const s of statements) state.db?.prepare(s.sql).run(...(s.params ?? []));
    return [];
  },
}));
vi.mock('@/lib/api/client', () => ({
  default: {
    isAccountActive: () => true,
    get: (...args: unknown[]) => state.get(...args),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { MIGRATIONS } from '@/lib/db/migrations';
import { NOTE_DETAIL_SQL, type NoteRow, rowToNote } from '@/lib/db/notes-repo';
import { pullNotes, removedAttachmentsOf } from '@/lib/db/sync';

const sqlite = await import('node:sqlite').catch(() => null);

const serverNote = {
  id: 'note-1',
  title: 'Trip',
  blocks: [],
  blocksVersion: 1,
  color: 'default',
  labels: [],
  folderId: null,
  pinned: false,
  archived: false,
  trashed: false,
  kind: 'note',
  attachments: ['kept', 'taken-down'],
  reminderAt: null,
  order: 0,
  appData: null,
  createdAt: '2026-10-16T08:00:00.000Z',
  updatedAt: '2026-10-16T09:00:00.000Z',
};

describe('removedAttachmentsOf', () => {
  it('reads the server’s list, and nothing from a server that predates it', () => {
    expect(
      removedAttachmentsOf({ ...serverNote, removedAttachments: ['a', 7, ''] } as never),
    ).toEqual(['a']);
    expect(removedAttachmentsOf(serverNote as never)).toEqual([]);
  });
});

describe('a pulled note against SQLite', () => {
  if (!sqlite) {
    it.skip('needs node:sqlite, which this runtime does not provide', () => {});
    return;
  }
  const { DatabaseSync } = sqlite;

  it('carries removedAttachments to the note the editor reads, and the next pull replaces it', async () => {
    const db = new DatabaseSync(':memory:');
    for (const migration of MIGRATIONS) for (const statement of migration) db.exec(statement);
    state.db = db as never;
    const page = (note: object) => ({
      data: { notes: [note], deleted: [], cursor: 'C', hasMore: false, full: false, reset: false },
    });
    const read = () =>
      rowToNote(
        db.prepare(NOTE_DETAIL_SQL.replace('notes.id = ?', "notes.id = 'note-1'")).get() as NoteRow,
      );

    state.get.mockResolvedValueOnce(page({ ...serverNote, removedAttachments: ['taken-down'] }));
    await pullNotes(() => 'copy');
    expect(read()).toMatchObject({
      attachments: ['kept', 'taken-down'],
      removedAttachments: ['taken-down'],
    });

    // Restored in Oxy: Nilo stops listing it, and so does the device.
    state.get.mockResolvedValueOnce(
      page({ ...serverNote, updatedAt: '2026-10-16T10:00:00.000Z', removedAttachments: [] }),
    );
    await pullNotes(() => 'copy');
    expect(read().removedAttachments).toEqual([]);
  });
});
