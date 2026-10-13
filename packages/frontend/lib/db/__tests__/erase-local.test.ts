import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  execute: vi.fn(),
  executeTransaction: vi.fn(),
  getActiveViewerId: () => null,
}));
vi.mock('@/lib/capture/captures-repo', () => ({ deleteNoteRecordings: vi.fn() }));

import { ACCOUNT_DATA_TABLES, eraseStatements } from '@/lib/db/erase-local';
import { LOCAL_TABLES, MIGRATIONS } from '@/lib/db/migrations';

const sqlite = await import('node:sqlite').catch(() => null);

/** What describes the phone rather than the person. */
const DEVICE_TABLES = ['app_settings', 'model_files', 'cache_metadata'];

describe('erasing an account from the device', () => {
  it('covers every table the schema owns except device preferences', () => {
    // A table added later and forgotten here would survive an account erase, so
    // this fails the moment the two lists drift apart.
    expect([...ACCOUNT_DATA_TABLES].sort()).toEqual(
      LOCAL_TABLES.filter((table) => !DEVICE_TABLES.includes(table)).sort(),
    );
  });

  it('removes children before the rows they reference', () => {
    const order = eraseStatements().map((s) => s.sql.replace('DELETE FROM ', ''));
    expect(order.indexOf('captures')).toBeLessThan(order.indexOf('notes'));
    expect(order.indexOf('note_labels')).toBeLessThan(order.indexOf('labels'));
  });

  if (!sqlite) {
    it.skip('needs node:sqlite, which this runtime does not provide', () => {});
    return;
  }

  it('empties the account tables, including the outbox, and keeps device settings', () => {
    const db = new sqlite.DatabaseSync(':memory:');
    for (const migration of MIGRATIONS) for (const statement of migration) db.exec(statement);
    const now = '2026-10-13T00:00:00.000Z';
    db.prepare('INSERT INTO notes (id, created_at, updated_at) VALUES (?, ?, ?)').run(
      'n',
      now,
      now,
    );
    db.prepare(
      "INSERT INTO outbox (entity, entity_id, op, payload_json, attempts, next_attempt_at, created_at) VALUES ('note','n','upsert','{}',0,?,?)",
    ).run(now, now);
    db.prepare('INSERT INTO folders (id, name, updated_at) VALUES (?, ?, ?)').run('f', 'F', now);
    db.prepare("INSERT INTO sync_state (key, value) VALUES ('cursor', 'x')").run();
    db.prepare("INSERT INTO app_settings (key, value_json) VALUES ('stt.model', '\"base\"')").run();

    for (const { sql } of eraseStatements()) db.exec(sql);

    for (const table of ACCOUNT_DATA_TABLES) {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      expect(row.n, table).toBe(0);
    }
    const kept = db.prepare('SELECT COUNT(*) AS n FROM app_settings').get() as { n: number };
    expect(kept.n).toBe(1);
  });
});
