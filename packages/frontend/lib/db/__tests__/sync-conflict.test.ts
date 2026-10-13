import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
  patch: vi.fn(),
}));
vi.mock('@/lib/db/client', () => ({
  getActiveViewerId: () => 'alice',
  isDbAvailable: () => true,
  execute: (...args: unknown[]) => state.execute(...args),
  executeTransaction: (...args: unknown[]) => state.transaction(...args),
}));
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

const pushable = {
  id: 'note-1',
  title: 'Mine',
  body: 'local text',
  checklist_json: '[]',
  color: 'default',
  labels_json: '[]',
  pinned: 0,
  archived: 0,
  trashed: 0,
  attachments_json: '[]',
  reminder_at: null,
  sort_order: 0,
  updated_at: '2026-10-13T10:00:00.000Z',
  server_updated_at: '2026-10-13T09:00:00.000Z',
};

const serverNote = {
  id: 'note-1',
  title: 'Theirs',
  body: 'text from the other device',
  checklist: [],
  color: 'default',
  labels: [],
  attachments: [],
  order: 0,
  createdAt: '2026-10-13T08:00:00.000Z',
  updatedAt: '2026-10-13T09:30:00.000Z',
};

function conflict() {
  return Object.assign(new Error('Conflict'), {
    response: { status: 409, data: { current: serverNote } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.transaction.mockResolvedValue([]);
  state.execute.mockImplementation(async (sql: string) =>
    sql.includes('FROM outbox')
      ? [{ id: 1, entity: 'note', entity_id: 'note-1', op: 'upsert', attempts: 0 }]
      : [pushable],
  );
});

describe('push against a note another device changed', () => {
  it('sends the version the edit was based on', async () => {
    state.patch.mockResolvedValue({
      data: { ...serverNote, updatedAt: '2026-10-13T10:00:01.000Z' },
    });

    await flushOutbox('alice', () => 'copy-id');

    expect(state.patch).toHaveBeenCalledWith(
      '/notes/note-1',
      expect.objectContaining({ baseUpdatedAt: pushable.server_updated_at }),
      expect.anything(),
    );
  });

  it("keeps the other device's version as a copy, then retries on the new base", async () => {
    state.patch.mockRejectedValueOnce(conflict()).mockResolvedValueOnce({
      data: { ...serverNote, body: 'local text', updatedAt: '2026-10-13T10:00:01.000Z' },
    });

    const result = await flushOutbox('alice', () => 'copy-id');

    expect(result).toEqual({ sent: 1, failed: 0 });
    const statements = state.transaction.mock.calls.flatMap(
      ([batch]) => batch as { sql: string; params?: unknown[] }[],
    );
    const copy = statements.find((s) => s.sql.includes('INSERT INTO notes'));
    expect(copy?.params).toEqual(expect.arrayContaining(['copy-id', 'text from the other device']));
    expect(statements).toContainEqual({
      sql: 'UPDATE notes SET server_updated_at = ? WHERE id = ?',
      params: [serverNote.updatedAt, 'note-1'],
    });
    expect(state.patch).toHaveBeenCalledTimes(2);
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
