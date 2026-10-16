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
  type NoteColor,
  type NoteListParams,
} from '@noted/shared-types';

import {
  execute,
  executeTransaction,
  getActiveViewerId,
  type Row,
  type Statement,
} from '@/lib/db/client';
import { deleteNoteRecordings } from '@/lib/capture/captures-repo';
import {
  adoptEdited,
  type GeneratedMap,
  mergeBlocks,
  type NoteBlock,
  plainText,
  type RenderedBlock,
  renumber,
  withGenerated,
} from '@/lib/notes/blocks';
import { newNoteId } from '@/lib/db/ids';

/** Marks a note as carrying local edits the server has not acknowledged. */
const DIRTY = 1;

/**
 * A note as this device stores it.
 *
 * Its content is `blocks` (`lib/notes/blocks.ts`), Nilo's blocks, flat.
 * `generated` says which of them the recorder wrote, so the next rebuild
 * replaces exactly those and nothing the user wrote; it syncs with the note,
 * in Noted's own data on the server.
 */
export interface LocalNote {
  id: string;
  /** `voice` for a note born from a recording, `note` for one someone opened. */
  kind: 'note' | 'voice';
  title: string;
  blocks: NoteBlock[];
  generated: GeneratedMap;
  color: NoteColor;
  labels: string[];
  pinned: boolean;
  archived: boolean;
  trashed: boolean;
  /** Oxy file ids. */
  attachments: string[];
  reminderAt: string | null;
  order: number;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteRow extends Row {
  id: string;
  kind: string;
  title: string;
  blocks_json: string;
  generated_json: string;
  color: string;
  labels_json: string;
  pinned: number;
  archived: number;
  trashed: number;
  attachments_json: string;
  reminder_at: string | null;
  sort_order: number;
  folder_id: string | null;
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

function isBlock(value: unknown): value is NoteBlock {
  if (typeof value !== 'object' || value === null) return false;
  const block = value as Record<string, unknown>;
  return (
    typeof block.id === 'string' &&
    typeof block.type === 'string' &&
    typeof block.order === 'number' &&
    (block.parentBlockId === null || typeof block.parentBlockId === 'string') &&
    typeof block.content === 'object' &&
    block.content !== null
  );
}

function parseGenerated(value: string): GeneratedMap {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: GeneratedMap = {};
    for (const [id, ref] of Object.entries(parsed as Record<string, unknown>)) {
      const key = (ref as { key?: unknown } | null)?.key;
      if (typeof key === 'string') out[id] = { key };
    }
    return out;
  } catch {
    return {};
  }
}

export function rowToNote(row: NoteRow): LocalNote {
  return {
    id: row.id,
    kind: row.kind === 'voice' ? 'voice' : 'note',
    title: row.title,
    blocks: parseJsonArray(row.blocks_json, isBlock),
    generated: parseGenerated(row.generated_json),
    color: normalizeNoteColor(row.color),
    labels: parseJsonArray(row.labels_json, isString),
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    trashed: row.trashed === 1,
    attachments: parseJsonArray(row.attachments_json, isString),
    reminderAt: row.reminder_at,
    order: row.sort_order,
    folderId: row.folder_id,
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
  notes.id, notes.kind, notes.title, notes.blocks_json, notes.generated_json,
  notes.color, notes.pinned, notes.archived, notes.trashed,
  notes.attachments_json, notes.reminder_at, notes.sort_order, notes.folder_id,
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

/** More terms than this are noise, and each one adds six scans to the query. */
const MAX_SEARCH_TERMS = 8;

/** The lowercased, de-duplicated words of a search box. */
export function searchTerms(query: string | undefined): string[] {
  if (!query) return [];
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return [...new Set(words)].slice(0, MAX_SEARCH_TERMS);
}

/** `%` and `_` in what the user typed are text, not wildcards. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
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

  if (params.folder) {
    where.push('notes.folder_id = ?');
    values.push(params.folder);
  }

  if (typeof params.pinned === 'boolean') {
    where.push('notes.pinned = ?');
    values.push(params.pinned ? 1 : 0);
  }

  for (const term of searchTerms(params.q)) {
    // LIKE rather than FTS5: the virtual table is not guaranteed to be compiled
    // into every platform's SQLite build, and a failed CREATE VIRTUAL TABLE
    // would take the whole schema down. At personal-notes volume a scan is not
    // the bottleneck; revisit if a real corpus says otherwise.
    //
    // Every term must match somewhere in the note (AND across terms, OR across
    // the places a term can live), so "budget friday" finds a note that says
    // "budget" in its title and "friday" in a transcript line.
    const pattern = `%${escapeLike(term)}%`;
    where.push(`(
      lower(notes.title) LIKE ? ESCAPE '\\'
      OR lower(notes.body_text) LIKE ? ESCAPE '\\'
      OR EXISTS (
        SELECT 1 FROM note_labels JOIN labels ON labels.id = note_labels.label_id
        WHERE note_labels.note_id = notes.id AND labels.deleted_at IS NULL
          AND lower(labels.name) LIKE ? ESCAPE '\\'
      )
      OR EXISTS (
        SELECT 1 FROM captures JOIN transcript_segments ON transcript_segments.capture_id = captures.id
        WHERE captures.note_id = notes.id AND lower(transcript_segments.text) LIKE ? ESCAPE '\\'
      )
    )`);
    values.push(pattern, pattern, pattern, pattern);
  }

  return {
    sql: `SELECT ${NOTE_COLUMNS} FROM notes WHERE ${where.join(' AND ')}
          ORDER BY notes.pinned DESC, notes.sort_order ASC, notes.updated_at DESC`,
    params: values,
  };
}

/**
 * Notes that link to `target`: a page mention of it in their blocks (how the
 * editor links a note, and how Nilo does), or the old `[[its title]]` /
 * `[[its title|label]]` text that notes written before blocks still carry.
 *
 * Computed from the content each time rather than stored: a stored link table
 * is a second copy that has to be kept in step with every edit and rename.
 */
export function backlinksQuery(target: { id: string; title: string }): NoteListQuery {
  const title = target.title.trim().toLowerCase();
  const exact = `%[[${escapeLike(title)}]]%`;
  const labelled = `%[[${escapeLike(title)}|%`;
  return {
    sql: `SELECT ${NOTE_COLUMNS} FROM notes
          WHERE notes.deleted_at IS NULL AND notes.trashed = 0 AND notes.id != ?
            AND (
              EXISTS (
                SELECT 1 FROM json_tree(notes.blocks_json)
                WHERE json_tree.key = 'id' AND json_tree.value = ?
                  AND json_tree.path LIKE '%.mention.attributes'
              )
              OR (? != '' AND (
                lower(notes.body_text) LIKE ? ESCAPE '\\' OR lower(notes.body_text) LIKE ? ESCAPE '\\'
              ))
            )
          ORDER BY notes.updated_at DESC`,
    params: [target.id, target.id, title, exact, labelled],
  };
}

export const NOTE_DETAIL_SQL = `SELECT ${NOTE_COLUMNS} FROM notes WHERE notes.id = ? AND notes.deleted_at IS NULL`;

export async function getNote(
  id: string,
  expectedViewerId?: string | null,
): Promise<LocalNote | null> {
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
  id, kind, title, blocks_json, generated_json, body_text, content_model, color,
  pinned, archived, trashed, attachments_json, reminder_at, sort_order, folder_id,
  created_at, updated_at, deleted_at, dirty, server_updated_at
) VALUES (?, ?, ?, ?, ?, ?, 'blocks', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)
ON CONFLICT (id) DO NOTHING
`;

/**
 * The fields a caller may set; everything else is derived or server-owned.
 *
 * Content has three writers, and none of them writes it whole over the
 * others. A recorded note's blocks have two authors — the person typing and
 * the recorder rebuilding every few seconds — so each names what it owns and
 * this module puts the result together against the note as it is stored:
 *
 * - `edit`, the editor's change: the blocks it started from and what they are
 *   now, merged onto the stored blocks (`mergeBlocks`), so an editor open for
 *   a minute does not erase a minute of transcript. A generated block it
 *   changed becomes the user's (`adoptEdited`).
 * - `rendered`, the recorder's blocks, replacing only its own (`withGenerated`).
 * - `blocks`, content set whole: a new note's, an import's, a restored
 *   version's. The recorder's map is cleared: nothing in it is its any more.
 */
export type NoteInput = Partial<
  Pick<
    LocalNote,
    | 'title'
    | 'color'
    | 'labels'
    | 'pinned'
    | 'archived'
    | 'trashed'
    | 'attachments'
    | 'reminderAt'
    | 'order'
    | 'folderId'
    | 'kind'
  >
> & {
  edit?: { base: readonly NoteBlock[]; next: readonly NoteBlock[] };
  rendered?: readonly RenderedBlock[];
  blocks?: readonly NoteBlock[];
};

/** The content a write lands, given the note as stored. */
export function nextContent(
  current: Pick<LocalNote, 'blocks' | 'generated'>,
  patch: Pick<NoteInput, 'edit' | 'rendered' | 'blocks'>,
): { blocks: NoteBlock[]; generated: GeneratedMap } | null {
  let blocks = patch.blocks ? renumber(patch.blocks) : current.blocks;
  let generated = patch.blocks ? {} : current.generated;
  if (patch.edit) {
    generated = adoptEdited(patch.edit.base, patch.edit.next, generated);
    blocks = mergeBlocks(patch.edit.base, patch.edit.next, blocks);
    // A generated block the merge dropped is no longer anyone's.
    const present = new Set(blocks.map((block) => block.id));
    generated = Object.fromEntries(Object.entries(generated).filter(([id]) => present.has(id)));
  }
  if (patch.rendered)
    ({ blocks, generated } = withGenerated(blocks, generated, patch.rendered, newNoteId));
  return patch.blocks || patch.edit || patch.rendered ? { blocks, generated } : null;
}

function creationStatements(note: LocalNote, now: string): Statement[] {
  return [
    {
      sql: NOTE_INSERT_SQL,
      expectedRowsAffected: 1,
      params: [
        note.id,
        note.kind,
        note.title,
        JSON.stringify(note.blocks),
        JSON.stringify(note.generated),
        plainText(note.blocks),
        note.color,
        note.pinned ? 1 : 0,
        note.archived ? 1 : 0,
        note.trashed ? 1 : 0,
        JSON.stringify(note.attachments),
        note.reminderAt,
        note.order,
        note.folderId ?? null,
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
export async function createNote(
  id: string,
  input: NoteInput,
  viewerId = getActiveViewerId(),
): Promise<LocalNote> {
  const now = nowIso();
  // Through the same assembler as every later edit, starting from an empty
  // note, so there is exactly one place content is put together.
  const content = nextContent(
    { blocks: [], generated: {} },
    { blocks: input.blocks, edit: input.edit, rendered: input.rendered },
  ) ?? { blocks: [], generated: {} };
  const note: LocalNote = {
    id,
    kind: input.kind ?? 'note',
    title: input.title ?? '',
    blocks: content.blocks,
    generated: content.generated,
    color: input.color ?? DEFAULT_NEW_NOTE_COLOR,
    labels: input.labels ?? [],
    pinned: input.pinned ?? false,
    archived: input.archived ?? false,
    trashed: input.trashed ?? false,
    attachments: input.attachments ?? [],
    reminderAt: input.reminderAt ?? null,
    order: input.order ?? 0,
    folderId: input.folderId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await executeTransaction(creationStatements(note, now), viewerId);
  } catch (error) {
    // A manual retry may follow a committed insert whose response was lost.
    // Confirm that same ID without overwriting edits made since its creation.
    if (
      !(error instanceof Error) ||
      error.message !== 'transaction statement 0 affected 0 rows; expected 1'
    )
      throw error;
    const existing = await getNote(id, viewerId);
    if (!existing)
      throw new Error(
        'This note was deleted before creation could be confirmed. Your draft has been preserved.',
      );
    return existing;
  }
  return note;
}

/**
 * Apply a partial edit.
 *
 * Only named fields are updated, so concurrent patches from different tabs do
 * not restore unrelated fields from an older read. Content is put together
 * against a snapshot of the stored blocks and compared in SQL before writing;
 * a changed snapshot rolls back the entire transaction, labels and outbox
 * included, and the write is put together again on the newer note.
 */
export async function updateNote(
  id: string,
  patch: NoteInput,
  viewerId = getActiveViewerId(),
): Promise<LocalNote | null> {
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
    set('color', patch.color);
    set('pinned', patch.pinned === undefined ? undefined : Number(patch.pinned));
    set('archived', patch.archived === undefined ? undefined : Number(patch.archived));
    set('trashed', patch.trashed === undefined ? undefined : Number(patch.trashed));
    set(
      'attachments_json',
      patch.attachments === undefined ? undefined : JSON.stringify(patch.attachments),
    );
    set('reminder_at', patch.reminderAt);
    set('sort_order', patch.order);
    set('folder_id', patch.folderId);

    const content = nextContent(current, patch);
    if (content) {
      set('blocks_json', JSON.stringify(content.blocks));
      set('generated_json', JSON.stringify(content.generated));
      set('body_text', plainText(content.blocks));
    }
    params.push(id);
    if (content) params.push(JSON.stringify(current.blocks), JSON.stringify(current.generated));

    try {
      await executeTransaction(
        [
          {
            sql: `UPDATE notes SET ${assignments.join(', ')}
                WHERE id = ? AND deleted_at IS NULL${content ? ' AND blocks_json = ? AND generated_json = ?' : ''}`,
            params,
            expectedRowsAffected: 1,
          },
          ...(patch.labels === undefined ? [] : labelStatements(id, patch.labels)),
          enqueueOutbox(id, 'upsert', now),
        ],
        viewerId,
      );
    } catch (error) {
      // This exact error proves statement 0 changed nothing and the transaction
      // rolled back. Transport loss may hide a committed write: never replay it.
      if (
        !(error instanceof Error) ||
        error.message !== 'transaction statement 0 affected 0 rows; expected 1'
      )
        throw error;
      continue;
    }
    return getNote(id, viewerId);
  }
  throw new Error(
    'This note changed while saving. Your draft has been preserved; try saving again.',
  );
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
