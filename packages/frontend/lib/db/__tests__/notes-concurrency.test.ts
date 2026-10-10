/** Real SQLite verifies SQL patch/rollback behavior; only the async transport is replaced. */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Statement } from '@/lib/db/client';

const state = vi.hoisted(() => ({
  db: null as DatabaseSync | null,
  beforeWrite: null as (() => void) | null,
  afterCommit: null as (() => void) | null,
  writes: 0,
  rollbacks: 0,
}));

vi.mock('@/lib/db/client', () => ({
  getActiveViewerId: () => 'viewer',
  execute: async (sql: string, params: SQLInputValue[] = []) => state.db!.prepare(sql).all(...params),
  executeTransaction: async (statements: Statement[]) => {
    state.writes += 1;
    state.beforeWrite?.();
    const db = state.db!;
    db.exec('BEGIN IMMEDIATE');
    const counts: number[] = [];
    try {
      for (const [index, statement] of statements.entries()) {
        const { changes } = db.prepare(statement.sql).run(...(statement.params ?? []) as SQLInputValue[]);
        if (statement.expectedRowsAffected !== undefined && Number(changes) !== statement.expectedRowsAffected) {
          throw new Error(`transaction statement ${index} affected ${changes} rows; expected ${statement.expectedRowsAffected}`);
        }
        counts.push(Number(changes));
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      state.rollbacks += 1;
      throw error;
    }
    state.afterCommit?.();
    return counts;
  },
}));
vi.mock('@/lib/capture/captures-repo', () => ({ deleteNoteRecordings: vi.fn() }));

import { MIGRATIONS } from '@/lib/db/migrations';
import { createNote, getNote, updateNote } from '@/lib/db/notes-repo';

beforeEach(async () => {
  state.db = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS) for (const sql of migration) state.db.exec(sql);
  state.beforeWrite = null;
  state.afterCommit = null;
  state.rollbacks = 0;
  await createNote('note', { title: 'Original', userBody: 'Typed', generatedBody: 'Generated' });
  state.db.exec('DELETE FROM outbox');
  state.writes = 0;
});
afterEach(() => state.db?.close());

describe('concurrent local note patches', () => {
  it('preserves disjoint edits and explicit labels when both writers read the old note', async () => {
    state.db!.exec("INSERT INTO labels (id, name, updated_at) VALUES ('label', 'Label', '')");
    await Promise.all([
      updateNote('note', { title: 'Renamed', labels: ['label'] }),
      updateNote('note', { pinned: true, reminderAt: '2026-10-10T12:00:00.000Z' }),
    ]);
    expect(await getNote('note')).toMatchObject({ title: 'Renamed', labels: ['label'], pinned: true, reminderAt: '2026-10-10T12:00:00.000Z' });
    expect(state.db!.prepare('SELECT * FROM outbox').all()).toHaveLength(1);
  });

  it('recomposes user and generated halves after a competing write rolls back the stale snapshot', async () => {
    await Promise.all([
      updateNote('note', { userBody: 'New typed', labels: [] }),
      updateNote('note', { generatedBody: 'New generated' }),
    ]);
    expect(await getNote('note')).toMatchObject({ body: 'New typed\n\nNew generated', generatedBody: 'New generated' });
    expect(state.rollbacks).toBe(1);
    expect(state.db!.prepare('SELECT * FROM outbox').all()).toHaveLength(1);
  });

  it('does not resurrect a concurrently deleted note or queue an upsert', async () => {
    state.beforeWrite = () => {
      state.beforeWrite = null;
      state.db!.exec("UPDATE notes SET deleted_at = 'deleted' WHERE id = 'note'");
    };
    expect(await updateNote('note', { title: 'Late edit', labels: [] })).toBeNull();
    expect(state.db!.prepare('SELECT title, deleted_at FROM notes').get()).toMatchObject({ title: 'Original', deleted_at: 'deleted' });
    expect(state.db!.prepare('SELECT * FROM outbox').all()).toHaveLength(0);
  });

  it('does not retry an unacknowledged commit', async () => {
    state.afterCommit = () => { throw new Error('Storage owner disappeared before acknowledging this write'); };
    await expect(updateNote('note', { userBody: 'Committed once' })).rejects.toThrow('Storage owner disappeared');
    expect(state.writes).toBe(1);
    expect(await getNote('note')).toMatchObject({ body: 'Committed once\n\nGenerated' });
  });

  it('rolls back the note and outbox when a label write fails', async () => {
    state.db!.exec("CREATE TRIGGER fail_label BEFORE INSERT ON note_labels BEGIN SELECT RAISE(ABORT, 'label unavailable'); END");
    await expect(updateNote('note', { title: 'Must roll back', labels: ['missing'] })).rejects.toThrow();
    expect(state.writes).toBe(1);
    expect(await getNote('note')).toMatchObject({ title: 'Original', labels: [] });
    expect(state.db!.prepare('SELECT * FROM outbox').all()).toHaveLength(0);
  });

  it('bounds contention retries while keeping the unsaved patch out of SQLite', async () => {
    state.beforeWrite = () => state.db!.prepare('UPDATE notes SET body = ?').run(`Competing ${state.writes}`);
    await expect(updateNote('note', { userBody: 'Unsaved draft', labels: [] })).rejects.toThrow('Your draft has been preserved');
    expect(state.writes).toBe(8);
    expect(state.rollbacks).toBe(8);
    expect(state.db!.prepare('SELECT * FROM outbox').all()).toHaveLength(0);
  });
});
