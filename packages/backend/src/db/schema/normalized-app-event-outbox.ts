import type { NormalizedAppEvent } from '@oxyhq/contracts';
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { createdAt, generatedId, timestamptz } from '@oxyhq/db';

/** Durable, at-least-once delivery state for Noted's normalized app events. */
export const normalizedAppEventOutbox = pgTable(
  'normalized_app_event_outbox',
  {
    id: generatedId(),
    eventId: text().notNull(),
    event: jsonb().$type<NormalizedAppEvent>().notNull(),
    processedAt: timestamptz(),
    claimedAt: timestamptz(),
    claimedBy: text(),
    attempts: integer().notNull().default(0),
    failedAt: timestamptz(),
    lastError: text(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('normalized_app_event_outbox_event_id_key').on(t.eventId),
    check('normalized_app_event_outbox_attempts_check', sql`${t.attempts} >= 0`),
    index('normalized_app_event_outbox_pending_idx')
      .on(t.createdAt)
      .where(sql`${t.processedAt} is null and ${t.failedAt} is null`),
    index('normalized_app_event_outbox_dead_letter_idx')
      .on(t.failedAt)
      .where(sql`${t.failedAt} is not null`),
  ],
);

export type NormalizedAppEventOutboxRow = typeof normalizedAppEventOutbox.$inferSelect;
