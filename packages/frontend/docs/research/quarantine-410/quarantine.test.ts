import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Statement } from '@/lib/db/client';
import { MIGRATIONS } from '@/lib/db/migrations';
import {
  copyConfirmedText,
  RESEARCH_PREVIEW_SQL,
  RESEARCH_READY_SQL,
  RESEARCH_SCHEMA,
  stageGone,
  type TextPreview,
} from './index';

let dir: string;
let db: DatabaseSync;
let audio: string;
const now = '2026-10-13T10:00:00.000Z';

function open(path: string): DatabaseSync {
  const handle = new DatabaseSync(path);
  for (const migration of MIGRATIONS) for (const sql of migration) handle.exec(sql);
  for (const sql of RESEARCH_SCHEMA) handle.exec(sql);
  return handle;
}

function tx(handle: DatabaseSync, statements: Statement[]): void {
  handle.exec('BEGIN IMMEDIATE');
  try {
    for (const statement of statements) {
      const result = handle
        .prepare(statement.sql)
        .run(...((statement.params ?? []) as SQLInputValue[]));
      if (
        statement.expectedRowsAffected !== undefined &&
        Number(result.changes) !== statement.expectedRowsAffected
      ) {
        throw new Error('Expected one eligible row');
      }
    }
    handle.exec('COMMIT');
  } catch (error) {
    handle.exec('ROLLBACK');
    throw error;
  }
}

function seed(handle: DatabaseSync): number {
  handle
    .prepare(`INSERT INTO notes (id,title,blocks_json,body_text,created_at,updated_at,dirty)
    VALUES ('n', 'Saved', ?, 'body', ?, ?, 1)`)
    .run('[{"id":"block"}]', now, now);
  handle
    .prepare(`INSERT INTO outbox (entity,entity_id,op,next_attempt_at,created_at)
    VALUES ('note','n','upsert',?,?)`)
    .run(now, now);
  handle
    .prepare(`INSERT INTO captures (id,note_id,state,started_at,audio_path,created_at,updated_at)
    VALUES ('c','n','done',?,?,?,?)`)
    .run(now, audio, now, now);
  return (handle.prepare('SELECT id FROM outbox').get() as { id: number }).id;
}

function preview(handle: DatabaseSync): TextPreview & { capture_count: number } {
  return handle.prepare(RESEARCH_PREVIEW_SQL).get('n') as TextPreview & { capture_count: number };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'noted-quarantine-research-'));
  audio = join(dir, 'fixture.wav');
  writeFileSync(audio, 'synthetic recorded bytes');
  db = open(join(dir, 'a.sqlite'));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('disconnected 410 quarantine model', () => {
  it('stages and reopens without changing note, outbox, capture reference or fixture file', () => {
    const id = seed(db);
    tx(db, [stageGone('n', id, now)]);
    tx(db, [stageGone('n', id, now)]);
    expect(db.prepare(RESEARCH_READY_SQL).all(now, 10)).toEqual([]);
    db.close();
    db = new DatabaseSync(join(dir, 'a.sqlite'));
    expect(preview(db)).toMatchObject({ id: 'n', title: 'Saved', capture_count: 1 });
    expect(db.prepare('SELECT audio_path FROM captures').get()).toMatchObject({
      audio_path: audio,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM outbox').get()).toMatchObject({ count: 1 });
    expect(readFileSync(audio, 'utf8')).toBe('synthetic recorded bytes');
  });

  it('requires explicit copy, keeps the original, and creates no sync intent', () => {
    const id = seed(db);
    tx(db, [stageGone('n', id, now)]);
    const selected = preview(db);
    expect(db.prepare('SELECT COUNT(*) AS count FROM research_recovered_text').get()).toMatchObject(
      { count: 0 },
    );
    tx(db, [copyConfirmedText(selected, 'draft-1', now)]);
    expect(
      db.prepare('SELECT source_note_id, title, blocks_json FROM research_recovered_text').get(),
    ).toMatchObject({ source_note_id: 'n', title: 'Saved', blocks_json: '[{"id":"block"}]' });
    expect(preview(db)).toMatchObject({ title: 'Saved', capture_count: 1 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM outbox').get()).toMatchObject({ count: 1 });
    expect(db.prepare(RESEARCH_READY_SQL).all(now, 10)).toEqual([]);
    expect(readFileSync(audio, 'utf8')).toBe('synthetic recorded bytes');
  });

  it('replays the same copy without making a second draft and rejects a reused ID', () => {
    const id = seed(db);
    tx(db, [stageGone('n', id, now)]);
    const selected = preview(db);
    tx(db, [copyConfirmedText(selected, 'draft-1', now)]);
    tx(db, [copyConfirmedText(selected, 'draft-1', now)]);
    expect(() => tx(db, [copyConfirmedText(selected, 'draft-1', 'later')])).toThrow(
      'Expected one eligible row',
    );
    expect(db.prepare('SELECT COUNT(*) AS count FROM research_recovered_text').get()).toMatchObject(
      { count: 1 },
    );
    expect(preview(db)).toMatchObject({ title: 'Saved' });
  });

  it('refuses to copy changed text and rolls back an earlier write in the transaction', () => {
    const id = seed(db);
    tx(db, [stageGone('n', id, now)]);
    const selected = preview(db);
    db.prepare('UPDATE notes SET title = ? WHERE id = ?').run('Changed elsewhere', 'n');
    expect(() =>
      tx(db, [
        { sql: 'UPDATE notes SET color = ? WHERE id = ?', params: ['blue', 'n'] },
        copyConfirmedText(selected, 'draft-1', now),
      ]),
    ).toThrow('Expected one eligible row');
    expect(db.prepare('SELECT color FROM notes').get()).toMatchObject({ color: 'default' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM research_recovered_text').get()).toMatchObject(
      { count: 0 },
    );
  });

  it('does not bind a late response to a replacement outbox row', () => {
    const old = seed(db);
    db.exec('DELETE FROM outbox');
    db.prepare(
      `INSERT INTO outbox (entity,entity_id,op,next_attempt_at,created_at) VALUES ('note','n','upsert',?,?)`,
    ).run(now, now);
    const replacement = (db.prepare('SELECT id FROM outbox').get() as { id: number }).id;
    expect(replacement).not.toBe(old);
    expect(() => tx(db, [stageGone('n', old, now)])).toThrow('Expected one eligible row');
    expect(db.prepare('SELECT COUNT(*) AS count FROM research_quarantine_410').get()).toMatchObject(
      { count: 0 },
    );
    expect(preview(db)).toBeUndefined();
  });

  it('refuses a text copy if the original is locally tombstoned after preview', () => {
    const id = seed(db);
    tx(db, [stageGone('n', id, now)]);
    const selected = preview(db);
    db.prepare('UPDATE notes SET deleted_at = ? WHERE id = ?').run(now, 'n');
    expect(preview(db)).toBeUndefined();
    expect(() => tx(db, [copyConfirmedText(selected, 'draft-1', now)])).toThrow(
      'Expected one eligible row',
    );
    expect(db.prepare('SELECT COUNT(*) AS count FROM research_recovered_text').get()).toMatchObject(
      { count: 0 },
    );
  });

  it('documents that an already created draft survives original deletion', () => {
    const id = seed(db);
    tx(db, [stageGone('n', id, now)]);
    tx(db, [copyConfirmedText(preview(db), 'draft-1', now)]);
    db.prepare('DELETE FROM notes WHERE id = ?').run('n');
    expect(db.prepare('SELECT title FROM research_recovered_text').get()).toMatchObject({
      title: 'Saved',
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM outbox').get()).toMatchObject({ count: 1 });
  });

  it('serializes SQLite writers while staging but does not fence later legacy deletion', () => {
    const id = seed(db);
    const peer = new DatabaseSync(join(dir, 'a.sqlite'));
    try {
      db.exec('BEGIN IMMEDIATE');
      const statement = stageGone('n', id, now);
      expect(
        Number(db.prepare(statement.sql).run(...(statement.params as SQLInputValue[])).changes),
      ).toBe(1);
      expect(() => peer.exec('BEGIN IMMEDIATE')).toThrow();
      db.exec('COMMIT');
      expect(peer.prepare('SELECT note_id FROM research_quarantine_410').get()).toMatchObject({
        note_id: 'n',
      });
      peer.prepare('DELETE FROM notes WHERE id = ?').run('n');
      expect(preview(db)).toBeUndefined();
    } finally {
      peer.close();
    }
  });

  it('documents that the cooperative selector also blocks a later delete intent', () => {
    const id = seed(db);
    tx(db, [stageGone('n', id, now)]);
    db.prepare('UPDATE outbox SET op = ? WHERE id = ?').run('delete', id);
    expect(db.prepare(RESEARCH_READY_SQL).all(now, 10)).toEqual([]);
    expect(db.prepare('SELECT op FROM outbox').get()).toMatchObject({ op: 'delete' });
  });

  it('does not reveal a synthetic note when using a different database', () => {
    const id = seed(db);
    tx(db, [stageGone('n', id, now)]);
    const other = open(join(dir, 'b.sqlite'));
    try {
      expect(other.prepare(RESEARCH_PREVIEW_SQL).get('n')).toBeUndefined();
      expect(() => tx(other, [copyConfirmedText(preview(db), 'draft-1', now)])).toThrow(
        'Expected one eligible row',
      );
    } finally {
      other.close();
    }
  });

  it('documents that identical content cannot establish which account authorized the copy', () => {
    const id = seed(db);
    tx(db, [stageGone('n', id, now)]);
    const selected = preview(db);
    const other = open(join(dir, 'b.sqlite'));
    try {
      const otherId = seed(other);
      tx(other, [stageGone('n', otherId, now)]);
      tx(other, [copyConfirmedText(selected, 'draft-1', now)]);
      expect(
        other.prepare('SELECT source_note_id FROM research_recovered_text').get(),
      ).toMatchObject({ source_note_id: 'n' });
    } finally {
      other.close();
    }
  });

  it('documents that a legacy selector ignores the marker', () => {
    const id = seed(db);
    tx(db, [stageGone('n', id, now)]);
    expect(db.prepare(RESEARCH_READY_SQL).all(now, 10)).toEqual([]);
    expect(
      db.prepare('SELECT id FROM outbox WHERE next_attempt_at <= ? AND attempts < ?').all(now, 10),
    ).toHaveLength(1);
  });
});
