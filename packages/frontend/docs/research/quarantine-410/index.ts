/**
 * Disconnected research. The caller must supply an account-pinned SQLite
 * transaction and a verified 410 NOTE_DELETED response; neither is provided here.
 */
import type { Statement } from '@/lib/db/client';

export const RESEARCH_SCHEMA = [
  `CREATE TABLE research_quarantine_410 (
    note_id TEXT PRIMARY KEY NOT NULL,
    source_outbox_id INTEGER NOT NULL,
    reason TEXT NOT NULL CHECK (reason = 'NOTE_DELETED'),
    observed_at TEXT NOT NULL
  )`,
  `CREATE TABLE research_recovered_text (
    id TEXT PRIMARY KEY NOT NULL,
    source_note_id TEXT NOT NULL,
    title TEXT NOT NULL,
    blocks_json TEXT NOT NULL,
    body_text TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
] as const;

/** Mark only the exact still-existing upsert row and note. Repeating it is idempotent. */
export function stageGone(noteId: string, outboxId: number, now: string): Statement {
  return {
    sql: `INSERT INTO research_quarantine_410 (note_id, source_outbox_id, reason, observed_at)
      SELECT n.id, o.id, 'NOTE_DELETED', ? FROM notes n
      JOIN outbox o ON o.entity = 'note' AND o.entity_id = n.id
      WHERE n.id = ? AND n.deleted_at IS NULL AND o.id = ? AND o.op = 'upsert'
      ON CONFLICT (note_id) DO UPDATE SET note_id = excluded.note_id
      WHERE source_outbox_id = excluded.source_outbox_id`,
    params: [now, noteId, outboxId],
    expectedRowsAffected: 1,
  };
}

/** A candidate selector for cooperating syncers only, never authorization to send. */
export const RESEARCH_READY_SQL = `SELECT o.id, o.entity_id, o.op FROM outbox o
  WHERE o.next_attempt_at <= ? AND o.attempts < ? AND NOT EXISTS (
    SELECT 1 FROM research_quarantine_410 q WHERE o.entity = 'note' AND q.note_id = o.entity_id
  ) ORDER BY o.id ASC LIMIT 200`;

/** A limited preview; this is not a snapshot of attachments, audio or all note data. */
export const RESEARCH_PREVIEW_SQL = `SELECT n.id, n.title, n.blocks_json, n.body_text,
  (SELECT COUNT(*) FROM captures c WHERE c.note_id = n.id) AS capture_count
  FROM research_quarantine_410 q JOIN notes n ON n.id = q.note_id
  WHERE q.note_id = ? AND n.deleted_at IS NULL`;

export type TextPreview = { id: string; title: string; blocks_json: string; body_text: string };

/**
 * Model an explicit, text-only recovery into an isolated draft table. The caller
 * must verify the current account and get confirmation before executing this in
 * the same SQLite transaction. It refuses if the previewed text changed.
 */
export function copyConfirmedText(preview: TextPreview, draftId: string, now: string): Statement {
  return {
    sql: `INSERT INTO research_recovered_text (id, source_note_id, title, blocks_json, body_text, created_at)
      SELECT ?, n.id, n.title, n.blocks_json, n.body_text, ?
      FROM research_quarantine_410 q JOIN notes n ON n.id = q.note_id
      WHERE n.id = ? AND n.deleted_at IS NULL AND n.title = ? AND n.blocks_json = ? AND n.body_text = ?
      ON CONFLICT (id) DO UPDATE SET id = excluded.id
      WHERE source_note_id = excluded.source_note_id AND title = excluded.title
        AND blocks_json = excluded.blocks_json AND body_text = excluded.body_text
        AND created_at = excluded.created_at`,
    params: [draftId, now, preview.id, preview.title, preview.blocks_json, preview.body_text],
    expectedRowsAffected: 1,
  };
}
