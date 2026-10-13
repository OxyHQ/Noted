/**
 * `folders` — places to file notes.
 *
 * A note is in at most one folder, held as `notes.folderId`. Folders nest, to a
 * depth limited by `MAX_FOLDER_DEPTH` (see `lib/folders.ts`, which also keeps a
 * folder from becoming its own ancestor). Labels cover "this belongs to several
 * things"; a folder is the one place a note lives.
 */

import { sql } from 'drizzle-orm';
import { pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, generatedId, updatedAt } from '@oxy.so/db';

export const folders = pgTable(
  'folders',
  {
    id: generatedId(),
    /** An Oxy account id — a foreign service's key, so no foreign key here. */
    oxyUserId: text().notNull(),
    name: text().notNull(),
    /**
     * The folder this one sits in, or null at the top. Not a foreign key, for the
     * same reason as `notes.folderId`: deleting a folder re-parents its children
     * in the same transaction instead of cascading.
     */
    parentId: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One name per place: two folders may both be called "Reports" if they are in
    // different parents. `coalesce` because NULLs are distinct in a unique index,
    // which would let the same top-level name repeat.
    uniqueIndex('folders_oxy_user_id_parent_name_idx').on(
      t.oxyUserId,
      sql`coalesce(${t.parentId}, '')`,
      t.name,
    ),
  ],
);

export type FolderRow = typeof folders.$inferSelect;
