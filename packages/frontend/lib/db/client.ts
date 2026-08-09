/**
 * Local SQLite store — the client's source of truth.
 *
 * Every read the UI performs and every write the user makes lands here first;
 * the network is a synchroniser behind it (see `lib/db/sync.ts`), never a
 * prerequisite. That is what makes capture and note editing work with no
 * connection at all.
 *
 * ## Why the asynchronous expo-sqlite API, and not the synchronous one
 *
 * expo-sqlite exposes both. The synchronous surface (`getAllSync`/`runSync`,
 * what `Mention/packages/frontend/db` is built on) reaches the worker through
 * `invokeWorkerSync`, which allocates a `SharedArrayBuffer` and blocks on
 * `Atomics.wait` — so it only runs on a cross-origin-isolated page (COOP/COEP
 * headers), which is exactly why Mention turns SQLite off on web. The
 * asynchronous surface used here never touches `SharedArrayBuffer`, and the web
 * persistence layer underneath it (`wa-sqlite`'s `AccessHandlePoolVFS`) is plain
 * OPFS. Same database, same schema, all three platforms, no hosting changes.
 */

import {
  addDatabaseChangeListener,
  openDatabaseAsync,
  type SQLiteBindValue,
  type SQLiteDatabase,
} from 'expo-sqlite';
import { createLogger } from '@oxyhq/core/logger';

import { LOCAL_TABLES, migrate } from '@/lib/db/migrations';

const logger = createLogger('NotedDB');

/** Debounce window for coalescing table-change notifications into one refresh. */
const CHANGE_FLUSH_MS = 10;

export type Row = Record<string, SQLiteBindValue>;

export interface Statement {
  sql: string;
  params?: readonly unknown[];
  /**
   * When set, the transaction aborts unless the statement affects exactly this
   * many rows — the guard that turns a silently-missed conditional UPDATE
   * (a stale-read write racing a concurrent edit) into a rollback.
   */
  expectedRowsAffected?: number;
}

export type Unsubscribe = () => void;

/* ── SQL table extraction ──────────────────────────────────────────
   A subscription re-runs when a table it reads is written. Both sides of that
   are derived from the SQL text: reads from FROM/JOIN, writes from
   INSERT/UPDATE/DELETE. */

const READ_TABLE_RE = /\b(?:from|join)\s+([^\s(,;]+)/gi;
const WRITE_TABLE_RE =
  /\b(?:insert\s+(?:or\s+\w+\s+)?into|update(?:\s+or\s+\w+)?|delete\s+from)\s+([^\s(,;]+)/gi;

function normalizeIdentifier(token: string): string | null {
  const last = token.split('.').pop() ?? token;
  const cleaned = last.replace(/^[`"[]+/, '').replace(/[`"\])]+$/, '').toLowerCase();
  return /^[a-z_][a-z0-9_]*$/.test(cleaned) ? cleaned : null;
}

function scanTables(sql: string, pattern: RegExp): Set<string> {
  const tables = new Set<string>();
  for (const match of sql.matchAll(pattern)) {
    const table = normalizeIdentifier(match[1]);
    if (table) tables.add(table);
  }
  return tables;
}

/* ── Parameter binding ─────────────────────────────────────────── */

function mapParam(value: unknown): SQLiteBindValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (value instanceof Uint8Array) return value;
  return JSON.stringify(value);
}

function mapParams(params: readonly unknown[] | undefined): SQLiteBindValue[] {
  return (params ?? []).map(mapParam);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ── Connection ────────────────────────────────────────────────────
   The database file is per account.

   Mention's cache wipes itself when the viewer changes, which is right for a
   disposable copy of the server's feed. This store is not that: it holds writes
   the server has not seen yet, so wiping on a switch would destroy the outgoing
   account's unsynced notes. A file per account gives the same guarantee for
   free — one account's rows are not merely hidden from another, they are not in
   the open database at all — and the first account's pending writes are still
   there when it comes back. */

let dbPromise: Promise<SQLiteDatabase> | null = null;
let available = true;
let activeViewerId: string | null = null;

const VIEWER_OWNER_KEY = 'viewer_id';

/**
 * Resolves once an account is active.
 *
 * Screens mount and subscribe their live queries in the same commit that starts
 * the sign-in restore, so the first queries of every cold start arrive before
 * there is a database file to open. Throwing at them made a correct startup look
 * like a failure — a burst of errors, every list empty — for something that
 * resolves a moment later on its own.
 *
 * So a query that arrives early WAITS. The alternative, gating every screen on a
 * ready flag, puts the same race in every consumer and only takes one oversight
 * to reintroduce.
 */
let viewerReady: { promise: Promise<void>; resolve: () => void } = deferred();

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * False once opening the database has failed — a browser without OPFS (private
 * windows in some engines) is the expected case. Callers degrade to the network
 * instead of retrying an open that cannot succeed for the rest of the session.
 */
export function isDbAvailable(): boolean {
  return available;
}

/** The account whose database is currently open, if any. */
export function getActiveViewerId(): string | null {
  return activeViewerId;
}

function databaseName(viewerId: string): string {
  // The id comes from the verified Oxy session, but it lands in a filename, so
  // anything outside the safe set is escaped rather than trusted.
  return `noted-${viewerId.replace(/[^a-zA-Z0-9_-]/g, '_')}.db`;
}

/**
 * Point the store at one account's database, closing any other account's first.
 *
 * Must be awaited before the first query: a query with no active viewer has no
 * file to open and throws rather than guessing.
 */
export async function setActiveViewer(viewerId: string): Promise<void> {
  if (activeViewerId === viewerId) return;
  await closeDb();
  activeViewerId = viewerId;
  available = true;
  // Releases every query that arrived before sign-in finished.
  viewerReady.resolve();
}

/** Close the database and forget the account (sign-out). */
export async function clearActiveViewer(): Promise<void> {
  await closeDb();
  activeViewerId = null;
  // A fresh gate, so queries issued after a sign-out wait for the next account
  // rather than racing against a closed database.
  viewerReady = deferred();
}

async function openDb(): Promise<SQLiteDatabase> {
  // Wait rather than fail: see `viewerReady`.
  await viewerReady.promise;
  const viewerId = activeViewerId;
  if (!viewerId) {
    throw new Error('The local database was queried before an account was active');
  }
  const db = await openDatabaseAsync(databaseName(viewerId), { enableChangeListener: true });

  // WAL keeps reads running during a write; NORMAL is the safe pairing for it.
  // A PRAGMA failing is not fatal (web's VFS does not honour all of them), so
  // each one degrades on its own rather than taking the database down.
  for (const pragma of [
    'PRAGMA journal_mode = WAL',
    'PRAGMA foreign_keys = ON',
    'PRAGMA synchronous = NORMAL',
  ]) {
    try {
      await db.execAsync(pragma);
    } catch (error) {
      logger.warn('PRAGMA failed', { pragma, error: errorMessage(error) });
    }
  }

  await migrate(db);
  await assertOwnership(db, viewerId);

  try {
    addDatabaseChangeListener((event) => {
      if (event.tableName) markTableChanged(event.tableName);
    });
  } catch (error) {
    // Not available on every platform. Write-path invalidation below already
    // covers every write this module performs, so this is an addition, not a
    // dependency.
    logger.debug('Native change listener unavailable', { error: errorMessage(error) });
  }

  return db;
}

/**
 * Verify the opened file belongs to the account that opened it.
 *
 * The filename already separates accounts, so a mismatch here means something
 * upstream is wrong (a renamed file, a recycled id, a bug in this module). It
 * fails closed: the contents are deleted before a single row can be rendered to
 * the wrong person, and the note whose sync was pending is worth less than
 * showing one account another's meeting transcript.
 */
async function assertOwnership(db: SQLiteDatabase, viewerId: string): Promise<void> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM cache_metadata WHERE key = ?',
    [VIEWER_OWNER_KEY],
  );
  if (row?.value === viewerId) return;

  if (row?.value) {
    logger.error('Local database belongs to another account — wiping', {
      expected: viewerId,
      found: row.value,
    });
    await db.execAsync('BEGIN IMMEDIATE');
    try {
      for (const table of LOCAL_TABLES) {
        await db.execAsync(`DELETE FROM ${table}`);
      }
      await db.execAsync('COMMIT');
    } catch (error) {
      await db.execAsync('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }

  await db.runAsync('INSERT OR REPLACE INTO cache_metadata (key, value) VALUES (?, ?)', [
    VIEWER_OWNER_KEY,
    viewerId,
  ]);
}

async function getDb(): Promise<SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openDb().catch((error: unknown) => {
      available = false;
      dbPromise = null;
      logger.error('Local database unavailable', { error: errorMessage(error) });
      throw error;
    });
  }
  return dbPromise;
}

/** Close the handle and drop the cached connection (account switch, tests). */
export async function closeDb(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  if (!pending) return;
  try {
    const db = await pending;
    await db.closeAsync();
  } catch (error) {
    logger.warn('Closing the database failed', { error: errorMessage(error) });
  }
}

/* ── Serial execution ──────────────────────────────────────────────
   SQLite takes one writer at a time, and an interleaved BEGIN from a second
   caller would join the first caller's transaction rather than start its own.
   Every statement therefore goes through one queue. */

let tail: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = tail.then(work, work);
  tail = result.catch(() => undefined);
  return result;
}

/* ── Change notification ───────────────────────────────────────── */

interface Subscription {
  sql: string;
  params: SQLiteBindValue[];
  tables: Set<string>;
  active: boolean;
  reportedError: string | null;
  onData: (rows: Row[]) => void;
  onError: ((message: string) => void) | undefined;
}

const subscriptions = new Set<Subscription>();
const pendingTables = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function markTableChanged(table: string): void {
  pendingTables.add(table.toLowerCase());
  if (flushTimer === null) {
    flushTimer = setTimeout(flushTableChanges, CHANGE_FLUSH_MS);
  }
}

function markWrittenTables(sql: string): void {
  for (const table of scanTables(sql, WRITE_TABLE_RE)) markTableChanged(table);
}

function flushTableChanges(): void {
  flushTimer = null;
  const changed = new Set(pendingTables);
  pendingTables.clear();
  for (const subscription of subscriptions) {
    for (const table of subscription.tables) {
      if (changed.has(table)) {
        void refresh(subscription);
        break;
      }
    }
  }
}

async function refresh(subscription: Subscription): Promise<void> {
  try {
    const db = await getDb();
    const rows = await enqueue(() => db.getAllAsync<Row>(subscription.sql, subscription.params));
    if (!subscription.active) return;
    subscription.reportedError = null;
    subscription.onData(rows);
  } catch (error) {
    const message = errorMessage(error);
    // Only report a given failure once: a broken query would otherwise log on
    // every write to the tables it reads.
    if (subscription.reportedError !== message) {
      subscription.reportedError = message;
      logger.error('Live query refresh failed', { sql: subscription.sql, error: message });
    }
    if (subscription.active) subscription.onError?.(message);
  }
}

/* ── Public API ────────────────────────────────────────────────── */

/** Run a statement and return its rows. */
export async function execute<T extends Row = Row>(
  sql: string,
  params?: readonly unknown[],
): Promise<T[]> {
  const db = await getDb();
  const rows = await enqueue(() => db.getAllAsync<T>(sql, mapParams(params)));
  markWrittenTables(sql);
  return rows;
}

async function runTransaction(statements: readonly Statement[]): Promise<number[]> {
  const db = await getDb();
  // IMMEDIATE takes the write lock up front, so a busy database fails here
  // rather than half-way through the statements.
  await db.execAsync('BEGIN IMMEDIATE');
  const affected: number[] = [];
  try {
    for (const [index, statement] of statements.entries()) {
      const result = await db.runAsync(statement.sql, mapParams(statement.params));
      if (
        statement.expectedRowsAffected !== undefined &&
        result.changes !== statement.expectedRowsAffected
      ) {
        throw new Error(
          `transaction statement ${index} affected ${result.changes} rows; expected ${statement.expectedRowsAffected}`,
        );
      }
      affected.push(result.changes);
    }
    await db.execAsync('COMMIT');
  } catch (error) {
    try {
      await db.execAsync('ROLLBACK');
    } catch (rollbackError) {
      logger.warn('Transaction rollback failed', { error: errorMessage(rollbackError) });
    }
    throw error;
  } finally {
    // Also after a rollback: a subscriber that consumed a change event emitted
    // mid-transaction must re-query rather than keep the phantom state.
    for (const statement of statements) markWrittenTables(statement.sql);
  }
  return affected;
}

/** Run statements atomically, returning the rows affected by each. */
export function executeTransaction(statements: readonly Statement[]): Promise<number[]> {
  return enqueue(() => runTransaction(statements));
}

/**
 * Run `sql` now and again whenever a table it reads is written.
 *
 * A query with no readable table (`SELECT 1`) never re-runs; that is a caller
 * mistake rather than a silent no-op, so it is logged.
 */
export async function subscribe<T extends Row = Row>(
  sql: string,
  params: readonly unknown[],
  handlers: { onData: (rows: T[]) => void; onError?: (message: string) => void },
): Promise<Unsubscribe> {
  const boundParams = mapParams(params);
  const tables = scanTables(sql, READ_TABLE_RE);
  if (tables.size === 0) {
    logger.warn('Live query has no reactive dependencies', { sql });
  }

  const subscription: Subscription = {
    sql,
    params: boundParams,
    tables,
    active: true,
    reportedError: null,
    onData: handlers.onData as (rows: Row[]) => void,
    onError: handlers.onError,
  };
  if (tables.size > 0) subscriptions.add(subscription);

  try {
    const db = await getDb();
    const rows = await enqueue(() => db.getAllAsync<T>(sql, boundParams));
    if (subscription.active) handlers.onData(rows);
  } catch (error) {
    const message = errorMessage(error);
    subscription.reportedError = message;
    logger.error('Live query failed', { sql, error: message });
    if (subscription.active) handlers.onError?.(message);
  }

  return () => {
    subscription.active = false;
    subscriptions.delete(subscription);
  };
}
