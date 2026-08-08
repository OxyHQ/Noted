import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { isLiveEntityId } from '@oxyhq/db';
import { requireOxyAuth, getRequiredOxyUserId } from '@oxyhq/core/server';

import { authenticateToken } from '../middleware/auth.js';
import { getDb } from '../db/postgres.js';
import { feedback, FEEDBACK_TYPES, type FeedbackRow } from '../db/schema/feedback.js';
import { makeRateLimiter } from '../lib/rate-limit.js';
import { log } from '../lib/logger.js';

const router = Router();

/** How many past submissions the history screen shows. */
const HISTORY_LIMIT = 50;

const feedbackSchema = z.object({
  type: z.enum(FEEDBACK_TYPES),
  rating: z.number().int().min(1).max(5).optional(),
  message: z.string().trim().min(1).max(10_000),
  email: z.string().email().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

/**
 * The wire shape, listed field by field.
 *
 * The previous implementation returned the raw document, which leaked
 * `oxyUserId` and Mongo's own bookkeeping to the client. Feedback carries device
 * metadata and whatever the user chose to write, so it is exactly the payload
 * that should not gain fields by accident.
 */
function serializeFeedback(row: FeedbackRow) {
  return {
    id: row.id,
    type: row.type,
    rating: row.rating,
    message: row.message,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

// All feedback routes are rate-limited and require authentication.
router.use(makeRateLimiter('feedback'), authenticateToken, requireOxyAuth);

/**
 * POST /feedback
 * Submit new feedback
 */
router.post('/', async (req, res) => {
  try {
    const parsed = feedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid feedback payload' });
    }

    const [row] = await getDb()
      .insert(feedback)
      .values({
        oxyUserId: getRequiredOxyUserId(req),
        type: parsed.data.type,
        rating: parsed.data.rating,
        message: parsed.data.message,
        email: parsed.data.email,
        metadata: parsed.data.metadata ?? {},
      })
      .returning();

    res.status(201).json({ success: true, feedback: serializeFeedback(row) });
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Error submitting feedback');
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

/**
 * GET /feedback
 * Get user's feedback history
 */
router.get('/', async (req, res) => {
  try {
    const rows = await getDb()
      .select()
      .from(feedback)
      .where(eq(feedback.oxyUserId, getRequiredOxyUserId(req)))
      .orderBy(desc(feedback.createdAt))
      .limit(HISTORY_LIMIT);

    res.json(rows.map(serializeFeedback));
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Error fetching feedback');
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
});

/**
 * GET /feedback/:id
 * Get specific feedback by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const feedbackId = req.params.id;
    if (typeof feedbackId !== 'string' || !isLiveEntityId(feedbackId)) {
      return res.status(400).json({ error: 'Invalid feedback id' });
    }

    const [row] = await getDb()
      .select()
      .from(feedback)
      .where(
        and(eq(feedback.id, feedbackId), eq(feedback.oxyUserId, getRequiredOxyUserId(req))),
      );
    if (!row) return res.status(404).json({ error: 'Feedback not found' });

    res.json(serializeFeedback(row));
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Error fetching feedback');
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
});

export default router;
