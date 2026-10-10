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

import { execute, executeTransaction, getActiveViewerId, type Row, type Statement } from '@/lib/db/client';
import { deleteNoteRecordings } from '@/lib/capture/captures-repo';
import { nextNoteBody } from '@/lib/notes/generated-body';

/** Marks a note as carrying local edits the server has not acknowledged. */
const DIRTY = 1;

/**
 * A note as this device stores it: the shared DTO plus the bookkeeping that
 * never leaves the machine.
 *
 * `generatedBody` is the half of `body` the app composed. It is local by
 * construction — the server has the note's body and no business knowing which
 * part of it the app wrote — and it is what lets the next writer replace its own
 * previous output instead of preserving it as something the user typed.
 */
export interface LocalNote extends Note {
  /** `voice` for a note born from a recording, `note` for one someone opened. */
  kind: 'note' | 'voice';
  /** The part of `body` the app composed, exactly as last written. */
  generatedBody: string;
}

export interface NoteRow extends Row {
  id: string;
  kind: string;
  title: string;
  body: string;
  generated_body: string;
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

export function rowToNote(row: NoteRow): LocalNote {
  return {
    id: row.id,
    kind: row.kind === 'voice' ? 'voice' : 'note',
    title: row.title,
    body: row.body,
    generatedBody: row.generated_body,
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

export function rowsToNotes(rows: readonly NoteRow[]): LocalNote[] {
  return rows.map(rowToNote);
}

export function firstRowToNote(rows: readonly NoteRow[]): LocalNote | null {
  const row = rows[0];
  return row ? rowToNote(row) : null;
}

/* ── Reads ─────────────────────────────────────────────────────── */

// `labels_json` is assembled from the join table rather than stored twice, so a
// label removed anywhere disappears from every note that referenced it. The
// subquery also registers `note_labels` as a read dependency, which is what
// makes a label change re-run this query.
const NOTE_COLUMNS = `
  notes.id, notes.kind, notes.title, notes.body, notes.generated_body, notes.body_format,
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

export async function getNote(id: string, expectedViewerId?: string | null): Promise<LocalNote | null> {
  return firstRowToNote(await execute<NoteRow>(NOTE_DETAIL_SQL, [id], expectedViewerId));
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

const NOTE_INSERT_SQL = `
INSERT INTO notes (
  id, kind, title, body, generated_body, body_format, checklist_json, color,
  pinned, archived, trashed, attachments_json, reminder_at, sort_order,
  created_at, updated_at, deleted_at, dirty, server_updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)
ON CONFLICT (id) DO NOTHING
`;

/**
 * The fields a caller may set; everything else is derived or server-owned.
 *
 * `body` is deliberately absent, and its absence is the point. A recorded note's
 * body has two authors — the person typing and the structurer running every few
 * seconds — so no caller holds a version of it that is safe to write whole. Each
 * one names the half it owns and this module assembles the result, which is what
 * keeps an editor that has been open for a minute from erasing a minute of
 * transcript. See `lib/notes/generated-body.ts`.
 */
export type NoteInput = Partial<
  Pick<
    Note,
    | 'title'
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
> & {
  kind?: 'note' | 'voice';
  /** What the user wrote. On a note nobody recorded, that is the whole body. */
  userBody?: string;
  /** What the app wrote. Only the capture writers set this. */
  generatedBody?: string;
};

function creationStatements(note: LocalNote, now: string): Statement[] {
  return [
    {
      sql: NOTE_INSERT_SQL,
      expectedRowsAffected: 1,
      params: [
        note.id,
        note.kind,
        note.title,
        note.body,
        note.generatedBody,
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
export async function createNote(id: string, input: NoteInput, viewerId = getActiveViewerId()): Promise<LocalNote> {
  const now = nowIso();
  // Through the same assembler as every later edit, starting from a note with
  // neither half written yet, so there is exactly one place a body is composed.
  const body = nextNoteBody(
    { body: '', generatedBody: '' },
    { userBody: input.userBody ?? '', generatedBody: input.generatedBody },
  );
  const note: LocalNote = {
    id,
    kind: input.kind ?? 'note',
    title: input.title ?? '',
    body: body.body,
    generatedBody: body.generatedBody,
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
  try {
    await executeTransaction(creationStatements(note, now), viewerId);
  } catch (error) {
    // A manual retry may follow a committed insert whose response was lost.
    // Confirm that same ID without overwriting edits made since its creation.
    if (!(error instanceof Error) || error.message !== 'transaction statement 0 affected 0 rows; expected 1') throw error;
    const existing = await getNote(id, viewerId);
    if (!existing) throw new Error('This note was deleted before creation could be confirmed. Your draft has been preserved.');
    return existing;
  }
  return note;
}

/**
 * Apply a partial edit.
 *
 * Only named fields are updated, so concurrent patches from different tabs do
 * not restore unrelated fields from an older read. Body halves are assembled
 * against a snapshot and compared in SQL before writing; a changed snapshot
 * rolls back the entire transaction, including labels and the outbox.
 */
export async function updateNote(id: string, patch: NoteInput, viewerId = getActiveViewerId()): Promise<LocalNote | null> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await getNote(id, viewerId);
    if (!current) return null;

    const now = nowIso();
    const assignments = ['dirty = ?', 'updated_at = ?'];
    const params: unknown[] = [DIRTY, now];
    const set = (column: string, value: unknown) => {
      if (value === undefined) return;
      assignments.push(`${column} = ?`);
      params.push(value);
    };
    set('kind', patch.kind);
    set('title', patch.title);
    set('checklist_json', patch.checklist === undefined ? undefined : JSON.stringify(patch.checklist));
    set('color', patch.color);
    set('pinned', patch.pinned === undefined ? undefined : Number(patch.pinned));
    set('archived', patch.archived === undefined ? undefined : Number(patch.archived));
    set('trashed', patch.trashed === undefined ? undefined : Number(patch.trashed));
    set('attachments_json', patch.attachments === undefined ? undefined : JSON.stringify(patch.attachments));
    set('reminder_at', patch.reminderAt);
    set('sort_order', patch.order);

    const changesBody = patch.userBody !== undefined || patch.generatedBody !== undefined;
    if (changesBody) {
      const body = nextNoteBody(current, patch);
      set('body', body.body);
      set('generated_body', body.generatedBody);
    }
    params.push(id);
    if (changesBody) params.push(current.body, current.generatedBody);

    try {
      await executeTransaction([
        {
          sql: `UPDATE notes SET ${assignments.join(', ')}
                WHERE id = ? AND deleted_at IS NULL${changesBody ? ' AND body = ? AND generated_body = ?' : ''}`,
          params,
          expectedRowsAffected: 1,
        },
        ...(patch.labels === undefined ? [] : labelStatements(id, patch.labels)),
        enqueueOutbox(id, 'upsert', now),
      ], viewerId);
    } catch (error) {
      // This exact error proves statement 0 changed nothing and the transaction
      // rolled back. Transport loss may hide a committed write: never replay it.
      if (!(error instanceof Error) || error.message !== 'transaction statement 0 affected 0 rows; expected 1') throw error;
      continue;
    }
    return getNote(id, viewerId);
  }
  throw new Error('This note changed while saving. Your draft has been preserved; try saving again.');
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
export async function deleteNote(id: string): Promise<number[]> {
  const now = nowIso();
  // The recordings go first. A note is the only thing that points at them, so
  // tombstoning the note without this leaves a device holding the audio and the
  // transcript of a meeting its owner deleted, with nothing left to find them by.
  await deleteNoteRecordings(id).catch(() => undefined);
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
