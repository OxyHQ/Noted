import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
  patch: vi.fn(),
  linkNote: vi.fn(),
}));
vi.mock('@/lib/files/attachment-links', () => ({
  // The owner's links are `attachment-links.test.ts`'s; here, only WHEN they run.
  linkNoteAttachments: (...args: unknown[]) => state.linkNote(...args),
  syncAttachmentLinks: vi.fn(async () => ({ linked: 0, failed: 0 })),
}));
vi.mock('@/lib/db/client', () => ({
  getActiveViewerId: () => 'alice',
  isDbAvailable: () => true,
  execute: (...args: unknown[]) => state.execute(...args),
  executeTransaction: (...args: unknown[]) => state.transaction(...args),
}));
vi.mock('@/lib/db/erase-local', () => ({ eraseLocalAccountData: vi.fn() }));
vi.mock('@/lib/db/artifacts-repo', () => ({
  artifactUpsertStatement: vi.fn(),
  overrideUpsertStatement: vi.fn(),
  listFinalArtifacts: vi.fn().mockResolvedValue([]),
  getNoteOverrides: vi.fn().mockResolvedValue([]),
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
import { flushOutbox } from '@/lib/db/sync';

const block = (id: string, text: string) => ({
  id,
  parentBlockId: null,
  type: 'paragraph',
  content: { text },
  order: 0,
});

const pushable = {
  id: 'note-1',
  kind: 'note',
  title: 'Mine',
  blocks_json: JSON.stringify([block('b-1', 'local text')]),
  generated_json: '{}',
  color: 'default',
  labels_json: '[]',
  pinned: 0,
  archived: 0,
  trashed: 0,
  attachments_json: '[]',
  reminder_at: null,
  sort_order: 0,
  folder_id: null,
  updated_at: '2026-10-13T10:00:00.000Z',
  server_updated_at: '2026-10-13T09:00:00.000Z',
  app_data_revision: 0,
};

const serverNote = {
  id: 'note-1',
  title: 'Theirs',
  blocks: [block('b-1', 'text from the other device')],
  blocksVersion: 3,
  color: 'default',
  labels: [],
  folderId: null,
  pinned: false,
  archived: false,
  trashed: false,
  kind: 'note',
  attachments: [],
  reminderAt: null,
  order: 0,
  appData: { data: {}, revision: 2 },
  createdAt: '2026-10-13T08:00:00.000Z',
  updatedAt: '2026-10-13T09:30:00.000Z',
};

function refused(status: number, code: string) {
  return Object.assign(new Error('Refused'), {
    response: { status, data: { code, note: serverNote } },
  });
}
const conflict = () => refused(409, 'STALE_NOTE');

type Batch = { sql: string; params?: unknown[] }[];
const statements = () => state.transaction.mock.calls.flatMap(([batch]) => batch as Batch);

beforeEach(() => {
  vi.clearAllMocks();
  state.linkNote.mockResolvedValue({ linked: 0, failed: 0 });
  state.transaction.mockResolvedValue([]);
  state.execute.mockImplementation(async (sql: string) =>
    sql.includes('FROM outbox')
      ? [{ id: 1, entity: 'note', entity_id: 'note-1', op: 'upsert', attempts: 0 }]
      : [pushable],
  );
});

describe('attachments', () => {
  it('are linked by their owner before the note names them on Nilo', async () => {
    const order: string[] = [];
    state.linkNote.mockImplementation(async (viewerId: string, noteId: string) => {
      order.push(`link ${viewerId} ${noteId}`);
      return { linked: 1, failed: 0 };
    });
    state.patch.mockImplementation(async () => {
      order.push('patch');
      return { data: { note: { ...serverNote, updatedAt: '2026-10-13T10:00:01.000Z' } } };
    });

    await flushOutbox('alice', () => 'copy-id');

    expect(order).toEqual(['link alice note-1', 'patch']);
  });
});

describe('push against a note another device changed', () => {
  it('sends the version the edit was based on, and its blocks and app data revision', async () => {
    state.patch.mockResolvedValue({
      data: { note: { ...serverNote, updatedAt: '2026-10-13T10:00:01.000Z' } },
    });

    await flushOutbox('alice', () => 'copy-id');

    expect(state.patch).toHaveBeenCalledWith(
      '/notes/note-1',
      expect.objectContaining({
        baseUpdatedAt: pushable.server_updated_at,
        blocks: [block('b-1', 'local text')],
        appData: expect.objectContaining({ baseRevision: 0 }),
      }),
      expect.anything(),
    );
  });

  it("keeps the other device's version as a copy with blocks of its own, then retries on the new base", async () => {
    state.patch.mockRejectedValueOnce(conflict()).mockResolvedValueOnce({
      data: { note: { ...serverNote, updatedAt: '2026-10-13T10:00:01.000Z' } },
    });

    const result = await flushOutbox('alice', () => 'copy-id');

    expect(result).toEqual({ sent: 1, failed: 0 });
    const copy = statements().find((s) => s.sql.includes('INSERT INTO notes'));
    expect(copy?.params?.[0]).toBe('copy-id');
    const copied = JSON.parse(copy?.params?.[2] as string) as {
      id: string;
      content: { text: string };
    }[];
    expect(copied.map((b) => b.content.text)).toEqual(['text from the other device']);
    // A block belongs to one page: the copy's are new.
    expect(copied[0]?.id).not.toBe('b-1');
    expect(statements()).toContainEqual({
      sql: 'UPDATE notes SET server_updated_at = ?, app_data_revision = ? WHERE id = ?',
      params: [serverNote.updatedAt, 2, 'note-1'],
    });
    expect(state.patch).toHaveBeenCalledTimes(2);
  });

  it('takes the server’s app data and sends again when only that moved', async () => {
    state.patch.mockRejectedValueOnce(refused(409, 'STALE_APP_DATA')).mockResolvedValueOnce({
      data: { note: { ...serverNote, updatedAt: '2026-10-13T10:00:01.000Z' } },
    });

    const result = await flushOutbox('alice', () => 'copy-id');

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(statements().some((s) => s.sql.includes('INSERT INTO notes'))).toBe(false);
    expect(statements()).toContainEqual({
      sql: 'UPDATE notes SET app_data_revision = ? WHERE id = ?',
      params: [2, 'note-1'],
    });
  });

  it('drops the note when the server says it was deleted for good', async () => {
    state.patch.mockRejectedValueOnce(refused(410, 'NOTE_DELETED'));

    const result = await flushOutbox('alice', () => 'copy-id');

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(statements()).toContainEqual({
      sql: 'DELETE FROM notes WHERE id = ?',
      params: ['note-1'],
    });
  });

  it('leaves the entry for the outbox backoff when it cannot mint a copy id', async () => {
    state.patch.mockRejectedValue(conflict());

    const result = await flushOutbox('alice');

    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(state.patch).toHaveBeenCalledTimes(1);
  });

  it('gives up after one retry rather than looping on a note that keeps changing', async () => {
    state.patch.mockRejectedValue(conflict());

    const result = await flushOutbox('alice', () => 'copy-id');

    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(state.patch).toHaveBeenCalledTimes(2);
  });
});
