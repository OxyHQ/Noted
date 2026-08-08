/**
 * `notifications` — the record of what was delivered to a user, and the feed the
 * in-app notification screen reads.
 */

import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, generatedId, timestamptz, updatedAt } from '@oxyhq/db';

export const NOTIFICATION_TYPES = [
  'trigger_result',
  'proactive_insight',
  'daily_briefing',
  'price_alert',
  'integration_event',
  'reminder',
  'agent_task_complete',
  'chat_response_ready',
  'oxy_service',
] as const;

export const NOTIFICATION_CHANNELS = [
  'push',
  'telegram',
  'discord',
  'whatsapp',
  'slack',
  'in_app',
] as const;

export const NOTIFICATION_STATUSES = ['pending', 'sent', 'read', 'dismissed'] as const;
export const NOTIFICATION_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

/** Per-channel delivery outcome, keyed by channel name. */
export type DeliveryStatus = Record<string, 'pending' | 'sent' | 'failed'>;

export const notifications = pgTable(
  'notifications',
  {
    id: generatedId(),
    /** An Oxy account id — a foreign service's key, so no foreign key here. */
    oxyUserId: text().notNull(),
    type: text({ enum: NOTIFICATION_TYPES }).notNull(),
    title: text().notNull(),
    body: text().notNull(),
    /** Payload the client acts on (e.g. `{ noteId }` for a reminder). */
    data: jsonb().$type<Record<string, string>>().notNull().default({}),
    channels: text({ enum: NOTIFICATION_CHANNELS })
      .array()
      .notNull()
      .default(sql`'{}'`),
    deliveryStatus: jsonb().$type<DeliveryStatus>().notNull().default({}),
    status: text({ enum: NOTIFICATION_STATUSES })
      .notNull()
      .default('pending'),
    priority: text({ enum: NOTIFICATION_PRIORITIES })
      .notNull()
      .default('normal'),
    readAt: timestamptz(),
    /**
     * When the user dismissed this notification — and the deadline the expiry
     * sweep measures from.
     *
     * A column rather than a predicate because the sweep registry has no
     * predicate: it deletes where `column <= now() - retention`, and a NULL
     * never matches. Mongo expressed the same rule as a TTL index on
     * `createdAt` with `partialFilterExpression: { status: 'dismissed' }`;
     * registering `createdAt` here instead would delete EVERY notification past
     * the retention, dismissed or not.
     *
     * Kept in step with `status` by the dismiss route — the only place that
     * writes `status = 'dismissed'`.
     */
    dismissedAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // The notification screen: this user's, newest first.
    index('notifications_feed_idx').on(t.oxyUserId, t.status, t.createdAt.desc()),
    // The unread badge, which only ever counts these two states.
    index('notifications_unread_idx')
      .on(t.oxyUserId)
      .where(sql`${t.status} in ('pending', 'sent')`),
    // The expiry sweep's own read path.
    index('notifications_dismissed_at_idx')
      .on(t.dismissedAt)
      .where(sql`${t.dismissedAt} is not null`),
  ],
);

export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;
