import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireOxyAuth, getRequiredOxyUserId } from '@oxyhq/core/server';
import { Note, NOTE_COLORS } from '../models/note.js';
import { serializeNote } from '../lib/serializers.js';
import { uploadToS3 } from '../lib/s3.js';
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
// Uploads are heavier; cap them tighter than ordinary writes.
const uploadLimiter = makeRateLimiter('notes:upload', { authenticatedMax: 120, anonymousMax: 20 });

// In-memory upload — buffers go straight to S3, never touch disk.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, GIF, and WebP images are allowed'));
    }
  },
});

// ── Validation schemas ─────────────────────────────────────────────

const checklistItemSchema = z.object({
  id: z.string(),
  text: z.string().default(''),
  checked: z.boolean().default(false),
});

const imageSchema = z.object({
  url: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const noteWriteSchema = z
  .object({
    title: z.string().max(1000),
    body: z.string().max(100_000),
    checklist: z.array(checklistItemSchema),
    color: z.enum(NOTE_COLORS),
    labels: z.array(z.string()),
    pinned: z.boolean(),
    archived: z.boolean(),
    trashed: z.boolean(),
    images: z.array(imageSchema),
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

// POST /notes/:id/images — multipart field 'file'; uploads to S3 and appends to note.images
router.post('/:id/images', uploadLimiter, upload.single('file'), async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);
    const oxyUserId = new mongoose.Types.ObjectId(userId);
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid note id' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const owns = await Note.exists({ _id: req.params.id, oxyUserId });
    if (!owns) return res.status(404).json({ error: 'Note not found' });

    // multer's fileFilter has already validated mimetype ∈ {jpeg,png,gif,webp};
    // the S3 key + extension are derived from this server-trusted value, not the filename.
    const url = await uploadToS3(req.file.buffer, req.file.mimetype, 'notes', 'image');

    const note = await Note.findOneAndUpdate(
      { _id: req.params.id, oxyUserId },
      { $push: { images: { url } } },
      { new: true },
    );
    if (!note) return res.status(404).json({ error: 'Note not found' });

    emitNoteUpdated(userId, serializeNote(note));
    res.status(201).json({ url });
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error attaching image to note');
    res.status(500).json({ error: 'Failed to attach image' });
  }
});

// Multer errors (file too large, wrong type) surface as a clean 400.
router.use((err: unknown, _req: Request, res: Response, next: (e?: unknown) => void) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Image exceeds the 10 MB limit' : err.message;
    return res.status(400).json({ error: message });
  }
  if (err instanceof Error && /images are allowed/.test(err.message)) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

export default router;
