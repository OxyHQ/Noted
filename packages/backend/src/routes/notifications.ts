import { Router } from 'express';
import Expo from 'expo-server-sdk';
import { z } from 'zod';
import { and, count, desc, eq } from 'drizzle-orm';
import { isLiveEntityId } from '@oxyhq/db';
import { requireOxyAuth, getRequiredOxyUserId } from '@oxyhq/core/server';
import type { Request, Response } from 'express';

import { authenticateToken } from '../middleware/auth.js';
import { getDb } from '../db/postgres.js';
import {
  notifications,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPES,
  type NotificationRow,
} from '../db/schema/notifications.js';
import { pushTokens, PUSH_PLATFORMS, webPushSubscriptions } from '../db/schema/pushTokens.js';
import {
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  dismissNotification,
} from '../lib/notification-service.js';
import { VAPID_PUBLIC_KEY } from '../lib/web-push.js';
import { log } from '../lib/logger.js';

const router = Router();

/** Ceiling on a page, whatever the caller asks for. */
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 30;

/** The wire shape — `oxyUserId` and delivery bookkeeping stay server-side. */
function serializeNotification(row: NotificationRow) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    data: row.data,
    status: row.status,
    priority: row.priority,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Public route (no auth) — VAPID public key for browser subscription ──
router.get('/vapid-public-key', (_req: Request, res: Response) => {
  if (!VAPID_PUBLIC_KEY) {
    return res.status(503).json({ error: 'Web push not configured' });
  }
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

router.use(authenticateToken, requireOxyAuth);

// GET /notifications — list user's notifications (paginated)
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);

    const paging = z
      .object({
        limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
        offset: z.coerce.number().int().min(0).default(0),
        status: z.enum(NOTIFICATION_STATUSES).optional(),
        type: z.enum(NOTIFICATION_TYPES).optional(),
      })
      .safeParse(req.query);
    if (!paging.success) {
      return res.status(400).json({ error: 'Invalid pagination or filter' });
    }

    const filters = [eq(notifications.oxyUserId, userId)];
    if (paging.data.status) filters.push(eq(notifications.status, paging.data.status));
    if (paging.data.type) filters.push(eq(notifications.type, paging.data.type));
    const where = and(...filters);

    const db = getDb();
    const [rows, [totals], unreadCount] = await Promise.all([
      db
        .select()
        .from(notifications)
        .where(where)
        .orderBy(desc(notifications.createdAt))
        .limit(paging.data.limit)
        .offset(paging.data.offset),
      db.select({ value: count() }).from(notifications).where(where),
      getUnreadCount(userId),
    ]);

    res.json({
      notifications: rows.map(serializeNotification),
      total: totals?.value ?? 0,
      unreadCount,
    });
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Error listing notifications');
    res.status(500).json({ error: 'Failed to list notifications' });
  }
});

// GET /notifications/unread-count
router.get('/unread-count', async (req: Request, res: Response) => {
  try {
    const value = await getUnreadCount(getRequiredOxyUserId(req));
    res.json({ count: value });
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Error getting unread count');
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// PATCH /notifications/:id/read — mark single notification as read
router.patch('/:id/read', async (req: Request, res: Response) => {
  try {
    const notificationId = req.params.id;
    if (typeof notificationId !== 'string' || !isLiveEntityId(notificationId)) {
      return res.status(400).json({ error: 'Invalid notification id' });
    }
    const success = await markAsRead(notificationId, getRequiredOxyUserId(req));
    if (!success) return res.status(404).json({ error: 'Notification not found' });
    res.json({ success: true });
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Error marking notification as read');
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// POST /notifications/read-all — mark all notifications as read
router.post('/read-all', async (req: Request, res: Response) => {
  try {
    const marked = await markAllAsRead(getRequiredOxyUserId(req));
    res.json({ success: true, count: marked });
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Error marking all as read');
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

// PATCH /notifications/:id/dismiss — dismiss a notification
router.patch('/:id/dismiss', async (req: Request, res: Response) => {
  try {
    const notificationId = req.params.id;
    if (typeof notificationId !== 'string' || !isLiveEntityId(notificationId)) {
      return res.status(400).json({ error: 'Invalid notification id' });
    }
    const success = await dismissNotification(notificationId, getRequiredOxyUserId(req));
    if (!success) return res.status(404).json({ error: 'Notification not found' });
    res.json({ success: true });
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Error dismissing notification');
    res.status(500).json({ error: 'Failed to dismiss notification' });
  }
});

// ── Push Token Management ─────────────────────────────────────────

// POST /notifications/push-token — register or update an Expo push token
router.post('/push-token', async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);

    const parsed = z
      .object({
        token: z.string().min(1),
        deviceId: z.string().optional(),
        platform: z.enum(PUSH_PLATFORMS).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Push token is required' });
    }
    if (!Expo.isExpoPushToken(parsed.data.token)) {
      return res.status(400).json({ error: 'Invalid Expo push token format' });
    }

    // Re-registering the same device reactivates its row rather than adding a
    // second one — the unique index on (user, token) is what makes that upsert
    // land on the existing row.
    const [row] = await getDb()
      .insert(pushTokens)
      .values({
        oxyUserId: userId,
        token: parsed.data.token,
        deviceId: parsed.data.deviceId,
        platform: parsed.data.platform,
        active: true,
      })
      .onConflictDoUpdate({
        target: [pushTokens.oxyUserId, pushTokens.token],
        set: {
          active: true,
          ...(parsed.data.deviceId ? { deviceId: parsed.data.deviceId } : {}),
          ...(parsed.data.platform ? { platform: parsed.data.platform } : {}),
          updatedAt: new Date(),
        },
      })
      .returning({ id: pushTokens.id });

    log.general.info({ userId, tokenId: row.id }, 'Push token registered');
    res.json({ success: true, id: row.id });
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Error registering push token');
    res.status(500).json({ error: 'Failed to register push token' });
  }
});

// DELETE /notifications/push-token — deactivate a push token (logout / uninstall)
router.delete('/push-token', async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);
    const parsed = z.object({ token: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Push token is required' });
    }

    const updated = await getDb()
      .update(pushTokens)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(pushTokens.oxyUserId, userId), eq(pushTokens.token, parsed.data.token)))
      .returning({ id: pushTokens.id });

    if (updated.length === 0) {
      return res.status(404).json({ error: 'Push token not found' });
    }

    log.general.info({ userId }, 'Push token deactivated');
    res.json({ success: true });
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Error deactivating push token');
    res.status(500).json({ error: 'Failed to deactivate push token' });
  }
});

// ── Web Push Subscription Management ─────────────────────────────

// POST /notifications/web-push-subscription — save browser push subscription
router.post('/web-push-subscription', async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);
    const parsed = z
      .object({
        endpoint: z.string().url(),
        keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Subscription endpoint and keys (p256dh, auth) are required' });
    }

    const [row] = await getDb()
      .insert(webPushSubscriptions)
      .values({
        oxyUserId: userId,
        endpoint: parsed.data.endpoint,
        keys: parsed.data.keys,
        active: true,
      })
      .onConflictDoUpdate({
        target: [webPushSubscriptions.oxyUserId, webPushSubscriptions.endpoint],
        set: { active: true, keys: parsed.data.keys, updatedAt: new Date() },
      })
      .returning({ id: webPushSubscriptions.id });

    log.general.info({ userId, subscriptionId: row.id }, 'Web push subscription registered');
    res.json({ success: true, id: row.id });
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Error registering web push subscription');
    res.status(500).json({ error: 'Failed to register web push subscription' });
  }
});

// DELETE /notifications/web-push-subscription — deactivate browser push subscription
router.delete('/web-push-subscription', async (req: Request, res: Response) => {
  try {
    const userId = getRequiredOxyUserId(req);
    const parsed = z.object({ endpoint: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Subscription endpoint is required' });
    }

    const updated = await getDb()
      .update(webPushSubscriptions)
      .set({ active: false, updatedAt: new Date() })
      .where(
        and(
          eq(webPushSubscriptions.oxyUserId, userId),
          eq(webPushSubscriptions.endpoint, parsed.data.endpoint),
        ),
      )
      .returning({ id: webPushSubscriptions.id });

    if (updated.length === 0) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    log.general.info({ userId }, 'Web push subscription deactivated');
    res.json({ success: true });
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Error deactivating web push subscription');
    res.status(500).json({ error: 'Failed to deactivate web push subscription' });
  }
});

export default router;
