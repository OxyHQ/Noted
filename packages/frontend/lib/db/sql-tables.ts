/**
 * Which tables a statement touches, read from the SQL itself.
 *
 * Used for two things. At runtime, a live query re-runs when a table it READS is
 * written, and both halves of that are derived here. In the test suite, the same
 * extraction checks that every table named anywhere in the app actually exists
 * in the schema — a rename leaves stale SQL that `tsc` cannot see and no test
 * exercising other code will ever hit.
 *
 * Pure and free of `expo-sqlite` on purpose: the gate has to run in node.
 */

const READ_TABLE_RE = /\b(?:from|join)\s+([^\s(,;]+)/gi;
const WRITE_TABLE_RE =
  /\b(?:insert\s+(?:or\s+\w+\s+)?into|update(?:\s+or\s+\w+)?|delete\s+from)\s+([^\s(,;]+)/gi;

/**
 * Words that follow a matched keyword but name no table.
 *
 * `ON CONFLICT (key) DO UPDATE SET x = 1` matches the UPDATE pattern and hands
 * back `set`. Left in, the runtime invalidates a table that does not exist —
 * harmless only because nothing subscribes to it — and any check built on this
 * extraction reports a table the schema will never define.
 */
const KEYWORDS = new Set([
  'set',
  'where',
  'values',
  'select',
  'from',
  'into',
  'table',
  'or',
  'and',
]);

/** Strip quoting and schema prefixes; null when the token is not an identifier. */
export function normalizeIdentifier(token: string): string | null {
  const last = token.split('.').pop() ?? token;
  const cleaned = last.replace(/^[`"[]+/, '').replace(/[`"\])]+$/, '').toLowerCase();
  if (!/^[a-z_][a-z0-9_]*$/.test(cleaned)) return null;
  return KEYWORDS.has(cleaned) ? null : cleaned;
}

function scan(sql: string, pattern: RegExp): Set<string> {
  const tables = new Set<string>();
  for (const match of sql.matchAll(pattern)) {
    const table = normalizeIdentifier(match[1]);
    if (table) tables.add(table);
  }
  return tables;
}

/** Tables the statement reads (`FROM`, `JOIN`). */
export function readTables(sql: string): Set<string> {
  return scan(sql, READ_TABLE_RE);
}

/** Tables the statement writes (`INSERT INTO`, `UPDATE`, `DELETE FROM`). */
export function writtenTables(sql: string): Set<string> {
  return scan(sql, WRITE_TABLE_RE);
}
