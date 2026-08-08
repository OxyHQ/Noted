import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { and, arrayContains, asc, eq, sql } from 'drizzle-orm';
import { isLiveEntityId, isUniqueViolation } from '@oxyhq/db';
import { requireOxyAuth, getRequiredOxyUserId } from '@oxyhq/core/server';
import { normalizeNoteColor } from '@noted/shared-types';

import { authenticateToken } from '../middleware/auth.js';
import { getDb } from '../db/postgres.js';
import { labels } from '../db/schema/labels.js';
import { notes } from '../db/schema/notes.js';
import { serializeLabel } from '../lib/serializers.js';
import { makeRateLimiter } from '../lib/rate-limit.js';
import { emitLabelCreated, emitLabelUpdated, emitLabelDeleted } from '../socket.js';
import { log } from '../lib/logger.js';

const router = Router();

// `null` means "no color"; any non-null string is coerced to a valid
// NoteColor (tolerant of the legacy palette — see normalizeNoteColor).
const colorSchema = z.string().transform(normalizeNoteColor).nullable();

router.use(makeRateLimiter('labels'), authenticateToken, requireOxyAuth);

// GET /labels
router.get('/', async (req: Request, res: Response) => {
  try {
    const oxyUserId = getRequiredOxyUserId(req);
    const rows = await getDb()
      .select()
      .from(labels)
      .where(eq(labels.oxyUserId, oxyUserId))
      .orderBy(asc(labels.name));
    res.json({ data: rows.map(serializeLabel) });
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error listing labels');
    res.status(500).json({ error: 'Failed to list labels' });
  }
});

// POST /labels ({ name, color? })
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);

    const parsed = z
      .object({ name: z.string().trim().min(1).max(50), color: colorSchema.optional() })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Label name is required' });
    }

    const [label] = await getDb()
      .insert(labels)
      .values({
        oxyUserId: userId,
        name: parsed.data.name,
        color: parsed.data.color ?? null,
      })
      .returning();

    const dto = serializeLabel(label);
    emitLabelCreated(userId, dto);
    res.status(201).json(dto);
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
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
    const labelId = req.params.id;
    if (typeof labelId !== 'string' || !isLiveEntityId(labelId)) {
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

    const [label] = await getDb()
      .update(labels)
      .set({ ...update, updatedAt: new Date() })
      .where(and(eq(labels.id, labelId), eq(labels.oxyUserId, userId)))
      .returning();
    if (!label) return res.status(404).json({ error: 'Label not found' });

    const dto = serializeLabel(label);
    emitLabelUpdated(userId, dto);
    res.json(dto);
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: 'A label with that name already exists' });
    }
    log.notes.error({ err: error }, 'Error updating label');
    res.status(500).json({ error: 'Failed to update label' });
  }
});

// DELETE /labels/:id — also removes the id from every note that carried it
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);
    const labelId = req.params.id;
    if (typeof labelId !== 'string' || !isLiveEntityId(labelId)) {
      return res.status(400).json({ error: 'Invalid label id' });
    }

    // One transaction: a label deleted while its id stayed on a note would leave
    // that note carrying a label nothing can resolve, which renders as a blank
    // chip the user cannot remove.
    const deleted = await getDb().transaction(async (tx) => {
      const [label] = await tx
        .delete(labels)
        .where(and(eq(labels.id, labelId), eq(labels.oxyUserId, userId)))
        .returning({ id: labels.id });
      if (!label) return null;

      await tx
        .update(notes)
        .set({ labels: sql`array_remove(${notes.labels}, ${labelId})`, updatedAt: new Date() })
        .where(and(eq(notes.oxyUserId, userId), arrayContains(notes.labels, [labelId])));

      return label.id;
    });

    if (!deleted) return res.status(404).json({ error: 'Label not found' });

    emitLabelDeleted(userId, deleted);
    res.json({ success: true });
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error deleting label');
    res.status(500).json({ error: 'Failed to delete label' });
  }
});

export default router;
