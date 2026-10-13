import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { and, asc, eq } from 'drizzle-orm';
import { isLiveEntityId, isUniqueViolation } from '@oxy.so/db';
import { requireOxyAuth, getRequiredOxyUserId } from '@oxy.so/core/server';

import { authenticateToken } from '../middleware/auth.js';
import { getDb } from '../db/postgres.js';
import { folders } from '../db/schema/folders.js';
import { serializeFolder } from '../lib/serializers.js';
import { makeRateLimiter } from '../lib/rate-limit.js';
import { clearFolderFromNotes } from '../lib/folders.js';
import { log } from '../lib/logger.js';

const router = Router();

const nameSchema = z.string().trim().min(1).max(50);

router.use(makeRateLimiter('folders'), authenticateToken, requireOxyAuth);

// GET /folders
router.get('/', async (req: Request, res: Response) => {
  try {
    const rows = await getDb()
      .select()
      .from(folders)
      .where(eq(folders.oxyUserId, getRequiredOxyUserId(req)))
      .orderBy(asc(folders.name));
    res.json({ data: rows.map(serializeFolder) });
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error listing folders');
    res.status(500).json({ error: 'Failed to list folders' });
  }
});

// POST /folders ({ name })
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);
    const parsed = z.object({ name: nameSchema }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Folder name is required' });

    const [folder] = await getDb()
      .insert(folders)
      .values({ oxyUserId: userId, name: parsed.data.name })
      .returning();
    res.status(201).json(serializeFolder(folder));
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: 'A folder with that name already exists' });
    }
    log.notes.error({ err: error }, 'Error creating folder');
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// PATCH /folders/:id ({ name })
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);
    const folderId = req.params.id;
    if (typeof folderId !== 'string' || !isLiveEntityId(folderId)) {
      return res.status(400).json({ error: 'Invalid folder id' });
    }
    const parsed = z.object({ name: nameSchema }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Folder name is required' });

    const [folder] = await getDb()
      .update(folders)
      .set({ name: parsed.data.name, updatedAt: new Date() })
      .where(and(eq(folders.id, folderId), eq(folders.oxyUserId, userId)))
      .returning();
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    res.json(serializeFolder(folder));
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: 'A folder with that name already exists' });
    }
    log.notes.error({ err: error }, 'Error renaming folder');
    res.status(500).json({ error: 'Failed to rename folder' });
  }
});

// DELETE /folders/:id — the notes in it are unfiled, not deleted
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);
    const folderId = req.params.id;
    if (typeof folderId !== 'string' || !isLiveEntityId(folderId)) {
      return res.status(400).json({ error: 'Invalid folder id' });
    }

    // One transaction: a folder deleted while notes still named it would leave
    // them filed somewhere nothing can open.
    const deleted = await getDb().transaction(async (tx) => {
      const [folder] = await tx
        .delete(folders)
        .where(and(eq(folders.id, folderId), eq(folders.oxyUserId, userId)))
        .returning({ id: folders.id });
      if (!folder) return false;
      await clearFolderFromNotes(tx, folderId, userId);
      return true;
    });

    if (!deleted) return res.status(404).json({ error: 'Folder not found' });
    res.json({ success: true });
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error deleting folder');
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

export default router;
