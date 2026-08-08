/**
 * `push_tokens` and `web_push_subscriptions` — where a notification is sent.
 *
 * One row per device per user. Both tables keep an `active` flag rather than
 * deleting on failure, so a token that stops working leaves a trace of when it
 * did.
 */

import { boolean, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, generatedId, timestamptz, updatedAt } from '@oxyhq/db';

export const PUSH_PLATFORMS = ['ios', 'android', 'web'] as const;

export const pushTokens = pgTable(
  'push_tokens',
  {
    id: generatedId(),
    /** An Oxy account id — a foreign service's key, so no foreign key here. */
    oxyUserId: text().notNull(),
    /** An Expo push token. Belongs to Expo's service, not to this database. */
    token: text().notNull(),
    deviceId: text(),
    platform: text({ enum: PUSH_PLATFORMS }),
    active: boolean().notNull().default(true),
    lastUsedAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Registering the same device twice must update, not duplicate.
    uniqueIndex('push_tokens_oxy_user_id_token_idx').on(t.oxyUserId, t.token),
  ],
);

/** The `{ p256dh, auth }` pair a Web Push subscription is encrypted with. */
export interface WebPushKeys {
  p256dh: string;
  auth: string;
}

export const webPushSubscriptions = pgTable(
  'web_push_subscriptions',
  {
    id: generatedId(),
    /** An Oxy account id — a foreign service's key, so no foreign key here. */
    oxyUserId: text().notNull(),
    /** The push service's endpoint URL — a third party's address. */
    endpoint: text().notNull(),
    keys: jsonb().$type<WebPushKeys>().notNull(),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('web_push_subscriptions_oxy_user_id_endpoint_idx').on(t.oxyUserId, t.endpoint),
  ],
);

export type PushTokenRow = typeof pushTokens.$inferSelect;
export type NewPushTokenRow = typeof pushTokens.$inferInsert;
export type WebPushSubscriptionRow = typeof webPushSubscriptions.$inferSelect;
export type NewWebPushSubscriptionRow = typeof webPushSubscriptions.$inferInsert;
