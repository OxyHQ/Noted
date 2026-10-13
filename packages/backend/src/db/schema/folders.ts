/**
 * `folders` — places to file notes.
 *
 * A note is in at most one folder, held as `notes.folderId`. Flat on purpose:
 * nesting is a different feature with different rules (moving a branch, cycles),
 * and labels already cover "this belongs to several things".
 */

import { pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, generatedId, updatedAt } from '@oxy.so/db';

export const folders = pgTable(
  'folders',
  {
    id: generatedId(),
    /** An Oxy account id — a foreign service's key, so no foreign key here. */
    oxyUserId: text().notNull(),
    name: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One name per user, which is also the "this user's folders" read path.
    uniqueIndex('folders_oxy_user_id_name_idx').on(t.oxyUserId, t.name),
  ],
);

export type FolderRow = typeof folders.$inferSelect;
