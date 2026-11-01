/** SQLite research: the statements are disconnected from production sync. */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Statement } from '@/lib/db/client';
import { MIGRATIONS } from '@/lib/db/migrations';
import {
  canConsiderSending,
  guardedEnqueue,
  OUTBOX_PREFLIGHT_SQL,
  RESEARCH_MIGRATION,
  recordVerifiedGeneration,
} from '@/lib/db/research/outbox-generation';

let directory: string;
let db: DatabaseSync;

function transaction(statements: readonly Statement[]): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const statement of statements) {
      const result = db
        .prepare(statement.sql)
        .run(...((statement.params ?? []) as SQLInputValue[]));
      if (
        statement.expectedRowsAffected !== undefined &&
        Number(result.changes) !== statement.expectedRowsAffected
      ) {
        throw new Error('generation guard rejected edit');
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function setGeneration(generation: string): void {
  transaction(recordVerifiedGeneration(generation));
}

function preflight(generation: string | null) {
  const row = db.prepare(OUTBOX_PREFLIGHT_SQL).get(generation, generation) as {
    total: number;
    blocked: number;
    current: number;
  };
  return { ...row, mayConsider: canConsiderSending(generation, row) };
}

function edit(id: string, title: string): void {
  transaction([
    {
      sql: 'UPDATE notes SET title = ? WHERE id = ?',
      params: [title, id],
      expectedRowsAffected: 1,
    },
    guardedEnqueue(id, 'upsert', '2026-01-01'),
  ]);
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'noted-outbox-research-'));
  db = new DatabaseSync(join(directory, 'account.sqlite'));
  for (const migration of MIGRATIONS) for (const statement of migration) db.exec(statement);
});

afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('disconnected outbox generation experiment', () => {
  it('keeps legacy outbox, note, capture reference and an unrelated file through upgrade and reopen', () => {
    const audio = join(directory, 'audio-fixture');
    writeFileSync(audio, 'fixture');
    db.prepare(
      "INSERT INTO notes (id, title, created_at, updated_at) VALUES ('legacy', 'offline', 'now', 'now')",
    ).run();
    db.prepare(
      "INSERT INTO captures (id, note_id, state, started_at, audio_path, created_at, updated_at) VALUES ('capture', 'legacy', 'complete', 'now', ?, 'now', 'now')",
    ).run(audio);
    db.exec(
      "INSERT INTO outbox (entity, entity_id, op, payload_json, next_attempt_at, created_at) VALUES ('note', 'legacy', 'upsert', '{\"old\":true}', 'now', 'now')",
    );
    for (const sql of RESEARCH_MIGRATION) db.exec(sql);
    setGeneration('new');
    expect(preflight('new')).toMatchObject({ total: 1, blocked: 1, mayConsider: false });
    db.close();
    db = new DatabaseSync(join(directory, 'account.sqlite'));
    expect(db.prepare("SELECT title FROM notes WHERE id = 'legacy'").get()).toMatchObject({
      title: 'offline',
    });
    expect(
      db
        .prepare(
          "SELECT payload_json, generation, generation_mixed FROM outbox WHERE entity_id = 'legacy'",
        )
        .get(),
    ).toMatchObject({ payload_json: '{"old":true}', generation: null, generation_mixed: 1 });
    expect(db.prepare("SELECT audio_path FROM captures WHERE id = 'capture'").get()).toMatchObject({
      audio_path: audio,
    });
    expect(readFileSync(audio, 'utf8')).toBe('fixture');
    expect(() => edit('legacy', 'later')).toThrow('generation guard');
    expect(db.prepare("SELECT title FROM notes WHERE id = 'legacy'").get()).toMatchObject({
      title: 'offline',
    });
  });

  it('captures the generation with the edit and rejects stale edits with a complete rollback', () => {
    for (const sql of RESEARCH_MIGRATION) db.exec(sql);
    db.exec(
      "INSERT INTO notes (id, title, created_at, updated_at) VALUES ('note', 'original', 'now', 'now')",
    );
    setGeneration('A');
    edit('note', 'A edit');
    expect(preflight('A')).toMatchObject({ total: 1, blocked: 0, mayConsider: true });
    edit('note', 'A second edit');
    expect(preflight('B').mayConsider).toBe(false);
    setGeneration('B');
    expect(preflight('B')).toMatchObject({ total: 1, blocked: 1, mayConsider: false });
    expect(() => edit('note', 'B edit')).toThrow('generation guard');
    setGeneration('A');
    expect(preflight('A')).toMatchObject({ blocked: 1, mayConsider: false });
    expect(db.prepare("SELECT title FROM notes WHERE id = 'note'").get()).toMatchObject({
      title: 'A second edit',
    });
  });

  it('keeps an offline new intent unknown after a later verified generation', () => {
    for (const sql of RESEARCH_MIGRATION) db.exec(sql);
    db.exec(
      "INSERT INTO notes (id, title, created_at, updated_at) VALUES ('note', 'first', 'now', 'now')",
    );
    edit('note', 'offline');
    expect(preflight(null).mayConsider).toBe(false);
    setGeneration('A');
    expect(preflight('A').mayConsider).toBe(false);
    expect(() => edit('note', 'overwritten')).toThrow('generation guard');
    expect(db.prepare("SELECT title FROM notes WHERE id = 'note'").get()).toMatchObject({
      title: 'offline',
    });
  });

  it('rolls back generation and block markers together when the update fails', () => {
    for (const sql of RESEARCH_MIGRATION) db.exec(sql);
    db.exec(
      "INSERT INTO notes (id, title, created_at, updated_at) VALUES ('note', 'first', 'now', 'now')",
    );
    setGeneration('A');
    edit('note', 'edited');
    db.exec(
      "CREATE TRIGGER fail_generation BEFORE UPDATE ON sync_state BEGIN SELECT RAISE(ABORT, 'failed'); END",
    );
    expect(() => setGeneration('B')).toThrow('failed');
    expect(
      db.prepare("SELECT value FROM sync_state WHERE key = 'notes_generation'").get(),
    ).toMatchObject({ value: 'A' });
    expect(
      db.prepare("SELECT generation_mixed FROM outbox WHERE entity_id = 'note'").get(),
    ).toMatchObject({ generation_mixed: 0 });
  });

  it('rejects a missing or unrecorded generation even for an empty outbox', () => {
    for (const sql of RESEARCH_MIGRATION) db.exec(sql);
    expect(preflight(null).mayConsider).toBe(false);
    expect(preflight('  ').mayConsider).toBe(false);
    expect(() => setGeneration('  ')).toThrow('verified generation');
    expect(preflight('A').mayConsider).toBe(false);
    setGeneration('A');
    expect(preflight('A').mayConsider).toBe(true);
    expect(preflight('B').mayConsider).toBe(false);
  });

  it('shows that a previously computed preflight cannot stop an already prepared request', () => {
    for (const sql of RESEARCH_MIGRATION) db.exec(sql);
    db.exec(
      "INSERT INTO notes (id, title, created_at, updated_at) VALUES ('note', 'first', 'now', 'now')",
    );
    setGeneration('A');
    edit('note', 'offline');
    const previousDecision = preflight('A').mayConsider;
    setGeneration('B');
    expect(previousDecision).toBe(true);
    expect(preflight('B').mayConsider).toBe(false);
  });

  it('serializes competing SQLite writers, but does not authorize a later network request', () => {
    for (const sql of RESEARCH_MIGRATION) db.exec(sql);
    db.exec(
      "INSERT INTO notes (id, title, created_at, updated_at) VALUES ('note', 'first', 'now', 'now')",
    );
    setGeneration('A');
    edit('note', 'A edit');
    const other = new DatabaseSync(join(directory, 'account.sqlite'));
    try {
      db.exec('BEGIN IMMEDIATE');
      db.prepare('UPDATE outbox SET generation_mixed = 1 WHERE generation != ?').run('B');
      expect(() => other.exec('BEGIN IMMEDIATE')).toThrow();
      db.prepare("UPDATE sync_state SET value = 'B' WHERE key = 'notes_generation'").run();
      db.exec('COMMIT');
      expect(preflight('B').mayConsider).toBe(false);
      expect(() => edit('note', 'late A edit')).toThrow('generation guard');
      expect(db.prepare("SELECT title FROM notes WHERE id = 'note'").get()).toMatchObject({
        title: 'A edit',
      });
    } finally {
      other.close();
    }
  });

  it('marks a committed competing edit before adopting the next generation', () => {
    for (const sql of RESEARCH_MIGRATION) db.exec(sql);
    db.exec(
      "INSERT INTO notes (id, title, created_at, updated_at) VALUES ('note', 'first', 'now', 'now')",
    );
    setGeneration('A');
    const other = new DatabaseSync(join(directory, 'account.sqlite'));
    try {
      other.exec('BEGIN IMMEDIATE');
      other.prepare("UPDATE notes SET title = 'offline' WHERE id = 'note'").run();
      const intent = guardedEnqueue('note', 'upsert', '2026-01-01');
      expect(
        Number(other.prepare(intent.sql).run(...(intent.params as SQLInputValue[])).changes),
      ).toBe(1);
      expect(() => setGeneration('B')).toThrow();
      other.exec('COMMIT');
      setGeneration('B');
      expect(preflight('B')).toMatchObject({ total: 1, blocked: 1, mayConsider: false });
      expect(db.prepare("SELECT title FROM notes WHERE id = 'note'").get()).toMatchObject({
        title: 'offline',
      });
    } finally {
      other.close();
    }
  });
});
