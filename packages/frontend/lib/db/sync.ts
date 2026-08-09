/**
 * The bridge between the local store and the API.
 *
 * Two halves, each of which must be safe to interrupt at any point:
 * - **push**: drain the outbox, one entity at a time, with backoff.
 * - **pull**: ask the server what changed since the last cursor and merge it.
 *
 * Nothing on the UI's write path waits for either. A user who never regains
 * connectivity keeps a fully working app; a user who does gets their notes
 * uploaded without noticing.
 */

import { createLogger } from '@oxyhq/core/logger';
import type { Label, Note } from '@noted/shared-types';

import apiClient from '@/lib/api/client';
import { API_ROUTES } from '@/lib/api/routes';
import {
  execute,
  executeTransaction,
  isDbAvailable,
  type Row,
  type Statement,
} from '@/lib/db/client';
import { saveLabels } from '@/lib/db/labels-repo';
import {
  decideMerge,
  OUTBOX_MAX_ATTEMPTS,
  outboxRetryDelayMs,
  type LocalNoteState,
} from '@/lib/db/merge';

const logger = createLogger('NotedSync');

const CURSOR_KEY = 'notes_cursor';

/** Where a failure happened, so a log line says which half of syncing broke. */
export type SyncStage = 'push' | 'pull' | 'persist';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nowIso(): string {
  return new Date().toISOString();
}

/* ── Pull ──────────────────────────────────────────────────────── */

interface SyncResponse {
  data: Note[];
  deleted: string[];
  serverTime: string;
}

interface LocalStateRow extends Row {
  id: string;
  updated_at: string;
  server_updated_at: string | null;
  dirty: number;
}

/**
 * A note the server sent, written as the agreed version: not dirty, and with
 * `server_updated_at` recording what we agreed on, which is what the next merge
 * compares against.
 */
function applyServerNoteStatements(note: Note): Statement[] {
  return [
    {
      sql: `INSERT INTO notes (
              id, kind, title, body, body_format, checklist_json, color, pinned,
              archived, trashed, attachments_json, reminder_at, sort_order,
              created_at, updated_at, deleted_at, dirty, server_updated_at
            ) VALUES (?, 'note', ?, ?, 'plain', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)
            ON CONFLICT (id) DO UPDATE SET
              title = excluded.title,
              body = excluded.body,
              checklist_json = excluded.checklist_json,
              color = excluded.color,
              pinned = excluded.pinned,
              archived = excluded.archived,
              trashed = excluded.trashed,
              attachments_json = excluded.attachments_json,
              reminder_at = excluded.reminder_at,
              sort_order = excluded.sort_order,
              updated_at = excluded.updated_at,
              deleted_at = NULL,
              dirty = 0,
              server_updated_at = excluded.server_updated_at`,
      params: [
        note.id,
        note.title,
        note.body,
        JSON.stringify(note.checklist),
        note.color,
        note.pinned ? 1 : 0,
        note.archived ? 1 : 0,
        note.trashed ? 1 : 0,
        JSON.stringify(note.attachments),
        note.reminderAt,
        note.order,
        note.createdAt,
        note.updatedAt,
        note.updatedAt,
      ],
    },
    { sql: 'DELETE FROM note_labels WHERE note_id = ?', params: [note.id] },
    ...note.labels.map((labelId) => ({
      sql: 'INSERT OR IGNORE INTO note_labels (note_id, label_id) VALUES (?, ?)',
      params: [note.id, labelId],
    })),
  ];
}

/**
 * Both sides changed. The local note keeps the id and the user's unsent text;
 * the server's version is written as a separate note so the losing side of the
 * conflict is visible rather than discarded. It is created already dirty, so it
 * is uploaded as a note in its own right.
 */
function conflictCopyStatements(note: Note, copyId: string, now: string): Statement[] {
  return [
    {
      sql: `INSERT INTO notes (
              id, kind, title, body, body_format, checklist_json, color, pinned,
              archived, trashed, attachments_json, reminder_at, sort_order,
              created_at, updated_at, deleted_at, dirty, server_updated_at
            ) VALUES (?, 'note', ?, ?, 'plain', ?, ?, 0, 0, 0, ?, NULL, ?, ?, ?, NULL, 1, NULL)`,
      params: [
        copyId,
        note.title,
        note.body,
        JSON.stringify(note.checklist),
        note.color,
        JSON.stringify(note.attachments),
        note.order,
        note.createdAt,
        now,
      ],
    },
    {
      sql: `INSERT INTO outbox (entity, entity_id, op, payload_json, attempts, next_attempt_at, created_at)
            VALUES ('note', ?, 'upsert', '{}', 0, ?, ?)
            ON CONFLICT (entity, entity_id) DO UPDATE SET op = 'upsert', attempts = 0, next_attempt_at = excluded.next_attempt_at`,
      params: [copyId, now, now],
    },
    // The local note now agrees with the server about a version it has seen, so
    // the next pull of an unchanged server note stops re-conflicting.
    {
      sql: 'UPDATE notes SET server_updated_at = ? WHERE id = ?',
      params: [note.updatedAt, note.id],
    },
  ];
}

async function readCursor(): Promise<string | null> {
  const rows = await execute<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [
    CURSOR_KEY,
  ]);
  return rows[0]?.value ?? null;
}

async function readLocalStates(ids: readonly string[]): Promise<Map<string, LocalNoteState>> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(', ');
  const rows = await execute<LocalStateRow>(
    `SELECT id, updated_at, server_updated_at, dirty FROM notes WHERE id IN (${placeholders})`,
    ids,
  );
  return new Map(
    rows.map((row) => [
      row.id,
      { updatedAt: row.updated_at, serverUpdatedAt: row.server_updated_at, dirty: row.dirty === 1 },
    ]),
  );
}

/**
 * Fetch and merge everything the server has changed since the last pull.
 *
 * `makeConflictId` mints the id for a conflict copy; it is a parameter so the
 * caller owns id generation (and tests can make it deterministic).
 */
export async function pullNotes(makeConflictId: () => string): Promise<{ applied: number; conflicts: number }> {
  if (!isDbAvailable()) return { applied: 0, conflicts: 0 };

  const cursor = await readCursor();
  const response = await apiClient.get<SyncResponse>(API_ROUTES.notes.sync, {
    params: cursor ? { since: cursor } : {},
  });
  const { data, deleted, serverTime } = response.data;

  const states = await readLocalStates(data.map((note) => note.id));
  const statements: Statement[] = [];
  const now = nowIso();
  let applied = 0;
  let conflicts = 0;

  for (const note of data) {
    const action = decideMerge(states.get(note.id) ?? null, note.updatedAt);
    if (action === 'skip') continue;
    if (action === 'apply') {
      statements.push(...applyServerNoteStatements(note));
      applied += 1;
      continue;
    }
    statements.push(...conflictCopyStatements(note, makeConflictId(), now));
    conflicts += 1;
  }

  for (const id of deleted) {
    // A deletion performed elsewhere is deliberate and wins over unsent local
    // edits (see `shouldApplyDeletion`). The row goes entirely: the server
    // already knows, so there is nothing left to push.
    statements.push(
      { sql: 'DELETE FROM note_labels WHERE note_id = ?', params: [id] },
      { sql: 'DELETE FROM outbox WHERE entity = ? AND entity_id = ?', params: ['note', id] },
      { sql: 'DELETE FROM notes WHERE id = ?', params: [id] },
    );
  }

  // The cursor advances in the same transaction as the rows it covers, so a
  // failure re-fetches rather than skips.
  statements.push({
    sql: 'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    params: [CURSOR_KEY, serverTime],
  });

  await executeTransaction(statements);
  if (applied > 0 || conflicts > 0 || deleted.length > 0) {
    logger.info('Pulled changes', { applied, conflicts, deleted: deleted.length });
  }
  return { applied, conflicts };
}

/* ── Push ──────────────────────────────────────────────────────── */

interface OutboxRow extends Row {
  id: number;
  entity: string;
  entity_id: string;
  op: string;
  attempts: number;
}

interface PushableNoteRow extends Row {
  id: string;
  title: string;
  body: string;
  checklist_json: string;
  color: string;
  labels_json: string;
  pinned: number;
  archived: number;
  trashed: number;
  attachments_json: string;
  reminder_at: string | null;
  sort_order: number;
  updated_at: string;
  server_updated_at: string | null;
}

function parseArray(value: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function notePayload(row: PushableNoteRow): Record<string, unknown> {
  return {
    title: row.title,
    body: row.body,
    checklist: parseArray(row.checklist_json),
    color: row.color,
    labels: parseArray(row.labels_json),
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    trashed: row.trashed === 1,
    attachments: parseArray(row.attachments_json),
    reminderAt: row.reminder_at,
    order: row.sort_order,
  };
}

const PUSHABLE_NOTE_SQL = `
SELECT notes.id, notes.title, notes.body, notes.checklist_json, notes.color,
       notes.pinned, notes.archived, notes.trashed, notes.attachments_json,
       notes.reminder_at, notes.sort_order, notes.updated_at, notes.server_updated_at,
       COALESCE((
         SELECT json_group_array(note_labels.label_id)
         FROM note_labels WHERE note_labels.note_id = notes.id
       ), '[]') AS labels_json
FROM notes WHERE notes.id = ?
`;

async function pushNote(entityId: string): Promise<void> {
  const row = (await execute<PushableNoteRow>(PUSHABLE_NOTE_SQL, [entityId]))[0];
  if (!row) return;

  // A note the server has never confirmed is created with the id it already has
  // locally; POST is idempotent on that id, so a retry after a lost response
  // returns the existing note instead of duplicating it.
  const note =
    row.server_updated_at === null
      ? (await apiClient.post<Note>(API_ROUTES.notes.create, { id: row.id, ...notePayload(row) })).data
      : (await apiClient.patch<Note>(API_ROUTES.notes.update(row.id), notePayload(row))).data;

  await executeTransaction([
    // We now know which server version this note agrees with, whatever else has
    // happened locally in the meantime.
    {
      sql: 'UPDATE notes SET server_updated_at = ? WHERE id = ?',
      params: [note.updatedAt, row.id],
    },
    // Clear `dirty` only if nothing was typed while the request was in flight.
    // The guard compares the local timestamp against the local timestamp read
    // before sending — never against the server's, which is a different
    // machine's clock and cannot order local edits.
    {
      sql: 'UPDATE notes SET dirty = 0 WHERE id = ? AND updated_at = ?',
      params: [row.id, row.updated_at],
    },
  ]);
}

async function pushDeletion(entityId: string): Promise<void> {
  try {
    await apiClient.delete(API_ROUTES.notes.delete(entityId));
  } catch (error) {
    // Already gone server-side is the outcome this entry wanted.
    if (!isNotFound(error)) throw error;
  }
  await executeTransaction([{ sql: 'DELETE FROM notes WHERE id = ?', params: [entityId] }]);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { response?: { status?: number } }).response?.status === 404
  );
}

/**
 * Send everything the outbox is holding.
 *
 * Entries are processed oldest first and one at a time: two requests for the
 * same note in flight together could land out of order and make the older body
 * win.
 */
export async function flushOutbox(): Promise<{ sent: number; failed: number }> {
  if (!isDbAvailable()) return { sent: 0, failed: 0 };

  const ready = await execute<OutboxRow>(
    `SELECT id, entity, entity_id, op, attempts FROM outbox
     WHERE next_attempt_at <= ? AND attempts < ?
     ORDER BY id ASC LIMIT 200`,
    [nowIso(), OUTBOX_MAX_ATTEMPTS],
  );

  let sent = 0;
  let failed = 0;
  for (const entry of ready) {
    try {
      if (entry.op === 'delete') {
        await pushDeletion(entry.entity_id);
      } else {
        await pushNote(entry.entity_id);
      }
      // Retire the entry only if the note is settled. An edit that landed while
      // the request was in flight left this same row in place (there is one row
      // per entity), so deleting unconditionally would throw that edit's only
      // record away and it would never be sent.
      await executeTransaction([
        {
          sql: `DELETE FROM outbox WHERE id = ? AND NOT EXISTS (
                  SELECT 1 FROM notes WHERE notes.id = outbox.entity_id AND notes.dirty = 1
                )`,
          params: [entry.id],
        },
      ]);
      sent += 1;
    } catch (error) {
      const attempts = entry.attempts + 1;
      const nextAttemptAt = new Date(Date.now() + outboxRetryDelayMs(attempts)).toISOString();
      await executeTransaction([
        {
          sql: 'UPDATE outbox SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?',
          params: [attempts, errorMessage(error), nextAttemptAt, entry.id],
        },
      ]);
      failed += 1;
      logger.warn('Outbox entry failed', {
        stage: 'push' satisfies SyncStage,
        entityId: entry.entity_id,
        attempts,
        error: errorMessage(error),
      });
    }
  }
  return { sent, failed };
}

/**
 * Refresh the stored labels from the server.
 *
 * A whole-list replace rather than an incremental pull: a user has a handful of
 * labels, and the server's list is the only way to learn that one was deleted
 * elsewhere (labels carry no tombstone).
 */
export async function pullLabels(): Promise<void> {
  if (!isDbAvailable()) return;
  const response = await apiClient.get<{ data: Label[] }>(API_ROUTES.labels.list);
  await saveLabels(response.data.data);
}

/**
 * One full cycle: send local changes, then take the server's.
 *
 * Push first so a note created offline exists on the server before the pull
 * that would otherwise see no trace of it. Each stage is caught on its own: a
 * failing pull must not stop the outbox from draining on the next attempt, and
 * labels failing must not cost the notes their sync.
 */
async function runSyncCycle(makeConflictId: () => string): Promise<void> {
  try {
    await flushOutbox();
  } catch (error) {
    logger.error('Push failed', { stage: 'push' satisfies SyncStage, error: errorMessage(error) });
  }
  try {
    await pullNotes(makeConflictId);
  } catch (error) {
    logger.error('Pull failed', { stage: 'pull' satisfies SyncStage, error: errorMessage(error) });
  }
  try {
    await pullLabels();
  } catch (error) {
    logger.error('Label pull failed', {
      stage: 'pull' satisfies SyncStage,
      error: errorMessage(error),
    });
  }
}

/** The cycle currently running, or null when nothing is syncing. */
let inFlight: Promise<void> | null = null;
/** Something asked to sync while a cycle was running, so run once more after it. */
let rerunRequested = false;

/**
 * One full cycle, and never two at once.
 *
 * Syncing is triggered from four places that routinely fire together — the
 * store mounting, the app coming to the foreground, the network reconnecting,
 * and a socket event — and debouncing each of them separately does not stop two
 * from overlapping. Two cycles at once is not merely wasteful, it is wrong:
 * `flushOutbox` reads the ready entries and then sends them, so a second drain
 * that starts in that window sends the same entries again. The second copy of a
 * deletion arrives after the note is already gone and comes back `404`, and two
 * pulls both read the cursor before either writes it, so both process the same
 * tombstones. That is exactly what a console full of red `DELETE … 404` lines
 * and a repeated `deleted: 43` is showing.
 *
 * A request arriving mid-cycle is not dropped — it is collapsed into a single
 * follow-up run, because the trigger did carry information (something changed)
 * and the running cycle may already have read past it.
 */
export function syncNotes(makeConflictId: () => string): Promise<void> {
  if (inFlight) {
    rerunRequested = true;
    return inFlight;
  }

  inFlight = (async () => {
    do {
      // Cleared before the cycle, not after: a request that arrives while this
      // one runs must survive into the next iteration.
      rerunRequested = false;
      await runSyncCycle(makeConflictId);
    } while (rerunRequested);
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}
