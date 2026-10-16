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

import { createLogger } from '@oxy.so/core/logger';
import type { Folder, GeneratedNoteArtifact, Label, UserItemOverride } from '@noted/shared-types';
import type { Note as NiloNote, NotesSyncPage } from '@oxy.so/nilo-contracts';

import apiClient from '@/lib/api/client';
import { API_ROUTES } from '@/lib/api/routes';
import { syncAttachmentLinks } from '@/lib/files/attachment-links';
import { oxyServices } from '@/lib/oxy';
import {
  execute,
  executeTransaction,
  getActiveViewerId,
  isDbAvailable,
  type Row,
  type Statement,
} from '@/lib/db/client';
import { replaceFolders, saveFolders } from '@/lib/db/folders-repo';
import { newNoteId } from '@/lib/db/ids';
import { replaceLabels, saveLabels } from '@/lib/db/labels-repo';
import { type GeneratedMap, type NoteBlock, plainText, renumber } from '@/lib/notes/blocks';
import { withAccountSyncLock } from '@/lib/db/web-locks';
import { eraseLocalAccountData } from '@/lib/db/erase-local';
import {
  artifactUpsertStatement,
  getNoteOverrides,
  listFinalArtifacts,
  overrideUpsertStatement,
} from '@/lib/db/artifacts-repo';
import {
  decideMerge,
  OUTBOX_MAX_ATTEMPTS,
  outboxRetryDelayMs,
  type LocalNoteState,
} from '@/lib/db/merge';

const logger = createLogger('NotedSync');

const CURSOR_KEY = 'notes_cursor';

function isCurrentViewer(viewerId: string): boolean {
  return getActiveViewerId() === viewerId && apiClient.isAccountActive(viewerId);
}

function assertCurrentViewer(viewerId: string): void {
  if (!isCurrentViewer(viewerId)) throw new Error('The active account changed during sync');
}

/** Where a failure happened, so a log line says which half of syncing broke. */
export type SyncStage = 'push' | 'pull' | 'persist' | 'links';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nowIso(): string {
  return new Date().toISOString();
}

/* ── Pull ──────────────────────────────────────────────────────── */

/** A note as Nilo sends it (`@oxy.so/nilo-contracts` `Note`). */
type ServerNote = NiloNote;

const PULL_PAGE_SIZE = 200;
/** A backstop against a server that keeps answering `hasMore` without moving. */
const PULL_MAX_PAGES = 1_000;
/** The whole-set pass in progress, kept across pages and restarts (`sync_pass`). */
const PASS_KEY = 'notes_full_pass';

interface LocalStateRow extends Row {
  id: string;
  updated_at: string;
  server_updated_at: string | null;
  dirty: number;
}

/** What Noted keeps in a note's app data on Nilo: the recorder's half. */
interface NotedAppData {
  artifacts?: GeneratedNoteArtifact[];
  itemOverrides?: UserItemOverride[];
  generated?: GeneratedMap;
}

function appDataOf(note: ServerNote): NotedAppData {
  return (note.appData?.data ?? {}) as NotedAppData;
}

/**
 * The recorder's half that arrived with a note.
 *
 * Absent means the server said nothing about it, and nothing is touched. An
 * empty array is a real answer and would clear what is here, so the two must
 * not be conflated.
 */
function generatedHalfStatements(note: ServerNote, now: string): Statement[] {
  const data = appDataOf(note);
  const statements: Statement[] = [];
  // The upsert carries the revision guard, so an artifact this device already
  // built from a newer transcript is refused by the database rather than by a
  // check here that a slow request could get past.
  for (const artifact of data.artifacts ?? []) statements.push(artifactUpsertStatement(artifact));
  for (const override of data.itemOverrides ?? []) {
    statements.push(overrideUpsertStatement(note.id, override, now));
  }
  return statements;
}

/**
 * A note the server sent, written as the agreed version: not dirty, and with
 * `server_updated_at` recording what we agreed on, which is what the next merge
 * compares against.
 */
function applyServerNoteStatements(note: ServerNote, pass: string | null): Statement[] {
  const blocks = renumber(note.blocks);
  return [
    {
      sql: `INSERT INTO notes (
              id, kind, title, blocks_json, generated_json, body_text, content_model, color,
              pinned, archived, trashed, attachments_json, reminder_at, sort_order, folder_id,
              created_at, updated_at, deleted_at, dirty, server_updated_at, app_data_revision,
              sync_pass
            ) VALUES (?, ?, ?, ?, ?, ?, 'blocks', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET
              kind = excluded.kind,
              title = excluded.title,
              blocks_json = excluded.blocks_json,
              generated_json = excluded.generated_json,
              body_text = excluded.body_text,
              content_model = 'blocks',
              color = excluded.color,
              pinned = excluded.pinned,
              archived = excluded.archived,
              trashed = excluded.trashed,
              attachments_json = excluded.attachments_json,
              reminder_at = excluded.reminder_at,
              sort_order = excluded.sort_order,
              folder_id = excluded.folder_id,
              updated_at = excluded.updated_at,
              deleted_at = NULL,
              dirty = 0,
              server_updated_at = excluded.server_updated_at,
              app_data_revision = excluded.app_data_revision,
              sync_pass = COALESCE(excluded.sync_pass, notes.sync_pass)`,
      params: [
        note.id,
        note.kind,
        note.title,
        JSON.stringify(blocks),
        JSON.stringify(appDataOf(note).generated ?? {}),
        plainText(blocks),
        note.color,
        note.pinned ? 1 : 0,
        note.archived ? 1 : 0,
        note.trashed ? 1 : 0,
        JSON.stringify(note.attachments),
        note.reminderAt,
        note.order,
        note.folderId,
        note.createdAt,
        note.updatedAt,
        note.updatedAt,
        note.appData?.revision ?? 0,
        pass,
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
 * Both sides changed. The local note keeps the id and the user's unsent edit;
 * the server's version is written as a separate note so the losing side of the
 * conflict is visible rather than discarded. It is created already dirty, so it
 * is uploaded as a note in its own right — with fresh block ids, since a block
 * belongs to one page and the server's are the original's.
 */
function conflictCopyStatements(note: ServerNote, copyId: string, now: string): Statement[] {
  const ids = new Map(note.blocks.map((block) => [block.id, newNoteId()]));
  const blocks = renumber(
    note.blocks.map((block) => ({
      ...block,
      id: ids.get(block.id) as string,
      parentBlockId: block.parentBlockId ? (ids.get(block.parentBlockId) ?? null) : null,
    })),
  );
  return [
    {
      sql: `INSERT INTO notes (
              id, kind, title, blocks_json, generated_json, body_text, content_model, color,
              pinned, archived, trashed, attachments_json, reminder_at, sort_order,
              created_at, updated_at, deleted_at, dirty, server_updated_at
            ) VALUES (?, 'note', ?, ?, '{}', ?, 'blocks', ?, 0, 0, 0, ?, NULL, ?, ?, ?, NULL, 1, NULL)`,
      params: [
        copyId,
        note.title,
        JSON.stringify(blocks),
        plainText(blocks),
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
      sql: 'UPDATE notes SET server_updated_at = ?, app_data_revision = ? WHERE id = ?',
      params: [note.updatedAt, note.appData?.revision ?? 0, note.id],
    },
  ];
}

async function readState(key: string, viewerId: string): Promise<string | null> {
  const rows = await execute<{ value: string }>(
    'SELECT value FROM sync_state WHERE key = ?',
    [key],
    viewerId,
  );
  return rows[0]?.value ?? null;
}

const writeState = (key: string, value: string | null): Statement =>
  value === null
    ? { sql: 'DELETE FROM sync_state WHERE key = ?', params: [key] }
    : {
        sql: 'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
        params: [key, value],
      };

async function readLocalStates(
  ids: readonly string[],
  viewerId: string,
): Promise<Map<string, LocalNoteState>> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(', ');
  const rows = await execute<LocalStateRow>(
    `SELECT id, updated_at, server_updated_at, dirty FROM notes WHERE id IN (${placeholders})`,
    ids,
    viewerId,
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
export async function pullNotes(
  makeConflictId: () => string,
  viewerId = getActiveViewerId(),
): Promise<{ applied: number; conflicts: number }> {
  if (!viewerId || !isDbAvailable()) return { applied: 0, conflicts: 0 };
  assertCurrentViewer(viewerId);

  // One page per round trip. Each page commits its rows and its cursor together,
  // so a failure part-way resumes from the last page instead of starting over.
  const total = { applied: 0, conflicts: 0 };
  let cursor = await readState(CURSOR_KEY, viewerId);
  for (let page = 0; page < PULL_MAX_PAGES; page += 1) {
    assertCurrentViewer(viewerId);
    const next = await pullNotesPage(cursor, makeConflictId, viewerId);
    total.applied += next.applied;
    total.conflicts += next.conflicts;
    // A server that says there is more without moving the cursor would be
    // asked the same thing forever.
    if (!next.hasMore || next.cursor === cursor) break;
    cursor = next.cursor;
  }
  return total;
}

async function pullNotesPage(
  cursor: string | null,
  makeConflictId: () => string,
  viewerId: string,
): Promise<{ applied: number; conflicts: number; hasMore: boolean; cursor: string }> {
  const response = await apiClient.get<NotesSyncPage>(API_ROUTES.notes.sync, {
    params: cursor ? { cursor, limit: PULL_PAGE_SIZE } : { limit: PULL_PAGE_SIZE },
    expectedViewerId: viewerId,
  });
  assertCurrentViewer(viewerId);
  const { notes, deleted, hasMore, full } = response.data;

  // The workspace was reset since this device last looked: what it holds of
  // the old notes is gone, unsent edits included — uploading them would bring
  // back what was reset. Dropped before this pass, which is the whole new set.
  if (response.data.reset) {
    logger.info('The workspace was reset: dropping this device’s notes');
    await eraseLocalAccountData(viewerId);
    assertCurrentViewer(viewerId);
  }

  // A whole-set pass marks every note it sees; what it never saw, and this
  // device has not changed, is gone from the server. The pass id outlives a
  // restart, so a pass resumed from its cursor keeps marking under the same id.
  let pass = full ? await readState(PASS_KEY, viewerId) : null;
  if (full && !pass) pass = newNoteId();

  const states = await readLocalStates(
    notes.map((note) => note.id),
    viewerId,
  );
  const statements: Statement[] = [];
  const now = nowIso();
  let applied = 0;
  let conflicts = 0;

  for (const note of notes) {
    const action = decideMerge(states.get(note.id) ?? null, note.updatedAt);
    if (action === 'apply') {
      statements.push(
        ...applyServerNoteStatements(note, pass),
        ...generatedHalfStatements(note, now),
      );
      applied += 1;
      continue;
    }
    if (pass) {
      statements.push({
        sql: 'UPDATE notes SET sync_pass = ? WHERE id = ?',
        params: [pass, note.id],
      });
    }
    if (action === 'skip') continue;
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

  if (!hasMore) {
    // The end of a pass: the labels and folders as they are now, and, for a
    // whole-set pass, the sweep of what it did not see.
    if (response.data.labels) statements.push(...replaceLabels(response.data.labels, now));
    if (response.data.folders) statements.push(...replaceFolders(response.data.folders, now));
    if (pass) {
      statements.push(
        {
          sql: `DELETE FROM note_labels WHERE note_id IN (
                  SELECT id FROM notes WHERE dirty = 0 AND (sync_pass IS NULL OR sync_pass != ?))`,
          params: [pass],
        },
        {
          sql: 'DELETE FROM notes WHERE dirty = 0 AND (sync_pass IS NULL OR sync_pass != ?)',
          params: [pass],
        },
      );
    }
  }

  // The cursor (and the pass) advance in the same transaction as the rows
  // they cover, so a failure re-fetches rather than skips.
  statements.push(writeState(CURSOR_KEY, response.data.cursor));
  statements.push(writeState(PASS_KEY, pass && hasMore ? pass : null));

  await executeTransaction(statements, viewerId);
  if (applied > 0 || conflicts > 0 || deleted.length > 0) {
    logger.info('Pulled changes', { applied, conflicts, deleted: deleted.length, full });
  }
  return { applied, conflicts, hasMore, cursor: response.data.cursor };
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
  updated_at: string;
  server_updated_at: string | null;
  app_data_revision: number;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * A note as the server should see it, the recorder's half included.
 *
 * Only `final` artifacts go: a `live` one is rewritten every few seconds while
 * somebody is still talking, and uploading it would be a request per slice
 * describing a recording that has not finished.
 */
async function notePayload(
  row: PushableNoteRow,
  viewerId: string,
): Promise<Record<string, unknown>> {
  const [artifacts, overrides] = await Promise.all([
    listFinalArtifacts(row.id, viewerId),
    getNoteOverrides(row.id, viewerId),
  ]);
  const data: NotedAppData = {
    artifacts,
    itemOverrides: overrides,
    generated: parseJson<GeneratedMap>(row.generated_json, {}),
  };
  return {
    title: row.title,
    blocks: parseJson<NoteBlock[]>(row.blocks_json, []),
    color: row.color,
    labels: parseJson<string[]>(row.labels_json, []),
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    trashed: row.trashed === 1,
    kind: row.kind === 'voice' ? 'voice' : 'note',
    attachments: parseJson<string[]>(row.attachments_json, []),
    reminderAt: row.reminder_at,
    order: row.sort_order,
    folderId: row.folder_id,
    appData: { data, baseRevision: row.app_data_revision },
  };
}

const PUSHABLE_NOTE_SQL = `
SELECT notes.id, notes.kind, notes.title, notes.blocks_json, notes.generated_json, notes.color,
       notes.pinned, notes.archived, notes.trashed, notes.attachments_json,
       notes.reminder_at, notes.sort_order, notes.folder_id, notes.updated_at,
       notes.server_updated_at, notes.app_data_revision,
       COALESCE((
         SELECT json_group_array(note_labels.label_id)
         FROM note_labels WHERE note_labels.note_id = notes.id
       ), '[]') AS labels_json
FROM notes WHERE notes.id = ?
`;

/** The status and code of a refused request, as the API client throws it. */
function refusal(error: unknown): { status?: number; code?: string; note?: ServerNote } {
  if (typeof error !== 'object' || error === null) return {};
  const response = (error as { response?: { status?: number; data?: unknown } }).response;
  const data = (response?.data ?? {}) as { code?: string; note?: ServerNote };
  return { status: response?.status, code: data.code, note: data.note };
}

async function pushNote(
  entityId: string,
  viewerId: string,
  makeConflictId?: () => string,
  retries = 1,
): Promise<void> {
  const row = (await execute<PushableNoteRow>(PUSHABLE_NOTE_SQL, [entityId], viewerId))[0];
  if (!row) return;

  const payload = await notePayload(row, viewerId);
  assertCurrentViewer(viewerId);
  const options = { expectedViewerId: viewerId };
  let note: ServerNote;
  try {
    if (row.server_updated_at === null) {
      // A note the server has never confirmed is created with the id it
      // already has locally; POST is idempotent on that id.
      const created = await apiClient.post<{ note: ServerNote }>(
        API_ROUTES.notes.create,
        { id: row.id, ...payload, appData: undefined },
        options,
      );
      note = created.data.note;
      // 200, not 201: the note was already there — a retry whose first answer
      // was lost, or a note copied over from the old server with this id. What
      // this device holds is written on top of it.
      if (created.status === 200) {
        note = (
          await apiClient.patch<{ note: ServerNote }>(
            API_ROUTES.notes.update(row.id),
            {
              ...payload,
              baseUpdatedAt: note.updatedAt,
              appData: {
                ...(payload.appData as object),
                baseRevision: note.appData?.revision ?? 0,
              },
            },
            options,
          )
        ).data.note;
      } else if (payload.appData) {
        note = (
          await apiClient.patch<{ note: ServerNote }>(
            API_ROUTES.notes.update(row.id),
            {
              appData: {
                ...(payload.appData as object),
                baseRevision: note.appData?.revision ?? 0,
              },
            },
            options,
          )
        ).data.note;
      }
    } else {
      // `baseUpdatedAt` is the version this edit sits on top of: the server
      // refuses to overwrite a newer one it has not been shown.
      note = (
        await apiClient.patch<{ note: ServerNote }>(
          API_ROUTES.notes.update(row.id),
          { ...payload, baseUpdatedAt: row.server_updated_at },
          options,
        )
      ).data.note;
    }
  } catch (error) {
    const { status, code, note: current } = refusal(error);
    // Deleted for good elsewhere: this device's copy goes too.
    if (status === 410) {
      await executeTransaction(
        [
          { sql: 'DELETE FROM note_labels WHERE note_id = ?', params: [row.id] },
          { sql: 'DELETE FROM notes WHERE id = ?', params: [row.id] },
        ],
        viewerId,
      );
      return;
    }
    if (status !== 409 || !current || retries <= 0) throw error;
    assertCurrentViewer(viewerId);
    if (code === 'STALE_APP_DATA') {
      // Only the recorder's half moved: take the server's (the artifact upsert
      // keeps whichever revision is newer) and send again on its revision.
      await executeTransaction(
        [
          ...generatedHalfStatements(current, nowIso()),
          {
            sql: 'UPDATE notes SET app_data_revision = ? WHERE id = ?',
            params: [current.appData?.revision ?? 0, row.id],
          },
        ],
        viewerId,
      );
      return pushNote(entityId, viewerId, makeConflictId, retries - 1);
    }
    if (!makeConflictId) throw error;
    // Same resolution as a conflicting pull: the user's unsent edit stays on
    // the note, the other device's version survives as its own note, and the
    // local note adopts the server version so the retry has a valid base.
    await executeTransaction(conflictCopyStatements(current, makeConflictId(), nowIso()), viewerId);
    return pushNote(entityId, viewerId, makeConflictId, retries - 1);
  }

  await executeTransaction(
    [
      // We now know which server version this note agrees with, whatever else has
      // happened locally in the meantime.
      {
        sql: 'UPDATE notes SET server_updated_at = ?, app_data_revision = ? WHERE id = ?',
        params: [note.updatedAt, note.appData?.revision ?? 0, row.id],
      },
      // Clear `dirty` only if nothing was typed while the request was in flight.
      // The guard compares the local timestamp against the local timestamp read
      // before sending — never against the server's, which is a different
      // machine's clock and cannot order local edits.
      {
        sql: 'UPDATE notes SET dirty = 0 WHERE id = ? AND updated_at = ?',
        params: [row.id, row.updated_at],
      },
    ],
    viewerId,
  );
}

async function pushDeletion(entityId: string, viewerId: string): Promise<void> {
  assertCurrentViewer(viewerId);
  try {
    await apiClient.delete(API_ROUTES.notes.delete(entityId), { expectedViewerId: viewerId });
  } catch (error) {
    // Already gone server-side is the outcome this entry wanted.
    if (!isNotFound(error)) throw error;
  }
  await executeTransaction(
    [{ sql: 'DELETE FROM notes WHERE id = ?', params: [entityId] }],
    viewerId,
  );
}

function isNotFound(error: unknown): boolean {
  return refusal(error).status === 404;
}

/**
 * Send everything the outbox is holding.
 *
 * Entries are processed oldest first and one at a time: two requests for the
 * same note in flight together could land out of order and make the older body
 * win.
 */
export async function flushOutbox(
  viewerId = getActiveViewerId(),
  makeConflictId?: () => string,
): Promise<{ sent: number; failed: number }> {
  if (!viewerId || !isDbAvailable()) return { sent: 0, failed: 0 };
  assertCurrentViewer(viewerId);

  const ready = await execute<OutboxRow>(
    `SELECT id, entity, entity_id, op, attempts FROM outbox
     WHERE next_attempt_at <= ? AND attempts < ?
     ORDER BY id ASC LIMIT 200`,
    [nowIso(), OUTBOX_MAX_ATTEMPTS],
    viewerId,
  );

  let sent = 0;
  let failed = 0;
  for (const entry of ready) {
    assertCurrentViewer(viewerId);
    try {
      if (entry.op === 'delete') {
        await pushDeletion(entry.entity_id, viewerId);
      } else {
        await pushNote(entry.entity_id, viewerId, makeConflictId);
      }
      // Retire the entry only if the note is settled. An edit that landed while
      // the request was in flight left this same row in place (there is one row
      // per entity), so deleting unconditionally would throw that edit's only
      // record away and it would never be sent.
      await executeTransaction(
        [
          {
            sql: `DELETE FROM outbox WHERE id = ? AND NOT EXISTS (
                  SELECT 1 FROM notes WHERE notes.id = outbox.entity_id AND notes.dirty = 1
                )`,
            params: [entry.id],
          },
        ],
        viewerId,
      );
      sent += 1;
    } catch (error) {
      assertCurrentViewer(viewerId);
      const attempts = entry.attempts + 1;
      const nextAttemptAt = new Date(Date.now() + outboxRetryDelayMs(attempts)).toISOString();
      await executeTransaction(
        [
          {
            sql: 'UPDATE outbox SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?',
            params: [attempts, errorMessage(error), nextAttemptAt, entry.id],
          },
        ],
        viewerId,
      );
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
 * Refresh the stored folders and labels from the server, whole: what changed
 * in Nilo (a label renamed there) arrives at the end of every sync pass too,
 * and this reads them on their own when only they are wanted.
 */
export async function pullFolders(viewerId = getActiveViewerId()): Promise<void> {
  if (!viewerId || !isDbAvailable()) return;
  assertCurrentViewer(viewerId);
  const response = await apiClient.get<{ folders: Folder[] }>(API_ROUTES.folders.list, {
    expectedViewerId: viewerId,
  });
  assertCurrentViewer(viewerId);
  await saveFolders(response.data.folders, viewerId);
}

export async function pullLabels(viewerId = getActiveViewerId()): Promise<void> {
  if (!viewerId || !isDbAvailable()) return;
  assertCurrentViewer(viewerId);
  const response = await apiClient.get<{ labels: Label[] }>(API_ROUTES.labels.list, {
    expectedViewerId: viewerId,
  });
  assertCurrentViewer(viewerId);
  await saveLabels(response.data.labels, viewerId);
}

/**
 * One full cycle: send local changes, then take the server's.
 *
 * Push first so a note created offline exists on the server before the pull
 * that would otherwise see no trace of it. Each stage is caught on its own: a
 * failing pull must not stop the outbox from draining on the next attempt.
 */
async function runSyncCycle(makeConflictId: () => string, viewerId: string): Promise<void> {
  if (!isCurrentViewer(viewerId)) return;
  try {
    await flushOutbox(viewerId, makeConflictId);
  } catch (error) {
    if (!isCurrentViewer(viewerId)) return;
    logger.error('Push failed', { stage: 'push' satisfies SyncStage, error: errorMessage(error) });
  }
  if (!isCurrentViewer(viewerId)) return;
  // The labels and folders arrive at the end of the pass, in the same
  // transaction as its last notes, so a note never names one this device
  // does not have yet.
  try {
    await pullNotes(makeConflictId, viewerId);
  } catch (error) {
    if (!isCurrentViewer(viewerId)) return;
    logger.error('Pull failed', { stage: 'pull' satisfies SyncStage, error: errorMessage(error) });
  }
  if (!isCurrentViewer(viewerId)) return;
  // Last, once the notes on this device agree with Nilo's: the owner's links of
  // their attachments to the note's page (`lib/files/attachment-links.ts`).
  try {
    await syncAttachmentLinks(viewerId, {
      assets: oxyServices.assets,
      execute,
      executeTransaction,
      isCurrentViewer,
    });
  } catch (error) {
    if (!isCurrentViewer(viewerId)) return;
    logger.error('Attachment links failed', {
      stage: 'links' satisfies SyncStage,
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
      const viewerId = getActiveViewerId();
      if (viewerId) {
        await withAccountSyncLock(viewerId, () => runSyncCycle(makeConflictId, viewerId));
      }
    } while (rerunRequested);
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}
