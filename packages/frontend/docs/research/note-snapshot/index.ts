/**
 * Disconnected research only. A snapshot of SQLite rows cannot reserve or copy
 * external audio and does not establish account authority or prevent sending.
 */
import type { Statement } from '@/lib/db/client';

const SOURCES = [
  ['notes', 'id = ?'],
  ['outbox', "entity = 'note' AND entity_id = ?"],
  ['note_labels', 'note_id = ?'],
  ['labels', 'id IN (SELECT label_id FROM note_labels WHERE note_id = ?)'],
  ['folders', 'id IN (SELECT folder_id FROM notes WHERE id = ?)'],
  ['captures', 'note_id = ?'],
  ['transcript_segments', 'capture_id IN (SELECT id FROM captures WHERE note_id = ?)'],
  ['note_artifacts', 'note_id = ?'],
  ['note_item_overrides', 'note_id = ?'],
  ['attachment_links', 'note_id = ?'],
] as const;

/** Test-only schema. CTAS copies columns and values, not production constraints. */
export const SNAPSHOT_SCHEMA = [
  `CREATE TABLE research_note_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    source_note_id TEXT NOT NULL,
    source_outbox_id INTEGER NOT NULL,
    observed_at TEXT NOT NULL
  )`,
  ...SOURCES.map(
    ([table]) =>
      `CREATE TABLE research_snapshot_${table} AS SELECT CAST(NULL AS TEXT) AS snapshot_id, * FROM ${table} WHERE 0`,
  ),
] as const;

/**
 * Execute the complete array in one account-pinned transaction after verifying
 * a 410 NOTE_DELETED response. The caller must check expectedRowsAffected and
 * must not interpret the result as ownership of any physical object.
 */
export function snapshotRefusedNote(
  snapshotId: string,
  noteId: string,
  outboxId: number,
  now: string,
): Statement[] {
  return [
    {
      sql: `INSERT INTO research_note_snapshots (id, source_note_id, source_outbox_id, observed_at)
        SELECT ?, n.id, o.id, ? FROM notes n
        JOIN outbox o ON o.entity = 'note' AND o.entity_id = n.id
        WHERE n.id = ? AND n.deleted_at IS NULL AND o.id = ? AND o.op = 'upsert'`,
      params: [snapshotId, now, noteId, outboxId],
      expectedRowsAffected: 1,
    },
    ...SOURCES.map(([table, where]) => ({
      sql: `INSERT INTO research_snapshot_${table} SELECT ?, * FROM ${table} WHERE ${where}`,
      params: [snapshotId, noteId],
      ...(table === 'notes' ? { expectedRowsAffected: 1 } : {}),
    })),
  ];
}

/** Read-only preview of one snapshot; it is not a recoverable recording. */
export const SNAPSHOT_PREVIEW_SQL = `SELECT id, title, blocks_json, body_text
  FROM research_snapshot_notes WHERE snapshot_id = ?`;
