/**
 * Every table the app names must exist in the schema.
 *
 * This gate exists because of a real failure: `stt_models` was renamed to
 * `model_files` in a migration, one query in another file kept the old name, and
 * nothing caught it. `tsc` cannot see inside a SQL string, and no test that
 * exercised other code ever ran that query — it surfaced as
 * `no such table: stt_models` in front of a user, on the one screen that used it.
 *
 * A rename is exactly the change that leaves this kind of debris, and the cost
 * of finding it late is a broken feature rather than a failed build.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LOCAL_TABLES } from '@/lib/db/migrations';
import { readTables, writtenTables } from '@/lib/db/sql-tables';

const ROOT = join(import.meta.dirname, '../../..');

/** Where SQL is written. Widened when SQL appears somewhere new, never guessed. */
const SEARCHED = ['lib', 'components', 'app'];

/**
 * `migrations.ts` names tables that do not exist YET, and names an old one in
 * the comment explaining a rename. It is the file that defines the schema, so
 * checking it against itself proves nothing. This file names the removed table
 * on purpose, to prove the check can still see one.
 */
const EXCLUDED = new Set(['migrations.ts', 'schema-references.test.ts']);

/**
 * SQLite's own tables and the keywords the extractor cannot tell from a table
 * name. Kept explicit: a scanner that silently drops what it does not recognise
 * is a scanner that passes when it should fail.
 */
const NOT_APP_TABLES = new Set(['sqlite_master', 'sqlite_sequence', 'pragma']);

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (!/\.tsx?$/.test(entry) || EXCLUDED.has(entry)) continue;
    found.push(path);
  }
  return found;
}

interface Reference {
  table: string;
  file: string;
}

/**
 * String and template literals.
 *
 * Only literals, never raw file text: `readTables` looks for `from <word>`, and
 * English prose in a comment is full of it. Scanning whole files produced 144
 * "tables" with names like `the` and `everything` — a gate that cries wolf is a
 * gate the next person disables.
 */
const LITERALS = /`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g;

/**
 * A literal is SQL only on a two-token signal.
 *
 * A bare `update` matches the English sentence "Failed to update label", and the
 * extractor then reports `label` as a missing table. Requiring the second half
 * of the statement is what separates SQL from prose that happens to contain a
 * verb.
 */
const LOOKS_LIKE_SQL =
  /\bselect\b[\s\S]*\bfrom\b|\binsert\s+(?:or\s+\w+\s+)?into\b|\bupdate\b[\s\S]*\bset\b|\bdelete\s+from\b|\bcreate\s+table\b/i;

function collectReferences(): { references: Reference[]; filesScanned: number } {
  const references: Reference[] = [];
  let filesScanned = 0;

  for (const directory of SEARCHED) {
    for (const file of sourceFiles(join(ROOT, directory))) {
      filesScanned += 1;
      const contents = readFileSync(file, 'utf8');

      for (const literal of contents.match(LITERALS) ?? []) {
        const sql = literal.slice(1, -1);
        if (!LOOKS_LIKE_SQL.test(sql)) continue;
        for (const table of [...readTables(sql), ...writtenTables(sql)]) {
          if (NOT_APP_TABLES.has(table)) continue;
          references.push({ table, file: file.slice(ROOT.length + 1) });
        }
      }
    }
  }
  return { references, filesScanned };
}

describe('SQL table references', () => {
  const { references, filesScanned } = collectReferences();

  it('scans the source tree, so an empty result cannot pass', () => {
    // Without a floor, a traversal that silently found nothing looks exactly
    // like a clean run.
    expect(filesScanned).toBeGreaterThan(100);
    expect(references.length).toBeGreaterThan(10);
    expect(new Set(references.map((reference) => reference.table)).size).toBeGreaterThan(4);
  });

  it('names only tables the schema defines', () => {
    const known = new Set(LOCAL_TABLES);
    const unknown = references
      .filter((reference) => !known.has(reference.table))
      // Reported with the file, because "some table is wrong" is not actionable.
      .map((reference) => `${reference.table} (${reference.file})`);
    expect([...new Set(unknown)]).toEqual([]);
  });

  it('sees a table that does not exist', () => {
    // The mutation this gate is built to catch, pinned so a broken extractor
    // cannot report a clean tree.
    const stale = readTables("SELECT id FROM stt_models WHERE state = 'ready'");
    expect(stale.has('stt_models')).toBe(true);
    expect(new Set(LOCAL_TABLES).has('stt_models')).toBe(false);
  });
});
