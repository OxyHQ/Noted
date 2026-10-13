import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { requireOxyAuth, getRequiredOxyUserId } from '@oxy.so/core/server';

import { authenticateToken } from '../middleware/auth.js';
import { eraseAccountData, exportAccountData } from '../lib/account-data.js';
import { makeRateLimiter } from '../lib/rate-limit.js';
import { log } from '../lib/logger.js';

const router = Router();

router.use(makeRateLimiter('account', { authenticatedMax: 20 }), authenticateToken, requireOxyAuth);

// GET /account/export — everything Noted stores for this user, as one JSON file.
router.get('/export', async (req: Request, res: Response) => {
  try {
    const data = await exportAccountData(getRequiredOxyUserId(req));
    res.setHeader('Content-Disposition', 'attachment; filename="noted-export.json"');
    res.setHeader('Cache-Control', 'no-store');
    res.json(data);
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error exporting account data');
    res.status(500).json({ error: 'Failed to export account data' });
  }
});

const deleteSchema = z.object({ confirm: z.literal('DELETE') });

// Erase Noted's data for this user. The Oxy account itself is Oxy's to delete.
// Irreversible, hence the explicit confirmation in the body.
//
// Offered twice: `DELETE /account` is the natural verb, but a request body on a
// DELETE is dropped by some proxies and load balancers, which would turn the
// confirmation into a 400 for no reason the user could see. `POST /account/erase`
// carries the same body on a verb every hop forwards intact.
async function erase(req: Request, res: Response) {
  try {
    const oxyUserId = getRequiredOxyUserId(req);
    if (!deleteSchema.safeParse(req.body).success) {
      return res.status(400).json({ error: 'Send {"confirm":"DELETE"} to erase this account' });
    }
    await eraseAccountData(oxyUserId);
    log.notes.info('Erased account data');
    res.json({ success: true });
  } catch (error: unknown) {
    log.notes.error({ err: error }, 'Error erasing account data');
    res.status(500).json({ error: 'Failed to erase account data' });
  }
}

router.delete('/', erase);
router.post('/erase', erase);

export default router;
