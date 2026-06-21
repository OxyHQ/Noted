import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireOxyAuth, getRequiredOxyUserId } from '@oxyhq/core/server';
import { Label } from '../models/label.js';
import { Note } from '../models/note.js';
import { normalizeNoteColor } from '../models/note.js';
import { serializeLabel } from '../lib/serializers.js';
import { makeRateLimiter } from '../lib/rate-limit.js';
import {
  emitLabelCreated,
  emitLabelUpdated,
  emitLabelDeleted,
} from '../socket.js';
import { log } from '../lib/logger.js';

const router = Router();

// `null` means "no color"; any non-null string is coerced to a valid
// NoteColor (tolerant of the legacy palette — see normalizeNoteColor).
const colorSchema = z
  .string()
  .transform(normalizeNoteColor)
  .nullable();

router.use(makeRateLimiter('labels'), authenticateToken, requireOxyAuth);

// GET /labels
router.get('/', async (req: Request, res: Response) => {
  try {
    const oxyUserId = new mongoose.Types.ObjectId(getRequiredOxyUserId(req));
    const labels = await Label.find({ oxyUserId }).sort({ name: 1 });
    res.json({ data: labels.map(serializeLabel) });
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error listing labels');
    res.status(500).json({ error: 'Failed to list labels' });
  }
});

// POST /labels ({ name, color? })
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);
    const oxyUserId = new mongoose.Types.ObjectId(userId);

    const parsed = z
      .object({ name: z.string().trim().min(1).max(50), color: colorSchema.optional() })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Label name is required' });
    }

    const label = await Label.create({
      oxyUserId,
      name: parsed.data.name,
      color: parsed.data.color ?? null,
    });

    const dto = serializeLabel(label);
    emitLabelCreated(userId, dto);
    res.status(201).json(dto);
  } catch (error: unknown) {
    if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) {
      return res.status(409).json({ error: 'A label with that name already exists' });
    }
    log.notes.error({ err: error }, 'Error creating label');
    res.status(500).json({ error: 'Failed to create label' });
  }
});

// PATCH /labels/:id ({ name?, color? })
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);
    const oxyUserId = new mongoose.Types.ObjectId(userId);
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid label id' });
    }

    const parsed = z
      .object({ name: z.string().trim().min(1).max(50).optional(), color: colorSchema.optional() })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid label payload' });
    }

    const update: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) update.name = parsed.data.name;
    if (parsed.data.color !== undefined) update.color = parsed.data.color;
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const label = await Label.findOneAndUpdate(
      { _id: req.params.id, oxyUserId },
      { $set: update },
      { new: true },
    );
    if (!label) return res.status(404).json({ error: 'Label not found' });

    const dto = serializeLabel(label);
    emitLabelUpdated(userId, dto);
    res.json(dto);
  } catch (error: unknown) {
    if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) {
      return res.status(409).json({ error: 'A label with that name already exists' });
    }
    log.notes.error({ err: error }, 'Error updating label');
    res.status(500).json({ error: 'Failed to update label' });
  }
});

// DELETE /labels/:id — also $pull the id from every note.labels
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);
    const oxyUserId = new mongoose.Types.ObjectId(userId);
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid label id' });
    }

    const label = await Label.findOneAndDelete({ _id: req.params.id, oxyUserId });
    if (!label) return res.status(404).json({ error: 'Label not found' });

    const labelId = label._id.toString();
    await Note.updateMany({ oxyUserId, labels: labelId }, { $pull: { labels: labelId } });

    emitLabelDeleted(userId, labelId);
    res.json({ success: true });
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error deleting label');
    res.status(500).json({ error: 'Failed to delete label' });
  }
});

export default router;
