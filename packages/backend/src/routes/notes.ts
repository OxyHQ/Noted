import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireOxyAuth, getRequiredOxyUserId } from '@oxyhq/core/server';
import { Note } from '../models/note.js';
import { normalizeNoteColor } from '@noted/shared-types';
import { serializeNote } from '../lib/serializers.js';
import { makeRateLimiter } from '../lib/rate-limit.js';
import {
  emitNoteCreated,
  emitNoteUpdated,
  emitNoteDeleted,
} from '../socket.js';
import { log } from '../lib/logger.js';

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

const noteWriteSchema = z
  .object({
    title: z.string().max(1000),
    body: z.string().max(100_000),
    checklist: z.array(checklistItemSchema),
    // Tolerant of legacy palette values: any string is coerced to a valid
    // NoteColor (darkblue→blue, brown→amber, gray/unknown→default) instead of
    // being rejected, so a client echoing an old color in a PATCH never 400s.
    color: z.string().transform(normalizeNoteColor),
    labels: z.array(z.string()),
    pinned: z.boolean(),
    archived: z.boolean(),
    trashed: z.boolean(),
    // Oxy file-manager file IDs (any file type).
    attachments: z.array(z.string()),
    reminderAt: z.string().datetime().nullable(),
    order: z.number(),
  })
  .partial();

router.use(authenticateToken, requireOxyAuth);

// GET /notes?view=active|archived|trashed&label=<id>&pinned=<bool>&q=<text>
router.get('/', readLimiter, async (req: Request, res: Response) => {
  try {
    const oxyUserId = new mongoose.Types.ObjectId(getRequiredOxyUserId(req));

    const view = req.query.view === 'archived' || req.query.view === 'trashed'
      ? req.query.view
      : 'active';

    const filter: Record<string, unknown> = { oxyUserId };
    if (view === 'trashed') {
      filter.trashed = true;
    } else if (view === 'archived') {
      filter.trashed = false;
      filter.archived = true;
    } else {
      filter.trashed = false;
      filter.archived = false;
    }

    if (typeof req.query.label === 'string' && req.query.label) {
      filter.labels = req.query.label;
    }
    if (req.query.pinned === 'true' || req.query.pinned === 'false') {
      filter.pinned = req.query.pinned === 'true';
    }
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      filter.$text = { $search: req.query.q.trim() };
    }

    const notes = await Note.find(filter).sort({ pinned: -1, order: 1, updatedAt: -1 });
    res.json({ data: notes.map(serializeNote) });
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error listing notes');
    res.status(500).json({ error: 'Failed to list notes' });
  }
});

// POST /notes — create a note
router.post('/', writeLimiter, async (req: Request, res: Response) => {
  try {
    const oxyUserId = new mongoose.Types.ObjectId(getRequiredOxyUserId(req));

    const parsed = noteWriteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid note payload' });
    }
    const { reminderAt, ...rest } = parsed.data;

    const note = await Note.create({
      oxyUserId,
      ...rest,
      ...(reminderAt !== undefined ? { reminderAt: reminderAt ? new Date(reminderAt) : null, reminderSentAt: null } : {}),
    });

    const dto = serializeNote(note);
    emitNoteCreated(getRequiredOxyUserId(req), dto);
    res.status(201).json(dto);
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error creating note');
    res.status(500).json({ error: 'Failed to create note' });
  }
});

// POST /notes/reorder — set order by array index (must precede '/:id' routes)
router.post('/reorder', writeLimiter, async (req: Request, res: Response) => {
  try {
    const oxyUserId = new mongoose.Types.ObjectId(getRequiredOxyUserId(req));

    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !mongoose.isValidObjectId(id))) {
      return res.status(400).json({ error: 'ids must be an array of note ids' });
    }

    await Note.bulkWrite(
      ids.map((id: string, index: number) => ({
        updateOne: {
          filter: { _id: id, oxyUserId },
          update: { $set: { order: index } },
        },
      })),
    );

    res.json({ success: true });
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error reordering notes');
    res.status(500).json({ error: 'Failed to reorder notes' });
  }
});

// GET /notes/:id
router.get('/:id', readLimiter, async (req: Request, res: Response) => {
  try {
    const oxyUserId = new mongoose.Types.ObjectId(getRequiredOxyUserId(req));
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid note id' });
    }

    const note = await Note.findOne({ _id: req.params.id, oxyUserId });
    if (!note) return res.status(404).json({ error: 'Note not found' });
    res.json(serializeNote(note));
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error fetching note');
    res.status(500).json({ error: 'Failed to fetch note' });
  }
});

// PATCH /notes/:id — pin/archive/color/labels/checklist/body/reminder all via PATCH
router.patch('/:id', writeLimiter, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);
    const oxyUserId = new mongoose.Types.ObjectId(userId);
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid note id' });
    }

    const parsed = noteWriteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid note payload' });
    }
    const { reminderAt, ...rest } = parsed.data;
    const update: Record<string, unknown> = { ...rest };
    if (reminderAt !== undefined) {
      update.reminderAt = reminderAt ? new Date(reminderAt) : null;
      // A new/changed reminder must be eligible for delivery again.
      update.reminderSentAt = null;
    }

    const note = await Note.findOneAndUpdate(
      { _id: req.params.id, oxyUserId },
      { $set: update },
      { new: true },
    );
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const dto = serializeNote(note);
    emitNoteUpdated(userId, dto);
    res.json(dto);
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error updating note');
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// POST /notes/:id/trash — trashed = true
router.post('/:id/trash', writeLimiter, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);
    const oxyUserId = new mongoose.Types.ObjectId(userId);
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid note id' });
    }

    const note = await Note.findOneAndUpdate(
      { _id: req.params.id, oxyUserId },
      { $set: { trashed: true } },
      { new: true },
    );
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
    const oxyUserId = new mongoose.Types.ObjectId(userId);
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid note id' });
    }

    const note = await Note.findOneAndUpdate(
      { _id: req.params.id, oxyUserId },
      { $set: { trashed: false, archived: false } },
      { new: true },
    );
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const dto = serializeNote(note);
    emitNoteUpdated(userId, dto);
    res.json(dto);
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error restoring note');
    res.status(500).json({ error: 'Failed to restore note' });
  }
});

// DELETE /notes/:id — hard purge (from trash)
router.delete('/:id', writeLimiter, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);
    const oxyUserId = new mongoose.Types.ObjectId(userId);
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid note id' });
    }

    const note = await Note.findOneAndDelete({ _id: req.params.id, oxyUserId });
    if (!note) return res.status(404).json({ error: 'Note not found' });

    emitNoteDeleted(userId, note._id.toString());
    res.json({ success: true });
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error deleting note');
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// Attachment bytes (any file type) are uploaded by the Oxy file manager on the
// client; Noted only stores the resulting file IDs via PATCH /notes/:id
// (note.attachments). There is no server-side file upload endpoint.

export default router;
