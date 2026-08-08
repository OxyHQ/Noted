/**
 * Labels in the local store.
 *
 * Labels are read offline and written online, and that asymmetry is deliberate.
 * Reading them offline is not optional: a note's chips resolve their names and
 * colours here, so without a local copy every note loses its labels visually the
 * moment there is no connection — the exact situation the local store exists
 * for. Writing them offline is a different matter: creating or renaming a label
 * is rare, always user-initiated, and its failure is immediately visible to the
 * person who asked for it, so it does not need an outbox of its own.
 *
 * The list is small enough that a sync replaces it wholesale rather than
 * tracking a cursor per row.
 */

import { executeTransaction, type Statement } from '@/lib/db/client';
import { normalizeNoteColor, type Label } from '@noted/shared-types';
import type { Row } from '@/lib/db/client';

export interface LabelRow extends Row {
  id: string;
  name: string;
  color: string | null;
}

export const LABEL_LIST_SQL = `
SELECT id, name, color FROM labels WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE ASC
`;

export function rowsToLabels(rows: readonly LabelRow[]): Label[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color === null ? null : normalizeNoteColor(row.color),
  }));
}

/**
 * Replace the stored labels with the server's list.
 *
 * A delete-then-insert inside one transaction, because the server's list is the
 * whole truth: a label deleted on another device has to disappear here, and
 * there is no per-row tombstone to learn that from.
 */
export function replaceLabels(labels: readonly Label[], now: string): Statement[] {
  return [
    { sql: 'DELETE FROM labels', params: [] },
    ...labels.map((label) => ({
      sql: `INSERT INTO labels (id, name, color, updated_at, deleted_at, dirty)
            VALUES (?, ?, ?, ?, NULL, 0)`,
      params: [label.id, label.name, label.color, now],
    })),
  ];
}

/** Apply a fresh label list. */
export function saveLabels(labels: readonly Label[]): Promise<number[]> {
  return executeTransaction(replaceLabels(labels, new Date().toISOString()));
}
