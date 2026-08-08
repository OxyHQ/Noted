/**
 * `feedback` — the in-app support inbox (user → operator).
 *
 * Deliberately never routed anywhere else: a bug report carries the reporter's
 * device metadata and whatever they chose to describe, so it stays between the
 * user and the operators. See the CrowdSource note in the repo's `AGENTS.md`.
 */

import { index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, generatedId, updatedAt } from '@oxyhq/db';

export const FEEDBACK_TYPES = ['bug', 'feature', 'improvement', 'other'] as const;
export const FEEDBACK_STATUSES = ['pending', 'reviewed', 'resolved'] as const;

export const feedback = pgTable(
  'feedback',
  {
    id: generatedId(),
    /** An Oxy account id — a foreign service's key, so no foreign key here. */
    oxyUserId: text().notNull(),
    type: text({ enum: FEEDBACK_TYPES }).notNull(),
    /** 1–5 when the user rated the app; null when they only wrote a message. */
    rating: integer(),
    message: text().notNull(),
    email: text(),
    /** Platform, app version, device — whatever the client attached. */
    metadata: jsonb().$type<Record<string, string>>().notNull().default({}),
    status: text({ enum: FEEDBACK_STATUSES })
      .notNull()
      .default('pending'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('feedback_oxy_user_id_created_at_idx').on(t.oxyUserId, t.createdAt.desc()),
    // The operator's triage queue.
    index('feedback_status_created_at_idx').on(t.status, t.createdAt.desc()),
  ],
);

export type FeedbackRow = typeof feedback.$inferSelect;
export type NewFeedbackRow = typeof feedback.$inferInsert;
