import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import {
  and,
  arrayContains,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  sql,
} from 'drizzle-orm';
import { isLiveEntityId } from '@oxy.so/db';
import { requireOxyAuth, getRequiredOxyUserId } from '@oxy.so/core/server';
import { normalizeNoteColor } from '@noted/shared-types';

import { authenticateToken } from '../middleware/auth.js';
import { getDb, type Transaction } from '../db/postgres.js';
import { notes } from '../db/schema/notes.js';
import { serializeNote } from '../lib/serializers.js';
import {
  artifactsWriteSchema,
  deleteGeneratedHalf,
  notesWithGeneratedChangesSince,
  overridesWriteSchema,
  readGeneratedHalf,
  upsertArtifacts,
  upsertOverrides,
} from '../lib/note-artifacts.js';
import {
  changesText,
  deleteRevisionsOf,
  getRevision,
  listRevisions,
  restoreRevision,
  snapshotBeforeEdit,
  textOf,
} from '../lib/note-revisions.js';
import { makeRateLimiter } from '../lib/rate-limit.js';
import { cutSyncPage, parseSyncLimit, SYNC_MAX_LIMIT, type SyncPage } from '../lib/sync-page.js';
import { emitNoteCreated, emitNoteUpdated, emitNoteDeleted } from '../socket.js';
import { log } from '../lib/logger.js';
import { enqueueNoteChangedEvent, type NoteChange } from '../capabilities/noted.events.js';

const router = Router();

// Scoped limiters — each gets a distinct `rl:<scope>:` Redis prefix.
const readLimiter = makeRateLimiter('notes:read');
const writeLimiter = makeRateLimiter('notes:write');

// ── Validation schemas ─────────────────────────────────────────────

const checklistItemSchema = z.object({
  id: z.string(),
  text: z.string().default(''),
  checked: z.boolean().default(false),
});

/**
 * A note id chosen by the client (offline creation).
 *
 * Strict UUIDv7, not `isLiveEntityId`: that helper also accepts a 24-character
 * ObjectId so repositories mid-migration keep working, and this database has
 * never held one. Accepting both here would let a client decide which id format
 * the table stores.
 */
const clientNoteIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  .optional();

/** Per-note ceilings on the list fields. Generous on purpose: a limit a real note
 * could hit would 400 the same outbox entry forever, so these only stop abuse. */
export const NOTE_LIMITS = {
  checklist: 5_000,
  labels: 100,
  attachments: 100,
  idLength: 200,
} as const;

export const noteWriteSchema = z
  .object({
    title: z.string().max(1000),
    body: z.string().max(100_000),
    checklist: z.array(checklistItemSchema).max(NOTE_LIMITS.checklist),
    // Tolerant of legacy palette values: any string is coerced to a valid
    // NoteColor (darkblue→blue, amber→pumpkin, gray/unknown→default) instead of
    // being rejected, so a client echoing an old color in a PATCH never 400s.
    color: z.string().transform(normalizeNoteColor),
    labels: z.array(z.string().max(NOTE_LIMITS.idLength)).max(NOTE_LIMITS.labels),
    pinned: z.boolean(),
    archived: z.boolean(),
    trashed: z.boolean(),
    // Oxy file-manager file IDs (any file type).
    attachments: z.array(z.string().max(NOTE_LIMITS.idLength)).max(NOTE_LIMITS.attachments),
    reminderAt: z.string().datetime().nullable(),
    order: z.number(),
    /**
     * The server `updatedAt` this edit was made on top of. When present, a PATCH
     * only applies if the note is still at that version; otherwise it is
     * answered with 409 and the current note, so a stale device cannot silently
     * overwrite what another one wrote. Absent means "last write wins", which
     * is what writers without a base (capabilities, older clients) get.
     */
    baseUpdatedAt: z.string().datetime().optional(),
    /**
     * The generated half, sent with the note rather than on endpoints of its
     * own — a note that arrived without its overrides would render generated
     * text the user had already edited away.
     */
    artifacts: artifactsWriteSchema,
    itemOverrides: overridesWriteSchema,
  })
  .partial();

type NoteWrite = z.infer<typeof noteWriteSchema>;

/**
 * Map the wire contract onto columns.
 *
 * `order` → `sortOrder` and `reminderAt` → a `Date` are the only shape changes;
 * everything else is named identically on both sides. Fields the caller did not
 * send stay absent so a PATCH never overwrites what it did not mention.
 */
function toColumns(input: NoteWrite): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  if (input.title !== undefined) columns.title = input.title;
  if (input.body !== undefined) columns.body = input.body;
  if (input.checklist !== undefined) columns.checklist = input.checklist;
  if (input.color !== undefined) columns.color = input.color;
  if (input.labels !== undefined) columns.labels = input.labels;
  if (input.pinned !== undefined) columns.pinned = input.pinned;
  if (input.archived !== undefined) columns.archived = input.archived;
  if (input.trashed !== undefined) columns.trashed = input.trashed;
  if (input.attachments !== undefined) columns.attachments = input.attachments;
  if (input.order !== undefined) columns.sortOrder = input.order;
  if (input.reminderAt !== undefined) {
    columns.reminderAt = input.reminderAt ? new Date(input.reminderAt) : null;
    // A new or changed reminder must be eligible for delivery again.
    columns.reminderQueuedAt = null;
    columns.reminderSentAt = null;
  }
  return columns;
}

/** `updatedAt` is ours to move, not the caller's — every write touches it. */
function touched(columns: Record<string, unknown>): Record<string, unknown> {
  return { ...columns, updatedAt: new Date() };
}

async function enqueueRouteNoteChange(
  transaction: Transaction,
  note: { id: string; updatedAt: Date },
  accountId: string,
  change: NoteChange,
): Promise<void> {
  const revision = note.updatedAt.toISOString();
  await enqueueNoteChangedEvent(transaction, {
    accountId,
    noteId: note.id,
    change,
    idempotencyKey: `route:${randomUUID()}`,
    occurredAt: revision,
  });
}

function noteChangeForPatch(input: NoteWrite): NoteChange {
  if (input.trashed === true) return 'trashed';
  if (input.archived === true) return 'archived';
  if (input.trashed === false || input.archived === false) return 'restored';
  return 'updated';
}

/**
 * Write whatever generated half the caller sent, and nothing it did not.
 *
 * The distinction is the point: a client PATCHing a colour sends neither field,
 * and must not thereby erase a recording's structure. Absent means "I have
 * nothing to say about this", which is not the same as an empty array.
 */
async function writeGeneratedHalf(noteId: string, userId: string, input: NoteWrite): Promise<void> {
  if (input.artifacts) await upsertArtifacts(noteId, userId, input.artifacts);
  if (input.itemOverrides) await upsertOverrides(noteId, userId, input.itemOverrides);
}

router.use(authenticateToken, requireOxyAuth);

// GET /notes?view=active|archived|trashed&label=<id>&pinned=<bool>&q=<text>
router.get('/', readLimiter, async (req: Request, res: Response) => {
  try {
    const oxyUserId = getRequiredOxyUserId(req);

    const view =
      req.query.view === 'archived' || req.query.view === 'trashed' ? req.query.view : 'active';

    const filters = [eq(notes.oxyUserId, oxyUserId), isNull(notes.deletedAt)];
    if (view === 'trashed') {
      filters.push(eq(notes.trashed, true));
    } else if (view === 'archived') {
      filters.push(eq(notes.trashed, false), eq(notes.archived, true));
    } else {
      filters.push(eq(notes.trashed, false), eq(notes.archived, false));
    }

    if (typeof req.query.label === 'string' && req.query.label) {
      filters.push(arrayContains(notes.labels, [req.query.label]));
    }
    if (req.query.pinned === 'true' || req.query.pinned === 'false') {
      filters.push(eq(notes.pinned, req.query.pinned === 'true'));
    }
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      // `plainto_tsquery` treats the input as words to match, never as query
      // syntax, so a user typing `&` or `!` searches for that character instead
      // of tripping a syntax error.
      filters.push(sql`${notes.searchVector} @@ plainto_tsquery('simple', ${req.query.q.trim()})`);
    }

    const rows = await getDb()
      .select()
      .from(notes)
      .where(and(...filters))
      .orderBy(desc(notes.pinned), asc(notes.sortOrder), desc(notes.updatedAt));

    res.json({ data: rows.map((row) => serializeNote(row)) });
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error listing notes');
    res.status(500).json({ error: 'Failed to list notes' });
  }
});

// POST /notes — create a note
//
// The client may supply the `id`. A note written while offline already exists on
// the device under an id the user's screens are rendering, so letting the client
// choose it keeps that id stable through the upload and makes the request
// idempotent: a retry after a response that never arrived finds its own note
// rather than creating a second copy.
router.post('/', writeLimiter, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);

    const parsed = noteWriteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid note payload' });
    }

    // Parsed apart from the field schema: `id` addresses the note, it is not one
    // of its fields, and PATCH must never be able to move a note to a new id.
    const idResult = clientNoteIdSchema.safeParse(req.body?.id);
    if (!idResult.success) {
      return res.status(400).json({ error: 'id must be a UUIDv7' });
    }
    const requestedId = idResult.data;

    if (requestedId) {
      const [existing] = await getDb().select().from(notes).where(eq(notes.id, requestedId));
      if (existing) {
        // An id already taken by THIS user is the retry case: return the note as
        // it now stands. An id taken by anyone else must not be distinguishable
        // from a plain conflict, or this route becomes an oracle for which note
        // ids exist.
        if (existing.oxyUserId !== userId) {
          return res.status(409).json({ error: 'Note id is already in use' });
        }
        return res.status(200).json(serializeNote(existing));
      }
    }

    const [note] = await getDb().transaction(async (transaction) => {
      const inserted = await transaction
        .insert(notes)
        .values({
          ...(requestedId ? { id: requestedId } : {}),
          oxyUserId: userId,
          ...toColumns(parsed.data),
        })
        .onConflictDoNothing()
        .returning();
      if (inserted[0]) {
        await enqueueRouteNoteChange(transaction, inserted[0], userId, 'created');
      }
      return inserted;
    });

    // Two devices racing the same client-generated id: the loser's insert hits
    // the conflict clause and returns nothing, so it reads the winner's note.
    if (!note) {
      const [winner] = await getDb()
        .select()
        .from(notes)
        .where(and(eq(notes.id, requestedId ?? ''), eq(notes.oxyUserId, userId)));
      if (!winner) return res.status(409).json({ error: 'Note id is already in use' });
      return res.status(200).json(serializeNote(winner));
    }

    await writeGeneratedHalf(note.id, userId, parsed.data);

    const dto = serializeNote(note);
    emitNoteCreated(userId, dto);
    res.status(201).json(dto);
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error creating note');
    res.status(500).json({ error: 'Failed to create note' });
  }
});

// GET /notes/sync?since=<iso> — everything this user changed since `since`,
// tombstones included. Declared before '/:id' so the literal path wins.
//
// Separate from `GET /notes` on purpose: the list route answers "what does this
// screen show" (one view, filtered, sorted for display), while this one answers
// "what changed" and must cross every view — a note archived since the last pull
// is a change the client needs even though it left the active list.
router.get('/sync', readLimiter, async (req: Request, res: Response) => {
  try {
    const oxyUserId = getRequiredOxyUserId(req);

    const filters = [eq(notes.oxyUserId, oxyUserId)];
    let since: Date | null = null;
    if (typeof req.query.since === 'string' && req.query.since) {
      since = new Date(req.query.since);
      if (Number.isNaN(since.getTime())) {
        return res.status(400).json({ error: 'since must be an ISO timestamp' });
      }
      filters.push(gt(notes.updatedAt, since));
    }

    // Read the clock BEFORE querying. A note written between the query and the
    // response would otherwise fall in the gap: its updatedAt precedes a cursor
    // taken afterwards, so the next pull would skip it permanently. Overlapping
    // instead means a note can arrive twice, which an upsert absorbs.
    const serverTime = new Date().toISOString();
    const limit = parseSyncLimit(req.query.limit);
    if (limit === 'invalid') {
      return res
        .status(400)
        .json({ error: `limit must be an integer from 1 to ${SYNC_MAX_LIMIT}` });
    }
    const fetched = await getDb()
      .select()
      .from(notes)
      .where(and(...filters))
      .orderBy(asc(notes.updatedAt))
      // One past the page, only to learn whether another page exists.
      .limit(limit === null ? Number.MAX_SAFE_INTEGER : limit + 1);
    const page: SyncPage<(typeof fetched)[number]> =
      limit === null ? { rows: fetched, nextCursor: null } : cutSyncPage(fetched, limit);
    let rows = page.rows;
    if (page.wholeRunAt) {
      // More than a page of rows share one instant: take the whole run.
      rows = await getDb()
        .select()
        .from(notes)
        .where(
          and(
            eq(notes.oxyUserId, oxyUserId),
            sql`date_trunc('milliseconds', ${notes.updatedAt}) = ${page.wholeRunAt}`,
          ),
        )
        .orderBy(asc(notes.updatedAt));
    }

    // A note whose generated half moved without the note itself moving is still
    // a change this client needs. `since` is absent on a first pull, which
    // already returns everything.
    const byId = new Map(rows.map((row) => [row.id, row]));
    if (since) {
      const missed = await notesWithGeneratedChangesSince(oxyUserId, since);
      const unseen = missed.filter((id) => !byId.has(id));
      if (unseen.length > 0) {
        const extra = await getDb()
          .select()
          .from(notes)
          .where(and(eq(notes.oxyUserId, oxyUserId), inArray(notes.id, unseen)));
        for (const row of extra) byId.set(row.id, row);
      }
    }

    const present = [...byId.values()]
      .filter((row) => !row.deletedAt)
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
    const generated = await readGeneratedHalf(
      present.map((row) => row.id),
      oxyUserId,
    );

    res.json({
      data: present.map((row) =>
        serializeNote(row, {
          artifacts: generated.artifacts.get(row.id) ?? [],
          overrides: generated.overrides.get(row.id) ?? [],
        }),
      ),
      deleted: [...byId.values()].filter((row) => row.deletedAt).map((row) => row.id),
      serverTime,
      // Only a paged request is told about pages; one without `limit` gets the
      // whole answer, exactly as before, so an older client that ignores these
      // fields can never stop early.
      ...(limit === null ? {} : { hasMore: page.nextCursor !== null, nextCursor: page.nextCursor }),
    });
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error syncing notes');
    res.status(500).json({ error: 'Failed to sync notes' });
  }
});

// POST /notes/reorder — set order by array index (must precede '/:id' routes)
router.post('/reorder', writeLimiter, async (req: Request, res: Response) => {
  try {
    const oxyUserId = getRequiredOxyUserId(req);

    const ids: unknown = req.body?.ids;
    if (!Array.isArray(ids) || ids.some((id) => !isLiveEntityId(id))) {
      return res.status(400).json({ error: 'ids must be an array of note ids' });
    }
    if (ids.length === 0) return res.json({ success: true });

    // One statement rather than a write per id: the positions are a single
    // rearrangement, and applying them one by one leaves the list visibly
    // half-reordered to a concurrent reader.
    const positions = sql.join(
      ids.map((id: string, index: number) => sql`(${id}, ${index}::double precision)`),
      sql`, `,
    );
    const changedAt = new Date();
    await getDb().transaction(async (transaction) => {
      await transaction.execute(sql`
        update ${notes} set sort_order = ordering.position, updated_at = ${changedAt}
        from (values ${positions}) as ordering(id, position)
        where ${notes.id} = ordering.id
          and ${notes.oxyUserId} = ${oxyUserId}
          and ${notes.deletedAt} is null
      `);
      const changed = await transaction
        .select({ id: notes.id, updatedAt: notes.updatedAt })
        .from(notes)
        .where(
          and(
            eq(notes.oxyUserId, oxyUserId),
            inArray(notes.id, ids as string[]),
            isNull(notes.deletedAt),
          ),
        );
      for (const note of changed) {
        await enqueueRouteNoteChange(transaction, note, oxyUserId, 'updated');
      }
    });

    res.json({ success: true });
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error reordering notes');
    res.status(500).json({ error: 'Failed to reorder notes' });
  }
});

// GET /notes/:id
router.get('/:id', readLimiter, async (req: Request, res: Response) => {
  try {
    const oxyUserId = getRequiredOxyUserId(req);
    const noteId = req.params.id;
    if (typeof noteId !== 'string' || !isLiveEntityId(noteId)) {
      return res.status(400).json({ error: 'Invalid note id' });
    }

    const [note] = await getDb()
      .select()
      .from(notes)
      .where(and(eq(notes.id, noteId), eq(notes.oxyUserId, oxyUserId), isNull(notes.deletedAt)));
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const generated = await readGeneratedHalf([note.id], oxyUserId);
    res.json(
      serializeNote(note, {
        artifacts: generated.artifacts.get(note.id) ?? [],
        overrides: generated.overrides.get(note.id) ?? [],
      }),
    );
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error fetching note');
    res.status(500).json({ error: 'Failed to fetch note' });
  }
});

// PATCH /notes/:id — pin/archive/color/labels/checklist/body/reminder all via PATCH
router.patch('/:id', writeLimiter, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);
    const noteId = req.params.id;
    if (typeof noteId !== 'string' || !isLiveEntityId(noteId)) {
      return res.status(400).json({ error: 'Invalid note id' });
    }

    const parsed = noteWriteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid note payload' });
    }

    const base = parsed.data.baseUpdatedAt ? new Date(parsed.data.baseUpdatedAt) : null;

    const [note] = await getDb().transaction(async (transaction) => {
      // The text being replaced, read under a lock so the version kept is the
      // one this edit actually overwrote. Only when the edit touches that text.
      const { title, body, checklist } = parsed.data;
      const touchesText = title !== undefined || body !== undefined || checklist !== undefined;
      const [before] = touchesText
        ? await transaction
            .select()
            .from(notes)
            .where(and(eq(notes.id, noteId), eq(notes.oxyUserId, userId), isNull(notes.deletedAt)))
            .for('update')
        : [];

      const updated = await transaction
        .update(notes)
        .set(touched(toColumns(parsed.data)))
        .where(
          and(
            eq(notes.id, noteId),
            eq(notes.oxyUserId, userId),
            isNull(notes.deletedAt),
            // The check lives in the UPDATE itself, so two devices racing on the
            // same base cannot both pass it. Milliseconds, because the wire
            // format has no more and a database default can.
            base ? sql`date_trunc('milliseconds', ${notes.updatedAt}) = ${base}` : undefined,
          ),
        )
        .returning();
      if (updated[0]) {
        // Only once the edit has applied: a refused (409) edit replaced nothing.
        if (before && changesText(textOf(before), { title, body, checklist })) {
          await snapshotBeforeEdit(transaction, noteId, userId, textOf(before));
        }
        await enqueueRouteNoteChange(
          transaction,
          updated[0],
          userId,
          noteChangeForPatch(parsed.data),
        );
      }
      return updated;
    });
    if (!note) {
      if (base) {
        const [current] = await getDb()
          .select()
          .from(notes)
          .where(and(eq(notes.id, noteId), eq(notes.oxyUserId, userId), isNull(notes.deletedAt)));
        if (current) {
          const generated = await readGeneratedHalf([current.id], userId);
          return res.status(409).json({
            error: 'Note changed since the version this edit was based on',
            current: serializeNote(current, {
              artifacts: generated.artifacts.get(current.id) ?? [],
              overrides: generated.overrides.get(current.id) ?? [],
            }),
          });
        }
      }
      return res.status(404).json({ error: 'Note not found' });
    }

    await writeGeneratedHalf(note.id, userId, parsed.data);

    const dto = serializeNote(note);
    emitNoteUpdated(userId, dto);
    res.json(dto);
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error updating note');
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// GET /notes/:id/revisions — earlier versions of the note's text, newest first.
router.get('/:id/revisions', readLimiter, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);
    const noteId = req.params.id;
    if (typeof noteId !== 'string' || !isLiveEntityId(noteId)) {
      return res.status(400).json({ error: 'Invalid note id' });
    }
    res.json({ data: await listRevisions(noteId, userId) });
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error listing note revisions');
    res.status(500).json({ error: 'Failed to list revisions' });
  }
});

// GET /notes/:id/revisions/:revisionId — one version's full text. The client
// restores by applying it as an ordinary local edit, which then syncs like any
// other (and snapshots the text it replaces on the server).
router.get('/:id/revisions/:revisionId', readLimiter, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);
    const { id: noteId, revisionId } = req.params;
    if (
      typeof noteId !== 'string' ||
      !isLiveEntityId(noteId) ||
      typeof revisionId !== 'string' ||
      !isLiveEntityId(revisionId)
    ) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const revision = await getRevision(noteId, revisionId, userId);
    if (!revision) return res.status(404).json({ error: 'Revision not found' });
    res.json(revision);
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error reading note revision');
    res.status(500).json({ error: 'Failed to read revision' });
  }
});

// POST /notes/:id/revisions/:revisionId/restore — put an earlier text back.
// The text it replaces is kept as a version, so a restore can itself be undone.
router.post(
  '/:id/revisions/:revisionId/restore',
  writeLimiter,
  async (req: Request, res: Response) => {
    try {
      const userId = getRequiredOxyUserId(req);
      const { id: noteId, revisionId } = req.params;
      if (
        typeof noteId !== 'string' ||
        !isLiveEntityId(noteId) ||
        typeof revisionId !== 'string' ||
        !isLiveEntityId(revisionId)
      ) {
        return res.status(400).json({ error: 'Invalid id' });
      }
      const restored = await restoreRevision(noteId, revisionId, userId);
      if (!restored) return res.status(404).json({ error: 'Revision not found' });

      const generated = await readGeneratedHalf([restored.id], userId);
      const dto = serializeNote(restored, {
        artifacts: generated.artifacts.get(restored.id) ?? [],
        overrides: generated.overrides.get(restored.id) ?? [],
      });
      emitNoteUpdated(userId, dto);
      res.json(dto);
    } catch (error: unknown) {
      log.notes.error({ err: error }, 'Error restoring note revision');
      res.status(500).json({ error: 'Failed to restore revision' });
    }
  },
);

// POST /notes/:id/trash — trashed = true
router.post('/:id/trash', writeLimiter, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);
    const noteId = req.params.id;
    if (typeof noteId !== 'string' || !isLiveEntityId(noteId)) {
      return res.status(400).json({ error: 'Invalid note id' });
    }

    const [note] = await getDb().transaction(async (transaction) => {
      const updated = await transaction
        .update(notes)
        .set({ trashed: true, updatedAt: new Date() })
        .where(and(eq(notes.id, noteId), eq(notes.oxyUserId, userId), isNull(notes.deletedAt)))
        .returning();
      if (updated[0]) await enqueueRouteNoteChange(transaction, updated[0], userId, 'trashed');
      return updated;
    });
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const dto = serializeNote(note);
    emitNoteUpdated(userId, dto);
    res.json(dto);
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error trashing note');
    res.status(500).json({ error: 'Failed to trash note' });
  }
});

// POST /notes/:id/restore — trashed = false, archived = false
router.post('/:id/restore', writeLimiter, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);
    const noteId = req.params.id;
    if (typeof noteId !== 'string' || !isLiveEntityId(noteId)) {
      return res.status(400).json({ error: 'Invalid note id' });
    }

    const [note] = await getDb().transaction(async (transaction) => {
      const updated = await transaction
        .update(notes)
        .set({ trashed: false, archived: false, updatedAt: new Date() })
        .where(and(eq(notes.id, noteId), eq(notes.oxyUserId, userId), isNull(notes.deletedAt)))
        .returning();
      if (updated[0]) await enqueueRouteNoteChange(transaction, updated[0], userId, 'restored');
      return updated;
    });
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const dto = serializeNote(note);
    emitNoteUpdated(userId, dto);
    res.json(dto);
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error restoring note');
    res.status(500).json({ error: 'Failed to restore note' });
  }
});

// DELETE /notes/:id — delete forever (from trash)
//
// Tombstoned rather than removed: a client that was offline when this ran has no
// other way to learn the note is gone, and would keep pushing it back. The note's
// content is cleared right here — only the fact of the deletion is retained — and
// the expiry sweep (`db/expiry.ts`) drops the row entirely a month later.
//
// Idempotent: deleting a note that is already deleted, or that this user never
// had, succeeds. The client's outbox is at-least-once by design — it retries
// until the server confirms — so answering `404` to the retry of a request that
// already worked reports failure for the one case the retry exists to cover. It
// leaks nothing either way, because the update is scoped to this user, so an id
// belonging to someone else has always been indistinguishable from an absent
// one.
router.delete('/:id', writeLimiter, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);
    const noteId = req.params.id;
    if (typeof noteId !== 'string' || !isLiveEntityId(noteId)) {
      return res.status(400).json({ error: 'Invalid note id' });
    }

    const now = new Date();
    const [note] = await getDb().transaction(async (transaction) => {
      const updated = await transaction
        .update(notes)
        .set({
          deletedAt: now,
          updatedAt: now,
          title: '',
          body: '',
          checklist: [],
          attachments: [],
          labels: [],
          reminderAt: null,
          reminderQueuedAt: null,
          reminderSentAt: null,
        })
        .where(and(eq(notes.id, noteId), eq(notes.oxyUserId, userId), isNull(notes.deletedAt)))
        .returning({ id: notes.id, updatedAt: notes.updatedAt });
      if (updated[0]) {
        // The tombstone clears the note's text; its history must not outlive it.
        await deleteRevisionsOf(transaction, [updated[0].id], userId);
        await enqueueRouteNoteChange(transaction, updated[0], userId, 'deleted');
      }
      return updated;
    });

    // The tombstone clears the note's own content; the generated half has to go
    // with it. The foreign key would do this eventually — but not for a month,
    // and "delete forever" cannot mean the transcript-derived text stays.
    if (note) await deleteGeneratedHalf(note.id, userId);

    // Only a row this request actually tombstoned is worth announcing; a repeat
    // would tell every other device to delete a note they deleted long ago.
    if (note) emitNoteDeleted(userId, note.id);
    res.json({ success: true });
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error deleting note');
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

/** Notes with a reminder due and not yet delivered — the scheduler's read. */
export function dueReminderFilter(now: Date) {
  return and(
    isNotNull(notes.reminderAt),
    sql`${notes.reminderAt} <= ${now}`,
    isNull(notes.reminderQueuedAt),
    isNull(notes.reminderSentAt),
    eq(notes.trashed, false),
    // Deleting a note clears its reminder, so this is redundant today — and
    // stated anyway, because "a deleted note never notifies" should hold no
    // matter what a future delete path forgets to clear.
    isNull(notes.deletedAt),
  );
}

// Attachment bytes (any file type) are uploaded by the Oxy file manager on the
// client; Noted only stores the resulting file IDs via PATCH /notes/:id
// (note.attachments). There is no server-side file upload endpoint.

export default router;
