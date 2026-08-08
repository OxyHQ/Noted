/**
 * Notes, read from and written to the local store.
 *
 * Every screen reads through here and every edit lands here first, marked
 * `dirty` and paired with an outbox row in the same transaction. Nothing on this
 * path awaits the network: `lib/db/sync.ts` drains the outbox afterwards.
 */

import {
  DEFAULT_NEW_NOTE_COLOR,
  normalizeNoteColor,
  type ChecklistItem,
  type Note,
  type NoteListParams,
} from '@noted/shared-types';

import { execute, executeTransaction, type Row, type Statement } from '@/lib/db/client';

/** Marks a note as carrying local edits the server has not acknowledged. */
const DIRTY = 1;

export interface NoteRow extends Row {
  id: string;
  kind: string;
  title: string;
  body: string;
  body_format: string;
  checklist_json: string;
  color: string;
  labels_json: string;
  pinned: number;
  archived: number;
  trashed: number;
  attachments_json: string;
  reminder_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/* ── Row ↔ DTO ─────────────────────────────────────────────────── */

function parseJsonArray<T>(value: string, isItem: (item: unknown) => item is T): T[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isItem) : [];
  } catch {
    // A malformed JSON column is a corrupt row, not a crash: the note still
    // renders with that field empty and the next save rewrites it.
    return [];
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isChecklistItem(value: unknown): value is ChecklistItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && typeof item.text === 'string' && typeof item.checked === 'boolean';
}

export function rowToNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    checklist: parseJsonArray(row.checklist_json, isChecklistItem),
    color: normalizeNoteColor(row.color),
    labels: parseJsonArray(row.labels_json, isString),
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    trashed: row.trashed === 1,
    attachments: parseJsonArray(row.attachments_json, isString),
    reminderAt: row.reminder_at,
    order: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowsToNotes(rows: readonly NoteRow[]): Note[] {
  return rows.map(rowToNote);
}

export function firstRowToNote(rows: readonly NoteRow[]): Note | null {
  const row = rows[0];
  return row ? rowToNote(row) : null;
}

/* ── Reads ─────────────────────────────────────────────────────── */

// `labels_json` is assembled from the join table rather than stored twice, so a
// label removed anywhere disappears from every note that referenced it. The
// subquery also registers `note_labels` as a read dependency, which is what
// makes a label change re-run this query.
const NOTE_COLUMNS = `
  notes.id, notes.kind, notes.title, notes.body, notes.body_format,
  notes.checklist_json, notes.color, notes.pinned, notes.archived, notes.trashed,
  notes.attachments_json, notes.reminder_at, notes.sort_order,
  notes.created_at, notes.updated_at,
  COALESCE((
    SELECT json_group_array(note_labels.label_id)
    FROM note_labels WHERE note_labels.note_id = notes.id
  ), '[]') AS labels_json
`;

export interface NoteListQuery {
  sql: string;
  params: unknown[];
}

/**
 * Build the SQL for a filtered note list.
 *
 * Returned rather than executed so `useLiveQuery` can subscribe to it; the
 * parameters are values only, never interpolated text.
 */
export function noteListQuery(params: NoteListParams): NoteListQuery {
  const view = params.view ?? 'active';
  const where: string[] = ['notes.deleted_at IS NULL'];
  const values: unknown[] = [];

  if (view === 'trashed') {
    where.push('notes.trashed = 1');
  } else if (view === 'archived') {
    where.push('notes.trashed = 0', 'notes.archived = 1');
  } else {
    where.push('notes.trashed = 0', 'notes.archived = 0');
  }

  if (params.label) {
    where.push(
      'EXISTS (SELECT 1 FROM note_labels WHERE note_labels.note_id = notes.id AND note_labels.label_id = ?)',
    );
    values.push(params.label);
  }

  if (typeof params.pinned === 'boolean') {
    where.push('notes.pinned = ?');
    values.push(params.pinned ? 1 : 0);
  }

  const search = params.q?.trim();
  if (search) {
    // LIKE rather than FTS5: the virtual table is not guaranteed to be compiled
    // into every platform's SQLite build, and a failed CREATE VIRTUAL TABLE
    // would take the whole schema down. At personal-notes volume a scan over
    // two columns is not the bottleneck; revisit if a real corpus says otherwise.
    where.push('(lower(notes.title) LIKE ? OR lower(notes.body) LIKE ?)');
    const pattern = `%${search.toLowerCase()}%`;
    values.push(pattern, pattern);
  }

  return {
    sql: `SELECT ${NOTE_COLUMNS} FROM notes WHERE ${where.join(' AND ')}
          ORDER BY notes.pinned DESC, notes.sort_order ASC, notes.updated_at DESC`,
    params: values,
  };
}

export const NOTE_DETAIL_SQL = `SELECT ${NOTE_COLUMNS} FROM notes WHERE notes.id = ? AND notes.deleted_at IS NULL`;

export async function getNote(id: string): Promise<Note | null> {
  return firstRowToNote(await execute<NoteRow>(NOTE_DETAIL_SQL, [id]));
}

/* ── Writes ────────────────────────────────────────────────────── */

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Queue an intent for the syncer. `upsert` carries no payload because the
 * flusher reads the note's current row when it sends — that is what lets
 * repeated edits collapse into one request.
 */
function enqueueOutbox(
  entityId: string,
  op: 'upsert' | 'delete',
  now: string,
  entity = 'note',
): Statement {
  return {
    sql: `INSERT INTO outbox (entity, entity_id, op, payload_json, attempts, next_attempt_at, created_at)
          VALUES (?, ?, ?, '{}', 0, ?, ?)
          ON CONFLICT (entity, entity_id) DO UPDATE SET
            op = excluded.op,
            attempts = 0,
            last_error = NULL,
            next_attempt_at = excluded.next_attempt_at`,
    params: [entity, entityId, op, now, now],
  };
}

function labelStatements(noteId: string, labels: readonly string[]): Statement[] {
  return [
    { sql: 'DELETE FROM note_labels WHERE note_id = ?', params: [noteId] },
    ...labels.map((labelId) => ({
      sql: 'INSERT OR IGNORE INTO note_labels (note_id, label_id) VALUES (?, ?)',
      params: [noteId, labelId],
    })),
  ];
}

const NOTE_UPSERT_SQL = `
INSERT INTO notes (
  id, kind, title, body, body_format, checklist_json, color, pinned, archived,
  trashed, attachments_json, reminder_at, sort_order, created_at, updated_at,
  deleted_at, dirty, server_updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)
ON CONFLICT (id) DO UPDATE SET
  kind = excluded.kind,
  title = excluded.title,
  body = excluded.body,
  body_format = excluded.body_format,
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
  dirty = excluded.dirty
`;

/** The fields a caller may set; everything else is derived or server-owned. */
export type NoteInput = Partial<
  Pick<
    Note,
    | 'title'
    | 'body'
    | 'checklist'
    | 'color'
    | 'labels'
    | 'pinned'
    | 'archived'
    | 'trashed'
    | 'attachments'
    | 'reminderAt'
    | 'order'
  >
> & { kind?: 'note' | 'voice' };

function upsertStatements(note: Note, kind: string, now: string): Statement[] {
  return [
    {
      sql: NOTE_UPSERT_SQL,
      params: [
        note.id,
        kind,
        note.title,
        note.body,
        'plain',
        JSON.stringify(note.checklist),
        note.color,
        note.pinned ? 1 : 0,
        note.archived ? 1 : 0,
        note.trashed ? 1 : 0,
        JSON.stringify(note.attachments),
        note.reminderAt,
        note.order,
        note.createdAt,
        now,
        DIRTY,
      ],
    },
    ...labelStatements(note.id, note.labels),
    enqueueOutbox(note.id, 'upsert', now),
  ];
}

/** Insert a note that only exists locally so far. */
export async function createNote(id: string, input: NoteInput): Promise<Note> {
  const now = nowIso();
  const note: Note = {
    id,
    title: input.title ?? '',
    body: input.body ?? '',
    checklist: input.checklist ?? [],
    color: input.color ?? DEFAULT_NEW_NOTE_COLOR,
    labels: input.labels ?? [],
    pinned: input.pinned ?? false,
    archived: input.archived ?? false,
    trashed: input.trashed ?? false,
    attachments: input.attachments ?? [],
    reminderAt: input.reminderAt ?? null,
    order: input.order ?? 0,
    createdAt: now,
    updatedAt: now,
  };
  await executeTransaction(upsertStatements(note, input.kind ?? 'note', now));
  return note;
}

/**
 * Apply a partial edit.
 *
 * The current row is read first so the write carries a whole note; the read and
 * the write are not atomic, but every writer is this process and the outbox
 * sends the row as it stands at flush time, so a lost interleaving costs at most
 * one redundant push.
 */
export async function updateNote(id: string, patch: NoteInput): Promise<Note | null> {
  const current = await getNote(id);
  if (!current) return null;

  const now = nowIso();
  const next: Note = {
    ...current,
    ...patch,
    color: patch.color ?? current.color,
    reminderAt: patch.reminderAt === undefined ? current.reminderAt : patch.reminderAt,
    updatedAt: now,
  };
  await executeTransaction(upsertStatements(next, patch.kind ?? 'note', now));
  return next;
}

/** Move a note to the trash (recoverable). */
export function trashNote(id: string): Promise<number[]> {
  const now = nowIso();
  return executeTransaction([
    {
      sql: 'UPDATE notes SET trashed = 1, dirty = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
      params: [DIRTY, now, id],
    },
    enqueueOutbox(id, 'upsert', now),
  ]);
}

/** Take a note back out of the trash. */
export function restoreNote(id: string): Promise<number[]> {
  const now = nowIso();
  return executeTransaction([
    {
      sql: 'UPDATE notes SET trashed = 0, dirty = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
      params: [DIRTY, now, id],
    },
    enqueueOutbox(id, 'upsert', now),
  ]);
}

/**
 * Delete forever.
 *
 * The row is tombstoned rather than removed: the deletion still has to reach the
 * server, and until the outbox drains, the tombstone is the only record that it
 * was asked for. `lib/db/sync.ts` removes the row once the server confirms.
 */
export function deleteNote(id: string): Promise<number[]> {
  const now = nowIso();
  return executeTransaction([
    {
      sql: 'UPDATE notes SET deleted_at = ?, dirty = ?, updated_at = ? WHERE id = ?',
      params: [now, DIRTY, now, id],
    },
    { sql: 'DELETE FROM note_labels WHERE note_id = ?', params: [id] },
    enqueueOutbox(id, 'delete', now),
  ]);
}

/** Persist a drag-reorder. Positions are the index within `ids`. */
export function reorderNotes(ids: readonly string[]): Promise<number[]> {
  const now = nowIso();
  return executeTransaction([
    ...ids.map((id, index) => ({
      sql: 'UPDATE notes SET sort_order = ?, dirty = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
      params: [index, DIRTY, now, id],
    })),
    ...ids.map((id) => enqueueOutbox(id, 'upsert', now)),
  ]);
}
