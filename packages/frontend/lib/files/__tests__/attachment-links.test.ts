import { describe, expect, it, vi } from 'vitest';
import { NILO_FILE_ENTITY_TYPE, NILO_OXY_APPLICATION_ID } from '@oxy.so/nilo-contracts';

vi.mock('@/lib/db/client', () => ({
  execute: vi.fn(),
  executeTransaction: vi.fn(),
  getActiveViewerId: () => null,
}));
vi.mock('@/lib/capture/captures-repo', () => ({ deleteNoteRecordings: vi.fn() }));

import { MIGRATIONS } from '@/lib/db/migrations';
import type { Statement } from '@/lib/db/client';
import {
  type AttachmentAssets,
  type DueLinkRow,
  deriveAttachmentLinkStatements,
  DUE_LINKS_SQL,
  DUE_NOTE_LINKS_SQL,
  LINK_RECHECK_MS,
  linkAttachment,
  linkNoteAttachments,
  linkRetryDelayMs,
  type LinkedAssetRecord,
  niloPageTarget,
  syncAttachmentLinks,
} from '@/lib/files/attachment-links';

// The SQL runs for real, on the real schema: a json_each or join mistake would
// otherwise only show up as attachments that never get linked on a device.
const sqlite = await import('node:sqlite').catch(() => null);

const VIEWER = 'alice';
const NOW = new Date('2026-10-16T12:00:00.000Z');

const httpError = (status: number) =>
  Object.assign(new Error(`status ${String(status)}`), { response: { status } });

function fakeAssets(file: LinkedAssetRecord | Error, link?: Error) {
  const linkCalls: Array<[string, unknown]> = [];
  const assets: AttachmentAssets = {
    get: vi.fn(async () => {
      if (file instanceof Error) throw file;
      return { file };
    }),
    link: vi.fn(async (fileId: string, target: unknown) => {
      linkCalls.push([fileId, target]);
      if (link) throw link;
      return {};
    }),
  };
  return { assets, linkCalls };
}

const row = (fields: Partial<DueLinkRow> = {}): DueLinkRow => ({
  note_id: 'note-1',
  file_id: 'file-1',
  state: 'pending',
  attempts: 0,
  ...fields,
});

const active = (fields: Partial<LinkedAssetRecord> = {}): LinkedAssetRecord => ({
  ownerUserId: VIEWER,
  status: 'active',
  links: [],
  ...fields,
});

describe('linkAttachment', () => {
  const current = () => true;

  it('links the owner’s active file to the note’s Nilo page', async () => {
    const { assets, linkCalls } = fakeAssets(active());
    const outcome = await linkAttachment(assets, VIEWER, row(), current);
    expect(linkCalls).toEqual([
      [
        'file-1',
        { app: NILO_OXY_APPLICATION_ID, entityType: NILO_FILE_ENTITY_TYPE, entityId: 'note-1' },
      ],
    ]);
    expect(outcome).toEqual({
      state: 'linked',
      retryInMs: LINK_RECHECK_MS,
      attempts: 0,
      error: null,
    });
  });

  it('targets the same reference Nilo’s own uploads make', () => {
    expect(niloPageTarget('p')).toEqual({
      app: NILO_OXY_APPLICATION_ID,
      entityType: 'page',
      entityId: 'p',
    });
  });

  it('does not link again when the reference is already there', async () => {
    const { assets, linkCalls } = fakeAssets(
      active({
        links: [
          {
            app: NILO_OXY_APPLICATION_ID,
            applicationId: NILO_OXY_APPLICATION_ID,
            entityType: 'page',
            entityId: 'note-1',
            createdBy: VIEWER,
          },
        ],
      }),
    );
    const outcome = await linkAttachment(assets, VIEWER, row({ state: 'linked' }), current);
    expect(linkCalls).toEqual([]);
    expect(outcome?.state).toBe('linked');
  });

  it('links again over a reference Nilo made with its token, which carries no grant', async () => {
    const { assets, linkCalls } = fakeAssets(
      active({
        links: [{ app: NILO_OXY_APPLICATION_ID, entityType: 'page', entityId: 'note-1' }],
      }),
    );
    await linkAttachment(assets, VIEWER, row({ state: 'linked' }), current);
    expect(linkCalls).toHaveLength(1);
  });

  it('links again when a re-check finds the reference gone', async () => {
    // Nilo's link on ANOTHER page does not count.
    const { assets, linkCalls } = fakeAssets(
      active({
        links: [{ app: NILO_OXY_APPLICATION_ID, entityType: 'page', entityId: 'note-2' }],
      }),
    );
    await linkAttachment(assets, VIEWER, row({ state: 'linked' }), current);
    expect(linkCalls).toHaveLength(1);
  });

  it('never links a file in its owner’s trash, which a new reference would restore', async () => {
    const { assets, linkCalls } = fakeAssets(active({ status: 'trash' }));
    const outcome = await linkAttachment(assets, VIEWER, row(), current);
    expect(linkCalls).toEqual([]);
    expect(outcome).toMatchObject({ state: 'unavailable', attempts: 1 });
    expect(outcome?.retryInMs).toBe(linkRetryDelayMs(1));
  });

  it('backs an unavailable file off further each time', async () => {
    const { assets } = fakeAssets(active({ status: 'blocked' }));
    const outcome = await linkAttachment(
      assets,
      VIEWER,
      row({ state: 'unavailable', attempts: 3 }),
      current,
    );
    expect(outcome).toMatchObject({ state: 'unavailable', attempts: 4 });
  });

  it('settles a deleted file as missing, for good', async () => {
    for (const file of [httpError(404), active({ status: 'deleted' })]) {
      const { assets, linkCalls } = fakeAssets(file);
      const outcome = await linkAttachment(assets, VIEWER, row(), current);
      expect(linkCalls).toEqual([]);
      expect(outcome).toEqual({ state: 'missing', retryInMs: null, attempts: 0, error: null });
    }
  });

  it('leaves another account’s file alone: only its owner can attach it', async () => {
    const { assets, linkCalls } = fakeAssets(active({ ownerUserId: 'bob' }));
    const outcome = await linkAttachment(assets, VIEWER, row(), current);
    expect(linkCalls).toEqual([]);
    expect(outcome?.state).toBe('not_owner');
  });

  it('reads Oxy’s refusals of the link', async () => {
    expect(
      (await linkAttachment(fakeAssets(active(), httpError(403)).assets, VIEWER, row(), current))
        ?.state,
    ).toBe('not_owner');
    expect(
      (await linkAttachment(fakeAssets(active(), httpError(404)).assets, VIEWER, row(), current))
        ?.state,
    ).toBe('missing');
  });

  it('retries a failed request with backoff, keeping a confirmed link confirmed', async () => {
    const pending = await linkAttachment(
      fakeAssets(active(), httpError(503)).assets,
      VIEWER,
      row({ attempts: 2 }),
      current,
    );
    expect(pending).toMatchObject({
      state: 'pending',
      attempts: 3,
      retryInMs: linkRetryDelayMs(3),
    });

    const recheck = await linkAttachment(
      fakeAssets(httpError(500)).assets,
      VIEWER,
      row({ state: 'linked' }),
      current,
    );
    expect(recheck).toMatchObject({ state: 'linked', attempts: 1 });
  });

  it('concludes nothing once the active account changed', async () => {
    let live = true;
    const assets: AttachmentAssets = {
      get: async () => {
        live = false;
        throw httpError(403);
      },
      link: vi.fn(),
    };
    expect(await linkAttachment(assets, VIEWER, row(), () => live)).toBeNull();
    expect(assets.link).not.toHaveBeenCalled();
  });

  it('caps the backoff at a day', () => {
    expect(linkRetryDelayMs(1)).toBe(60_000);
    expect(linkRetryDelayMs(2)).toBe(120_000);
    expect(linkRetryDelayMs(40)).toBe(24 * 60 * 60 * 1_000);
  });
});

describe('attachment_links against SQLite', () => {
  if (!sqlite) {
    it.skip('needs node:sqlite, which this runtime does not provide', () => {});
    return;
  }
  const { DatabaseSync } = sqlite;

  function freshDb() {
    const db = new DatabaseSync(':memory:');
    for (const migration of MIGRATIONS) for (const statement of migration) db.exec(statement);
    return db;
  }
  type Db = ReturnType<typeof freshDb>;

  const addNote = (
    db: Db,
    id: string,
    attachments: unknown,
    fields: Record<string, unknown> = {},
  ) => {
    const values = {
      id,
      attachments_json: typeof attachments === 'string' ? attachments : JSON.stringify(attachments),
      dirty: 0,
      server_updated_at: '2026-10-16T00:00:00.000Z',
      created_at: '2026-10-16T00:00:00.000Z',
      updated_at: '2026-10-16T00:00:00.000Z',
      ...fields,
    };
    const columns = Object.keys(values);
    db.prepare(
      `INSERT INTO notes (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    ).run(...(Object.values(values) as Array<string | number | null>));
  };

  const run = (db: Db, statements: readonly Statement[]) => {
    for (const statement of statements) {
      db.prepare(statement.sql).run(...((statement.params ?? []) as Array<string | number | null>));
    }
  };

  const links = (db: Db) =>
    db
      .prepare('SELECT note_id, file_id, state FROM attachment_links ORDER BY note_id, file_id')
      .all();

  it('back-fills every attachment of a live note as pending, once', () => {
    const db = freshDb();
    addNote(db, 'a', ['f1', 'f2', 'f1']);
    addNote(db, 'b', ['f1']);
    addNote(db, 'gone', ['f3'], { deleted_at: '2026-10-16T00:00:00.000Z' });
    addNote(db, 'broken', 'not json');
    addNote(db, 'odd', [42, '', 'f4']);

    run(db, deriveAttachmentLinkStatements(NOW.toISOString()));
    run(db, deriveAttachmentLinkStatements(NOW.toISOString()));
    expect(links(db)).toEqual([
      { note_id: 'a', file_id: 'f1', state: 'pending' },
      { note_id: 'a', file_id: 'f2', state: 'pending' },
      { note_id: 'b', file_id: 'f1', state: 'pending' },
      { note_id: 'odd', file_id: 'f4', state: 'pending' },
    ]);
  });

  it('forgets an attachment that left its note, and a note deleted for good', () => {
    const db = freshDb();
    addNote(db, 'a', ['f1', 'f2']);
    addNote(db, 'b', ['f1']);
    run(db, deriveAttachmentLinkStatements(NOW.toISOString()));
    db.prepare(`UPDATE attachment_links SET state = 'linked' WHERE note_id = 'a'`).run();

    db.prepare(`UPDATE notes SET attachments_json = '["f2"]' WHERE id = 'a'`).run();
    db.prepare(`UPDATE notes SET deleted_at = '2026-10-16T01:00:00.000Z' WHERE id = 'b'`).run();
    run(db, deriveAttachmentLinkStatements(NOW.toISOString()));
    // What stays keeps its state: a confirmed link is not re-done.
    expect(links(db)).toEqual([{ note_id: 'a', file_id: 'f2', state: 'linked' }]);
  });

  it('is due before the note reaches Nilo, and stays due while it is in Noted’s trash', () => {
    const db = freshDb();
    addNote(db, 'settled', ['f1']);
    // Linked BEFORE the note names the file on Nilo (`linkNoteAttachments`).
    addNote(db, 'unsent', ['f2'], { dirty: 1 });
    addNote(db, 'never-synced', ['f3'], { server_updated_at: null, dirty: 1 });
    // A note in Noted's trash is still a note: its files are still used.
    addNote(db, 'trashed', ['f4'], { trashed: 1 });
    run(db, deriveAttachmentLinkStatements(NOW.toISOString()));
    const due = db.prepare(DUE_LINKS_SQL).all(NOW.toISOString()) as DueLinkRow[];
    expect(due.map((r) => r.note_id).sort()).toEqual([
      'never-synced',
      'settled',
      'trashed',
      'unsent',
    ]);
    const forNote = db.prepare(DUE_NOTE_LINKS_SQL).all(NOW.toISOString(), 'unsent') as DueLinkRow[];
    expect(forNote.map((r) => r.file_id)).toEqual(['f2']);
  });

  it('links one note’s new attachments before it is sent, and never throws', async () => {
    const db = freshDb();
    addNote(db, 'new', ['mine'], { dirty: 1, server_updated_at: null });
    addNote(db, 'other', ['elsewhere']);
    const link = vi.fn(async () => ({}));
    const deps = {
      assets: { get: async () => ({ file: active() }), link },
      execute: async <T>(sql: string, params: readonly unknown[]) =>
        db.prepare(sql).all(...(params as string[])) as T[],
      executeTransaction: async (statements: readonly Statement[]) => run(db, statements),
      isCurrentViewer: (viewerId: string) => viewerId === VIEWER,
      now: () => NOW,
    };

    expect(await linkNoteAttachments(VIEWER, 'new', deps)).toEqual({ linked: 1, failed: 0 });
    expect(link).toHaveBeenCalledWith('mine', niloPageTarget('new'));
    expect(link).toHaveBeenCalledTimes(1);

    const broken = { ...deps, executeTransaction: async () => Promise.reject(new Error('locked')) };
    expect(await linkNoteAttachments(VIEWER, 'other', broken)).toEqual({ linked: 0, failed: 1 });
  });

  it('never picks a final state, nor a row whose time has not come', () => {
    const db = freshDb();
    addNote(db, 'a', ['f1', 'f2', 'f3', 'f4']);
    run(db, deriveAttachmentLinkStatements(NOW.toISOString()));
    db.prepare(`UPDATE attachment_links SET state = 'missing' WHERE file_id = 'f1'`).run();
    db.prepare(`UPDATE attachment_links SET state = 'not_owner' WHERE file_id = 'f2'`).run();
    db.prepare(
      `UPDATE attachment_links SET state = 'linked', next_attempt_at = '2026-10-20T00:00:00.000Z' WHERE file_id = 'f3'`,
    ).run();
    const due = db.prepare(DUE_LINKS_SQL).all(NOW.toISOString()) as DueLinkRow[];
    expect(due.map((r) => r.file_id)).toEqual(['f4']);
  });

  it('links a pass’s due attachments and records each outcome', async () => {
    const db = freshDb();
    addNote(db, 'a', ['mine', 'theirs', 'trashed']);
    const files: Record<string, LinkedAssetRecord> = {
      mine: active(),
      theirs: active({ ownerUserId: 'bob' }),
      trashed: active({ status: 'trash' }),
    };
    const link = vi.fn(async () => ({}));
    const result = await syncAttachmentLinks(VIEWER, {
      assets: { get: async (id) => ({ file: files[id] }), link },
      execute: async <T>(sql: string, params: readonly unknown[]) =>
        db.prepare(sql).all(...(params as string[])) as T[],
      executeTransaction: async (statements) => run(db, statements),
      isCurrentViewer: (viewerId) => viewerId === VIEWER,
      now: () => NOW,
    });

    expect(result).toEqual({ linked: 1, failed: 0 });
    expect(link).toHaveBeenCalledTimes(1);
    expect(links(db)).toEqual([
      { note_id: 'a', file_id: 'mine', state: 'linked' },
      { note_id: 'a', file_id: 'theirs', state: 'not_owner' },
      { note_id: 'a', file_id: 'trashed', state: 'unavailable' },
    ]);
    const recheck = db
      .prepare(`SELECT next_attempt_at FROM attachment_links WHERE file_id = 'mine'`)
      .get() as { next_attempt_at: string };
    expect(recheck.next_attempt_at).toBe(new Date(NOW.getTime() + LINK_RECHECK_MS).toISOString());

    // Nothing is due again within the pass's own minute.
    link.mockClear();
    await syncAttachmentLinks(VIEWER, {
      assets: { get: async (id) => ({ file: files[id] }), link },
      execute: async <T>(sql: string, params: readonly unknown[]) =>
        db.prepare(sql).all(...(params as string[])) as T[],
      executeTransaction: async (statements) => run(db, statements),
      isCurrentViewer: (viewerId) => viewerId === VIEWER,
      now: () => NOW,
    });
    expect(link).not.toHaveBeenCalled();
  });

  it('does nothing for an account that is no longer the active one', async () => {
    const executeTransaction = vi.fn();
    await syncAttachmentLinks(VIEWER, {
      assets: fakeAssets(active()).assets,
      execute: vi.fn(),
      executeTransaction,
      isCurrentViewer: () => false,
    });
    expect(executeTransaction).not.toHaveBeenCalled();
  });
});
