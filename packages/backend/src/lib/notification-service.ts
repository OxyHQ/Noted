/**
 * Notification Service
 *
 * Delivers notifications to users via multiple channels:
 * - in_app: Socket.io real-time event
 * - push: Expo push notifications (mobile) and Web Push (browser)
 *
 * Each notification is persisted and can be delivered to several channels at
 * once; the per-channel outcome is recorded on the row.
 */

import Expo, { type ExpoPushMessage, type ExpoPushReceiptId } from 'expo-server-sdk';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { getDb } from '../db/postgres.js';
import {
  notifications,
  type DeliveryStatus,
  type NotificationRow,
} from '../db/schema/notifications.js';
import { pushTokens, webPushSubscriptions } from '../db/schema/pushTokens.js';
import { webPush, VAPID_PUBLIC_KEY } from './web-push.js';
import { getIO } from '../socket.js';
import { log } from './logger.js';

// ── Expo push singleton ──────────────────────────────────────────────
const expo = new Expo();

/** Longest body a push payload carries; the rest is in the app. */
const MAX_BODY_LENGTH = 4000;

/** Expo recommends reading receipts around 15 seconds after sending. */
const RECEIPT_CHECK_DELAY_MS = 15_000;

/** The states that count as "not yet seen by the user". */
const UNREAD_STATUSES = ['pending', 'sent'] as const;

type NotificationType = NotificationRow['type'];
type NotificationChannel = NotificationRow['channels'][number];
type NotificationPriority = NotificationRow['priority'];

export interface SendNotificationOptions {
  userId: string;
  sourceEventId?: string;
  type: NotificationType;
  title: string;
  body: string;
  priority?: NotificationPriority;
  channels?: NotificationChannel[];
  data?: Record<string, string>;
}

// ── Resolve delivery channels ──────────────────────────────────────

/**
 * Determine which channels to deliver a notification to.
 *
 * Explicit channels win. Otherwise it is in-app plus push, and push only when
 * the user actually has somewhere to receive it — a channel recorded as
 * attempted but with no destination would report a delivery failure for a user
 * who simply never enabled push.
 */
async function resolveChannels(
  userId: string,
  explicit?: NotificationChannel[],
): Promise<NotificationChannel[]> {
  if (explicit && explicit.length > 0) return explicit;

  const channels: NotificationChannel[] = ['in_app'];
  const db = getDb();

  const [expoTokens, webSubscriptions] = await Promise.all([
    db
      .select({ id: pushTokens.id })
      .from(pushTokens)
      .where(and(eq(pushTokens.oxyUserId, userId), eq(pushTokens.active, true)))
      .limit(1)
      .catch(() => []),
    VAPID_PUBLIC_KEY
      ? db
          .select({ id: webPushSubscriptions.id })
          .from(webPushSubscriptions)
          .where(
            and(
              eq(webPushSubscriptions.oxyUserId, userId),
              eq(webPushSubscriptions.active, true),
            ),
          )
          .limit(1)
          .catch(() => [])
      : [],
  ]);

  if (expoTokens.length > 0 || webSubscriptions.length > 0) channels.push('push');
  return channels;
}

// ── Channel delivery implementations ───────────────────────────────

function deliverInApp(notification: NotificationRow): boolean {
  const io = getIO();
  if (!io) return false;

  io.to(`user:${notification.oxyUserId}`).emit('notification', {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    priority: notification.priority,
    data: notification.data,
    createdAt: notification.createdAt.toISOString(),
  });

  return true;
}

// ── Expo Push Notifications ─────────────────────────────────────────

/**
 * Deliver a push notification to all of a user's registered Expo push tokens.
 * Handles chunked sending (Expo limit) and async receipt checking.
 */
async function deliverPush(userId: string, notification: NotificationRow): Promise<boolean> {
  const db = getDb();
  const tokens = await db
    .select()
    .from(pushTokens)
    .where(and(eq(pushTokens.oxyUserId, userId), eq(pushTokens.active, true)));

  if (tokens.length === 0) return false;

  // Build messages — one per device token
  const messages: ExpoPushMessage[] = [];
  const usableTokenIds: string[] = [];
  for (const row of tokens) {
    if (!Expo.isExpoPushToken(row.token)) {
      log.general.warn({ token: row.token, userId }, 'Invalid Expo push token, deactivating');
      await db
        .update(pushTokens)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(pushTokens.id, row.id));
      continue;
    }

    usableTokenIds.push(row.id);
    messages.push({
      to: row.token,
      title: notification.title,
      body: notification.body,
      data: {
        notificationId: notification.id,
        type: notification.type,
        ...notification.data,
      },
      sound: 'default',
      priority:
        notification.priority === 'urgent' || notification.priority === 'high' ? 'high' : 'normal',
      channelId: 'default',
    });
  }

  if (messages.length === 0) return false;

  // Send in chunks (Expo recommends batches of ~100)
  const chunks = expo.chunkPushNotifications(messages);
  const receiptIds: ExpoPushReceiptId[] = [];
  let anySucceeded = false;

  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);

      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        if (ticket.status === 'ok') {
          anySucceeded = true;
          if (ticket.id) receiptIds.push(ticket.id);
          continue;
        }

        const errorDetail = ticket as { status: 'error'; message: string; details?: { error: string } };
        const message = chunk[i];
        const token = Array.isArray(message.to) ? message.to[0] : message.to;
        log.general.warn(
          { userId, token, error: errorDetail.message, errorCode: errorDetail.details?.error },
          'Expo push ticket error',
        );

        // Deactivate tokens that are permanently invalid
        if (errorDetail.details?.error === 'DeviceNotRegistered') {
          await db
            .update(pushTokens)
            .set({ active: false, updatedAt: new Date() })
            .where(and(eq(pushTokens.oxyUserId, userId), eq(pushTokens.token, token)));
        }
      }
    } catch (error) {
      log.general.error({ err: error, userId }, 'Expo push chunk send failed');
    }
  }

  // Fire-and-forget receipt checking (delayed)
  if (receiptIds.length > 0) {
    const timer = setTimeout(() => {
      void checkPushReceipts(receiptIds).catch(() => undefined);
    }, RECEIPT_CHECK_DELAY_MS);
    // Never hold the process open for a receipt check.
    timer.unref?.();
  }

  if (anySucceeded && usableTokenIds.length > 0) {
    await db
      .update(pushTokens)
      .set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where(inArray(pushTokens.id, usableTokenIds));
  }

  return anySucceeded;
}

/**
 * Check push notification receipts after a delay.
 * Deactivates tokens that received DeviceNotRegistered errors.
 */
async function checkPushReceipts(receiptIds: ExpoPushReceiptId[]): Promise<void> {
  const chunks = expo.chunkPushNotificationReceiptIds(receiptIds);

  for (const chunk of chunks) {
    try {
      const receipts = await expo.getPushNotificationReceiptsAsync(chunk);

      for (const [receiptId, receipt] of Object.entries(receipts)) {
        if (receipt.status !== 'error') continue;
        const { message, details } = receipt;
        log.general.warn({ receiptId, message, error: details?.error }, 'Expo push receipt error');

        if (details?.error === 'DeviceNotRegistered') {
          // A receipt id cannot be mapped back to its token, so the token is
          // deactivated on the next send attempt instead.
          log.general.info(
            { receiptId },
            'Device not registered — token will be deactivated on next send',
          );
        }
      }
    } catch (error) {
      log.general.error({ err: error }, 'Failed to check Expo push receipts');
    }
  }
}

// ── Web Push Notifications ───────────────────────────────────────────

/** The status codes a push service returns for a subscription that is gone. */
const EXPIRED_SUBSCRIPTION_STATUSES = [404, 410];

function webPushStatusCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' ? statusCode : null;
}

/**
 * Deliver to all of a user's registered web push subscriptions, deactivating any
 * the push service reports as gone.
 */
async function deliverWebPush(userId: string, notification: NotificationRow): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY) return false;

  const db = getDb();
  const subscriptions = await db
    .select()
    .from(webPushSubscriptions)
    .where(
      and(eq(webPushSubscriptions.oxyUserId, userId), eq(webPushSubscriptions.active, true)),
    );

  if (subscriptions.length === 0) return false;

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    notificationId: notification.id,
    type: notification.type,
    ...notification.data,
  });

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webPush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
      } catch (error: unknown) {
        const statusCode = webPushStatusCode(error);
        if (statusCode !== null && EXPIRED_SUBSCRIPTION_STATUSES.includes(statusCode)) {
          await db
            .update(webPushSubscriptions)
            .set({ active: false, updatedAt: new Date() })
            .where(eq(webPushSubscriptions.id, sub.id));
          log.general.info(
            { userId, endpoint: sub.endpoint },
            'Web push subscription expired, deactivated',
          );
        } else {
          log.general.warn(
            { err: error, userId, endpoint: sub.endpoint },
            'Web push delivery failed',
          );
        }
        throw error; // Re-throw so Promise.allSettled marks this one as rejected
      }
    }),
  );

  return results.some((result) => result.status === 'fulfilled');
}

// ── Main send function ─────────────────────────────────────────────

/** Create and deliver a notification to a user across their channels. */
export async function sendNotification(
  options: SendNotificationOptions,
): Promise<NotificationRow> {
  const { userId, sourceEventId, type, title, body, priority = 'normal', data } = options;

  const channels = await resolveChannels(userId, options.channels);
  const db = getDb();

  const [inserted] = await db
    .insert(notifications)
    .values({
      oxyUserId: userId,
      sourceEventId,
      type,
      title,
      body: body.slice(0, MAX_BODY_LENGTH),
      data: data ?? {},
      channels,
      deliveryStatus: Object.fromEntries(channels.map((channel) => [channel, 'pending'])),
      status: 'sent',
      priority,
    })
    .onConflictDoNothing()
    .returning();

  if (!inserted) {
    if (!sourceEventId) throw new Error('Notification insert returned no row');
    const [existing] = await db
      .select()
      .from(notifications)
      .where(and(
        eq(notifications.sourceEventId, sourceEventId),
        eq(notifications.oxyUserId, userId),
      ));
    if (!existing) throw new Error('Notification idempotency conflict');
    return existing;
  }
  const notification = inserted;

  const deliveryStatus: DeliveryStatus = { ...notification.deliveryStatus };
  await Promise.allSettled(
    channels.map(async (channel) => {
      try {
        let success = false;
        if (channel === 'in_app') {
          success = deliverInApp(notification);
        } else if (channel === 'push') {
          // Mobile and browser in parallel; either one arriving is a delivery.
          const [expoPushOk, webPushOk] = await Promise.all([
            deliverPush(userId, notification),
            deliverWebPush(userId, notification),
          ]);
          success = expoPushOk || webPushOk;
        }
        deliveryStatus[channel] = success ? 'sent' : 'failed';
      } catch (error: unknown) {
        log.general.error({ err: error, channel, userId }, 'Notification delivery failed');
        deliveryStatus[channel] = 'failed';
      }
    }),
  );

  await db
    .update(notifications)
    .set({ deliveryStatus, updatedAt: new Date() })
    .where(eq(notifications.id, notification.id));

  log.general.info({ type, userId, channels, title: title.slice(0, 50) }, 'Notification sent');

  return { ...notification, deliveryStatus };
}

// ── Query helpers ──────────────────────────────────────────────────

export async function getUnreadCount(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ value: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.oxyUserId, userId),
        inArray(notifications.status, [...UNREAD_STATUSES]),
      ),
    );
  return row?.value ?? 0;
}

export async function markAsRead(notificationId: string, userId: string): Promise<boolean> {
  const updated = await getDb()
    .update(notifications)
    .set({ status: 'read', readAt: new Date(), updatedAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.oxyUserId, userId)))
    .returning({ id: notifications.id });
  return updated.length > 0;
}

export async function markAllAsRead(userId: string): Promise<number> {
  const updated = await getDb()
    .update(notifications)
    .set({ status: 'read', readAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(notifications.oxyUserId, userId),
        inArray(notifications.status, [...UNREAD_STATUSES]),
      ),
    )
    .returning({ id: notifications.id });
  return updated.length;
}

export async function dismissNotification(
  notificationId: string,
  userId: string,
): Promise<boolean> {
  const now = new Date();
  const updated = await getDb()
    .update(notifications)
    // `dismissedAt` is what the expiry sweep measures from, so it must move with
    // the status — a dismissed row without it is never reaped.
    .set({ status: 'dismissed', dismissedAt: now, updatedAt: now })
    .where(and(eq(notifications.id, notificationId), eq(notifications.oxyUserId, userId)))
    .returning({ id: notifications.id });
  return updated.length > 0;
}
