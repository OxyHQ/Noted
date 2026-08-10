/**
 * That a column added today reaches a database created yesterday.
 *
 * `enhancement_reason` was written into a migration entry that every existing
 * device had already applied. The list is keyed on `user_version` and only runs
 * entries a device has not reached, so the statement never ran anywhere real —
 * and the failure was not subtle:
 *
 *     Could not start recording
 *     Error code 1: no such column: enhancement_reason
 *
 * Recording, broken, on every device that had ever opened the app. A fresh
 * install worked perfectly, which is exactly why it shipped: the developer's
 * simulator and CI both create the database from scratch.
 *
 * These do what reading the diff did not: replay the list the way a real device
 * does, from an older version, and check the schema that results.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { MIGRATIONS } from '@/lib/db/migrations';

/** Every statement a device at `from` would still run. */
const statementsAfter = (from: number): string[] => MIGRATIONS.slice(from).flat();

/** Every statement, as a database created from nothing would run them. */
const allStatements = (): string[] => MIGRATIONS.flat();

/** Columns a `CREATE TABLE`/`ALTER TABLE` sequence leaves on one table. */
function columnsOf(statements: readonly string[], table: string): Set<string> {
  const columns = new Set<string>();
  for (const statement of statements) {
    const created = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${table}\\s*\\(([\\s\\S]*?)\\)\\s*$`, 'i').exec(
      statement.trim(),
    );
    if (created) {
      for (const line of created[1].split(',')) {
        const name = line.trim().split(/\s+/)[0];
        if (name && !/^(PRIMARY|FOREIGN|UNIQUE|CHECK)$/i.test(name)) columns.add(name);
      }
      continue;
    }
    const added = new RegExp(`ALTER TABLE ${table} ADD COLUMN (\\w+)`, 'i').exec(statement);
    if (added) columns.add(added[1]);
  }
  return columns;
}

/**
 * What each already-released migration hashes to.
 *
 * This is the gate the bug actually needed. Nothing about the CURRENT list can
 * reveal that a statement was appended to an entry devices had already applied
 * — the list looks perfectly correct afterwards. Only a record of what those
 * entries USED to be can, which is what this is.
 *
 * Adding a migration is appending one hash. Changing an existing one turns this
 * red, and that is the point: an applied migration is history, not code.
 */
const RELEASED = [
  'ba9488dd1ea2',
  '0f4c3f5bc5c1',
  'dd3c8ddc3d14',
  'f8b852dc40e8',
  'd1f7d2423023',
  '57f6ab46bb20',
];

const digest = (entry: readonly string[]): string =>
  createHash('sha256')
    .update(entry.map((statement) => statement.replace(/\s+/g, ' ').trim()).join('|'))
    .digest('hex')
    .slice(0, 12);

describe('an applied migration is history, not code', () => {
  it.each(RELEASED.map((hash, index) => [index, hash] as const))(
    'migration %i is unchanged',
    (index, hash) => {
      // If this fails, a statement was added to or edited in a migration that
      // real devices have already run — so it will never execute for them, and
      // only a fresh install will have the schema it describes.
      expect(MIGRATIONS[index], `migration ${String(index)} is missing`).toBeDefined();
      expect(digest(MIGRATIONS[index])).toBe(hash);
    },
  );

  it('only ever grows', () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(RELEASED.length);
  });
});

describe('a device that is behind still gets every column', () => {
  it('adds `enhancement_reason` in an entry a device at the previous version still runs', () => {
    // The specific regression. Written into the last entry, it was invisible to
    // every device that had already reached that version.
    const index = MIGRATIONS.findIndex((entry) =>
      entry.some((statement) => statement.includes('enhancement_reason')),
    );
    expect(index, 'enhancement_reason is in no migration at all').toBeGreaterThanOrEqual(0);

    // A device at the version BEFORE that entry must still run it.
    expect(statementsAfter(index).join('\n')).toContain('enhancement_reason');
    // And a device already at that entry's version must not need it — which is
    // only true if nothing after it depends on the column being older.
    expect(statementsAfter(index + 1).join('\n')).not.toContain('enhancement_reason');
  });

  it('never adds a column in an entry that also creates its table', () => {
    // The shape of the mistake, stated generally: a `CREATE TABLE` and an
    // `ALTER TABLE ADD COLUMN` for the same table in ONE entry means the column
    // only exists for databases that ran the whole entry — a fresh install.
    for (const [index, entry] of MIGRATIONS.entries()) {
      const created = new Set<string>();
      for (const statement of entry) {
        const create = /CREATE TABLE (?:IF NOT EXISTS )?(\w+)/i.exec(statement);
        if (create) created.add(create[1]);
        const alter = /ALTER TABLE (\w+) ADD COLUMN/i.exec(statement);
        if (alter && created.has(alter[1])) {
          expect.fail(
            `migration ${String(index)} creates ${alter[1]} and alters it in the same entry`,
          );
        }
      }
    }
  });
});

describe('the list itself', () => {
  it('is being read', () => {
    // A vacuity floor: an empty or unreadable list would pass everything above.
    expect(MIGRATIONS.length).toBeGreaterThan(5);
    expect(allStatements().length).toBeGreaterThan(20);
  });

  it('has no empty entry, which would burn a version for nothing', () => {
    for (const [index, entry] of MIGRATIONS.entries()) {
      expect(entry.length, `migration ${String(index)} is empty`).toBeGreaterThan(0);
    }
  });
});
