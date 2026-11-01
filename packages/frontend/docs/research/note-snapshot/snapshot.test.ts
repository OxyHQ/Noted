import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Statement } from '@/lib/db/client';

const state = vi.hoisted(() => ({ db: null as DatabaseSync | null, remove: vi.fn() }));
function db(): DatabaseSync {
  if (!state.db) throw new Error('database not open');
  return state.db;
}
vi.mock('@/lib/db/client', () => ({
  getActiveViewerId: () => 'alice',
  subscribe: vi.fn(),
  execute: async (sql: string, params: SQLInputValue[] = []) =>
    db()
      .prepare(sql)
      .all(...params),
  executeTransaction: async (statements: Statement[]) => {
    db().exec('BEGIN IMMEDIATE');
    try {
      const changes = statements.map((statement) => {
        const result = db()
          .prepare(statement.sql)
          .run(...((statement.params ?? []) as SQLInputValue[]));
        if (
          statement.expectedRowsAffected !== undefined &&
          Number(result.changes) !== statement.expectedRowsAffected
        )
          throw new Error('Expected one source row');
        return Number(result.changes);
      });
      db().exec('COMMIT');
      return changes;
    } catch (error) {
      db().exec('ROLLBACK');
      throw error;
    }
  },
}));
vi.mock('@/lib/audio/backend', () => ({
  createChunkBackend: () => ({ remove: (...args: unknown[]) => state.remove(...args) }),
}));
import { deleteNoteRecordings } from '@/lib/capture/captures-repo';
import { eraseLocalAccountData } from '@/lib/db/erase-local';
import { MIGRATIONS } from '@/lib/db/migrations';
import { createNote } from '@/lib/db/notes-repo';
import { executeTransaction } from '@/lib/db/client';
import { SNAPSHOT_PREVIEW_SQL, SNAPSHOT_SCHEMA, snapshotRefusedNote } from './index';

let dir: string;
const now = '2026-10-13T10:00:00.000Z';

async function seed(withAudio = true): Promise<number> {
  await createNote('n', { title: 'Local draft', attachments: ['file-1'] });
  db().prepare("INSERT INTO labels (id,name,updated_at) VALUES ('label','Label',?)").run(now);
  db().exec("INSERT INTO note_labels (note_id,label_id) VALUES ('n','label')");
  db().prepare("INSERT INTO folders (id,name,updated_at) VALUES ('folder','Folder',?)").run(now);
  db().exec("UPDATE notes SET folder_id = 'folder' WHERE id = 'n'");
  if (withAudio) {
    db()
      .prepare(`INSERT INTO captures (id,note_id,state,started_at,audio_path,created_at,updated_at)
      VALUES ('capture','n','complete',?,'audio:capture',?,?)`)
      .run(now, now, now);
    db()
      .prepare(`INSERT INTO transcript_segments (id,capture_id,start_ms,end_ms,text,created_at)
      VALUES ('segment','capture',0,5,'Transcribed',?)`)
      .run(now);
    db()
      .prepare(`INSERT INTO note_artifacts (id,note_id,capture_id,stage,created_at,updated_at)
      VALUES ('artifact','n','capture','final',?,?)`)
      .run(now, now);
    db()
      .prepare(`INSERT INTO note_item_overrides (note_id,item_id,text,updated_at)
      VALUES ('n','item','Override',?)`)
      .run(now);
    db()
      .prepare(
        `INSERT INTO attachment_links (note_id,file_id,next_attempt_at) VALUES ('n','file-1',?)`,
      )
      .run(now);
    writeFileSync(join(dir, 'capture'), 'synthetic audio bytes');
  }
  return (db().prepare("SELECT id FROM outbox WHERE entity_id = 'n'").get() as { id: number }).id;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'noted-snapshot-'));
  state.db = new DatabaseSync(join(dir, 'notes.sqlite'));
  for (const migration of MIGRATIONS) for (const sql of migration) db().exec(sql);
  for (const sql of SNAPSHOT_SCHEMA) db().exec(sql);
  state.remove.mockReset();
  state.remove.mockImplementation(async (captureId: string) => {
    unlinkSync(join(dir, captureId));
  });
});
afterEach(() => {
  state.db?.close();
  state.db = null;
  rmSync(dir, { recursive: true, force: true });
});

describe('disconnected 410 snapshot model', () => {
  it('copies every related SQLite row without adding an active outbox or modifying the audio fixture', async () => {
    const source = await seed();
    await executeTransaction(snapshotRefusedNote('snapshot', 'n', source, now), 'alice');
    for (const table of [
      'notes',
      'outbox',
      'note_labels',
      'labels',
      'folders',
      'captures',
      'transcript_segments',
      'note_artifacts',
      'note_item_overrides',
      'attachment_links',
    ]) {
      const count = db()
        .prepare(`SELECT COUNT(*) AS count FROM research_snapshot_${table} WHERE snapshot_id = ?`)
        .get('snapshot');
      expect(count, table).toMatchObject({ count: 1 });
    }
    expect(db().prepare(SNAPSHOT_PREVIEW_SQL).get('snapshot')).toMatchObject({
      id: 'n',
      title: 'Local draft',
    });
    expect(db().prepare('SELECT COUNT(*) AS count FROM outbox').get()).toMatchObject({ count: 1 });
    expect(readFileSync(join(dir, 'capture'), 'utf8')).toBe('synthetic audio bytes');
  });

  it('keeps SQLite rows consistent after reopen and after a later source edit', async () => {
    const source = await seed();
    await executeTransaction(snapshotRefusedNote('snapshot', 'n', source, now), 'alice');
    state.db?.close();
    state.db = new DatabaseSync(join(dir, 'notes.sqlite'));
    db().exec("UPDATE notes SET title = 'Later edit' WHERE id = 'n'");
    expect(db().prepare(SNAPSHOT_PREVIEW_SQL).get('snapshot')).toMatchObject({
      title: 'Local draft',
    });
    expect(db().prepare('SELECT title FROM notes WHERE id = ?').get('n')).toMatchObject({
      title: 'Later edit',
    });
  });

  it('rolls back the header and all copied rows when one child copy fails', async () => {
    const source = await seed();
    db().exec(
      `CREATE TRIGGER fail_copy BEFORE INSERT ON research_snapshot_transcript_segments BEGIN SELECT RAISE(ABORT, 'snapshot failed'); END`,
    );
    await expect(
      executeTransaction(snapshotRefusedNote('snapshot', 'n', source, now), 'alice'),
    ).rejects.toThrow('snapshot failed');
    expect(
      db().prepare('SELECT COUNT(*) AS count FROM research_note_snapshots').get(),
    ).toMatchObject({ count: 0 });
    expect(
      db().prepare('SELECT COUNT(*) AS count FROM research_snapshot_notes').get(),
    ).toMatchObject({ count: 0 });
    expect(db().prepare('SELECT title FROM notes WHERE id = ?').get('n')).toMatchObject({
      title: 'Local draft',
    });
    expect(existsSync(join(dir, 'capture'))).toBe(true);
  });

  it('does not attribute a stale 410 to a replacement outbox row', async () => {
    const old = await seed();
    db().exec('DELETE FROM outbox');
    db()
      .prepare(
        `INSERT INTO outbox (entity,entity_id,op,next_attempt_at,created_at) VALUES ('note','n','upsert',?,?)`,
      )
      .run(now, now);
    const current = (db().prepare('SELECT id FROM outbox').get() as { id: number }).id;
    expect(current).not.toBe(old);
    await expect(
      executeTransaction(snapshotRefusedNote('snapshot', 'n', old, now), 'alice'),
    ).rejects.toThrow('Expected one source row');
    expect(
      db().prepare('SELECT COUNT(*) AS count FROM research_note_snapshots').get(),
    ).toMatchObject({ count: 0 });
  });

  it('rejects a duplicate snapshot ID without deleting either copy or source', async () => {
    const source = await seed();
    await executeTransaction(snapshotRefusedNote('snapshot', 'n', source, now), 'alice');
    await expect(
      executeTransaction(snapshotRefusedNote('snapshot', 'n', source, now), 'alice'),
    ).rejects.toThrow();
    expect(
      db().prepare('SELECT COUNT(*) AS count FROM research_note_snapshots').get(),
    ).toMatchObject({ count: 1 });
    expect(db().prepare('SELECT title FROM notes').get()).toMatchObject({ title: 'Local draft' });
    expect(existsSync(join(dir, 'capture'))).toBe(true);
  });

  it('serializes a competing SQLite writer while the snapshot transaction is open', async () => {
    const source = await seed();
    const peer = new DatabaseSync(join(dir, 'notes.sqlite'));
    try {
      const statements = snapshotRefusedNote('snapshot', 'n', source, now);
      db().exec('BEGIN IMMEDIATE');
      for (const statement of statements) {
        const result = db()
          .prepare(statement.sql)
          .run(...((statement.params ?? []) as SQLInputValue[]));
        if (statement.expectedRowsAffected !== undefined)
          expect(Number(result.changes)).toBe(statement.expectedRowsAffected);
      }
      expect(() => peer.exec('BEGIN IMMEDIATE')).toThrow();
      db().exec('COMMIT');
      peer.prepare('UPDATE notes SET title = ? WHERE id = ?').run('Peer edit', 'n');
      expect(db().prepare(SNAPSHOT_PREVIEW_SQL).get('snapshot')).toMatchObject({
        title: 'Local draft',
      });
      expect(db().prepare('SELECT title FROM notes').get()).toMatchObject({ title: 'Peer edit' });
    } finally {
      peer.close();
    }
  });

  it('captures the committed values when the other writer goes first', async () => {
    const source = await seed();
    const peer = new DatabaseSync(join(dir, 'notes.sqlite'));
    try {
      peer.exec('BEGIN IMMEDIATE');
      peer.prepare('UPDATE notes SET title = ? WHERE id = ?').run('Peer edit', 'n');
      expect(() => db().exec('BEGIN IMMEDIATE')).toThrow();
      peer.exec('COMMIT');
      await executeTransaction(snapshotRefusedNote('snapshot', 'n', source, now), 'alice');
      expect(db().prepare(SNAPSHOT_PREVIEW_SQL).get('snapshot')).toMatchObject({
        title: 'Peer edit',
      });
    } finally {
      peer.close();
    }
  });

  it('demonstrates that real legacy capture deletion can remove bytes after a snapshot', async () => {
    const source = await seed();
    await executeTransaction(snapshotRefusedNote('snapshot', 'n', source, now), 'alice');
    await deleteNoteRecordings('n', 'alice');
    expect(state.remove).toHaveBeenCalledWith('capture');
    expect(existsSync(join(dir, 'capture'))).toBe(false);
    expect(db().prepare('SELECT audio_path FROM research_snapshot_captures').get()).toMatchObject({
      audio_path: 'audio:capture',
    });
    expect(db().prepare('SELECT COUNT(*) AS count FROM captures').get()).toMatchObject({
      count: 0,
    });
  });

  it('demonstrates that the existing account erase does not remove research snapshots', async () => {
    const source = await seed(false);
    await executeTransaction(snapshotRefusedNote('snapshot', 'n', source, now), 'alice');
    await eraseLocalAccountData('alice');
    expect(db().prepare('SELECT COUNT(*) AS count FROM notes').get()).toMatchObject({ count: 0 });
    expect(db().prepare(SNAPSHOT_PREVIEW_SQL).get('snapshot')).toMatchObject({
      title: 'Local draft',
    });
  });
});
