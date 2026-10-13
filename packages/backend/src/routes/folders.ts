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
import { checkPlacement, type FolderPlacementError } from '../lib/folder-tree.js';
import { listFolderNodes, moveNotesOutOfFolder, reparentChildren } from '../lib/folders.js';
import { log } from '../lib/logger.js';

const router = Router();

const nameSchema = z.string().trim().min(1).max(50);
const parentSchema = z.string().max(200).nullable();

const PLACEMENT_MESSAGES: Record<FolderPlacementError, string> = {
  'parent-not-found': 'Unknown parent folder',
  cycle: 'A folder cannot be moved into itself',
  'too-deep': 'Folders can only be nested three levels deep',
};

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
    const parsed = z
      .object({ name: nameSchema, parentId: parentSchema.optional() })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Folder name is required' });

    const parentId = parsed.data.parentId ?? null;
    const problem = checkPlacement({
      folderId: null,
      newParentId: parentId,
      nodes: await listFolderNodes(userId),
    });
    if (problem) return res.status(400).json({ error: PLACEMENT_MESSAGES[problem] });

    const [folder] = await getDb()
      .insert(folders)
      .values({ oxyUserId: userId, name: parsed.data.name, parentId })
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
    const parsed = z
      .object({ name: nameSchema.optional(), parentId: parentSchema.optional() })
      .safeParse(req.body);
    if (!parsed.success || (parsed.data.name === undefined && parsed.data.parentId === undefined)) {
      return res.status(400).json({ error: 'Send a name, a parentId, or both' });
    }

    // Moving is the only change that can break the tree, so only it is checked.
    if (parsed.data.parentId !== undefined) {
      const problem = checkPlacement({
        folderId,
        newParentId: parsed.data.parentId,
        nodes: await listFolderNodes(userId),
      });
      if (problem) return res.status(400).json({ error: PLACEMENT_MESSAGES[problem] });
    }

    const [folder] = await getDb()
      .update(folders)
      .set({
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.parentId !== undefined ? { parentId: parsed.data.parentId } : {}),
        updatedAt: new Date(),
      })
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

// DELETE /folders/:id — nothing inside is lost: its notes and subfolders move up
// to the folder it was in
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);
    const folderId = req.params.id;
    if (typeof folderId !== 'string' || !isLiveEntityId(folderId)) {
      return res.status(400).json({ error: 'Invalid folder id' });
    }

    // One transaction: a folder deleted while notes or subfolders still named it
    // would leave them filed somewhere nothing can open.
    const deleted = await getDb().transaction(async (tx) => {
      const [folder] = await tx
        .delete(folders)
        .where(and(eq(folders.id, folderId), eq(folders.oxyUserId, userId)))
        .returning({ id: folders.id, parentId: folders.parentId });
      if (!folder) return false;
      await reparentChildren(tx, folderId, folder.parentId, userId);
      await moveNotesOutOfFolder(tx, folderId, folder.parentId, userId);
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
