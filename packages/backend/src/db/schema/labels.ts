/**
 * `labels` — the user-defined tags a note can carry.
 *
 * A note references these by id in its own `labels` array rather than through a
 * join table (see `notes.ts`), so nothing here points at `notes` either.
 */

import { pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, generatedId, updatedAt } from '@oxyhq/db';
import { NOTE_COLORS } from '@noted/shared-types';

export const labels = pgTable(
  'labels',
  {
    id: generatedId(),
    /** An Oxy account id — a foreign service's key, so no foreign key here. */
    oxyUserId: text().notNull(),
    name: text().notNull(),
    /** Null means "no colour"; the note's own colour shows through. */
    color: text({ enum: NOTE_COLORS }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One name per user, which is also the "this user's labels" read path.
    uniqueIndex('labels_oxy_user_id_name_idx').on(t.oxyUserId, t.name),
  ],
);

export type LabelRow = typeof labels.$inferSelect;
export type NewLabelRow = typeof labels.$inferInsert;
