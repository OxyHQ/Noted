import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: vi.fn(),
  addDatabaseChangeListener: vi.fn(),
}));

import { MIGRATIONS, migrate } from '@/lib/db/migrations';
import { createDesktopDriver, type Invoke } from '@/lib/db/desktop-driver';

const sqlite = await import('node:sqlite').catch(() => null);

/**
 * Stands in for the Rust commands with a real SQLite (node's), one connection per
 * database name — the property the Rust side is built around. The Rust commands
 * have their own unit tests; this checks that the TypeScript adapter and the real
 * migrations agree with them on the contract.
 */
function fakeRust() {
  const databases = new Map<string, InstanceType<NonNullable<typeof sqlite>['DatabaseSync']>>();
  const calls: string[] = [];
  const invoke: Invoke = async <T>(command: string, args: Record<string, unknown> = {}) => {
    calls.push(command);
    const name = String(args.name);
    if (command === 'db_open') {
      if (!sqlite) throw new Error('no sqlite');
      if (!databases.has(name)) databases.set(name, new sqlite.DatabaseSync(':memory:'));
      return undefined as T;
    }
    const db = databases.get(name);
    if (!db) throw new Error('database is not open');
    const params = (args.params ?? []) as (string | number | null)[];
    switch (command) {
      case 'db_exec':
        db.exec(String(args.sql));
        return undefined as T;
      case 'db_run': {
        const result = db.prepare(String(args.sql)).run(...params);
        return {
          changes: Number(result.changes),
          lastInsertRowId: Number(result.lastInsertRowid),
        } as T;
      }
      case 'db_all':
        return db.prepare(String(args.sql)).all(...params) as T;
      case 'db_close':
        databases.delete(name);
        return undefined as T;
      default:
        throw new Error(`unknown command ${command}`);
    }
  };
  return { invoke, calls };
}

describe('desktop database driver', () => {
  if (!sqlite) {
    it.skip('needs node:sqlite, which this runtime does not provide', () => {});
    return;
  }

  it('opens, writes, reads and closes through the Rust commands', async () => {
    const { invoke, calls } = fakeRust();
    const db = await createDesktopDriver(async () => invoke).open('t.db');

    await db.execAsync('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER)');
    const insert = await db.runAsync('INSERT INTO t VALUES (?, ?)', ['a', 1]);
    expect(insert.changes).toBe(1);
    expect(await db.getAllAsync('SELECT * FROM t')).toEqual([{ id: 'a', n: 1 }]);
    expect(await db.getFirstAsync('SELECT n FROM t WHERE id = ?', ['a'])).toEqual({ n: 1 });
    expect(await db.getFirstAsync('SELECT n FROM t WHERE id = ?', ['zzz'])).toBeNull();

    await db.closeAsync();
    expect(calls[0]).toBe('db_open');
    expect(calls.at(-1)).toBe('db_close');
  });

  it('applies every real migration, and a second run is a no-op', async () => {
    const { invoke } = fakeRust();
    const db = await createDesktopDriver(async () => invoke).open('migrate.db');

    await migrate(db);
    const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(version?.user_version).toBe(MIGRATIONS.length);

    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('notes', 'folders', 'outbox')",
    );
    expect(tables.map((t) => t.name).sort()).toEqual(['folders', 'notes', 'outbox']);

    await expect(migrate(db)).resolves.toBeUndefined();
  });

  it('keeps a transaction on one connection across separate calls', async () => {
    const { invoke } = fakeRust();
    const db = await createDesktopDriver(async () => invoke).open('tx.db');
    await db.execAsync('CREATE TABLE t (v INTEGER)');

    await db.execAsync('BEGIN IMMEDIATE');
    await db.runAsync('INSERT INTO t VALUES (?)', [1]);
    await db.runAsync('INSERT INTO t VALUES (?)', [2]);
    await db.execAsync('ROLLBACK');
    expect(await db.getAllAsync('SELECT * FROM t')).toEqual([]);

    await db.execAsync('BEGIN IMMEDIATE');
    await db.runAsync('INSERT INTO t VALUES (?)', [3]);
    await db.execAsync('COMMIT');
    expect(await db.getAllAsync('SELECT * FROM t')).toEqual([{ v: 3 }]);
  });

  it("reports 0 changes for a conditional write that missed, which the engine's guard relies on", async () => {
    const { invoke } = fakeRust();
    const db = await createDesktopDriver(async () => invoke).open('cas.db');
    await db.execAsync('CREATE TABLE t (id TEXT, v INTEGER)');
    await db.runAsync('INSERT INTO t VALUES (?, ?)', ['a', 1]);
    const missed = await db.runAsync('UPDATE t SET v = 2 WHERE id = ? AND v = ?', ['a', 9]);
    expect(missed.changes).toBe(0);
  });

  it('refuses to send binary values over the bridge', async () => {
    const { invoke } = fakeRust();
    const db = await createDesktopDriver(async () => invoke).open('bin.db');
    await db.execAsync('CREATE TABLE t (x)');
    await expect(
      db.runAsync('INSERT INTO t VALUES (?)', [new Uint8Array([1, 2]) as never]),
    ).rejects.toThrow(/binary/);
  });

  it('says it has no native change events, so the engine falls back to its own', () => {
    expect(() =>
      createDesktopDriver(async () => fakeRust().invoke).addChangeListener(() => {}),
    ).toThrow(/no native change events/);
  });
});
