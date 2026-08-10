/**
 * Schema for the local store, applied in order and tracked by SQLite's own
 * `user_version`.
 *
 * Rules for changing this file:
 * - Never edit a shipped migration. Append a new one; installed apps only run
 *   the steps above their recorded version.
 * - Every migration is one array of statements run inside a single transaction,
 *   so a failure half-way leaves the recorded version untouched.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { createLogger } from '@oxyhq/core/logger';

const logger = createLogger('NotedDB');

/**
 * `notes` mirrors the `Note` DTO of `@noted/shared-types` with three columns the
 * wire contract has no need for:
 * - `dirty`: the row holds local edits the server has not acknowledged, so a
 *   pull must not overwrite its body.
 * - `server_updated_at`: the `updatedAt` last seen from the server, which is
 *   what conflict resolution compares against (`updated_at` moves on every
 *   local keystroke and would always look newer).
 * - `deleted_at`: a trashed note is still a note; this is the tombstone for
 *   "delete forever", kept so the deletion can still be pushed while offline.
 *
 * Labels live in `note_labels` rather than a JSON column so that filtering by
 * label is an indexed join instead of a scan, and so a label rename or delete
 * touches one place.
 */
export const MIGRATIONS: readonly (readonly string[])[] = [
  [
    `CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL DEFAULT 'note',
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      body_format TEXT NOT NULL DEFAULT 'plain',
      checklist_json TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT 'default',
      pinned INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      trashed INTEGER NOT NULL DEFAULT 0,
      attachments_json TEXT NOT NULL DEFAULT '[]',
      reminder_at TEXT,
      sort_order REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      dirty INTEGER NOT NULL DEFAULT 0,
      server_updated_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS notes_feed
      ON notes (trashed, archived, pinned DESC, sort_order)`,
    `CREATE INDEX IF NOT EXISTS notes_dirty ON notes (dirty) WHERE dirty = 1`,

    `CREATE TABLE IF NOT EXISTS labels (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      color TEXT,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      dirty INTEGER NOT NULL DEFAULT 0
    )`,

    `CREATE TABLE IF NOT EXISTS note_labels (
      note_id TEXT NOT NULL,
      label_id TEXT NOT NULL,
      PRIMARY KEY (note_id, label_id)
    )`,
    `CREATE INDEX IF NOT EXISTS note_labels_by_label ON note_labels (label_id)`,

    // One capture is one recording session: the audio file on disk plus how far
    // transcription got. `state` drives recovery on the next cold start.
    `CREATE TABLE IF NOT EXISTS captures (
      id TEXT PRIMARY KEY NOT NULL,
      note_id TEXT NOT NULL,
      state TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      audio_path TEXT NOT NULL DEFAULT '',
      audio_file_id TEXT,
      model_id TEXT,
      language TEXT,
      error_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS captures_by_note ON captures (note_id)`,
    `CREATE INDEX IF NOT EXISTS captures_by_state ON captures (state)`,

    `CREATE TABLE IF NOT EXISTS transcript_segments (
      id TEXT PRIMARY KEY NOT NULL,
      capture_id TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      text TEXT NOT NULL,
      confidence REAL,
      speaker_hint TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS transcript_segments_by_capture
      ON transcript_segments (capture_id, start_ms)`,

    // The outbox is the only thing that talks to the API on the write path.
    // `next_attempt_at` carries the backoff; `attempts` bounds it.
    //
    // One row per entity, not per edit: an `upsert` is an intent, and the
    // flusher reads the note's current state when it sends. Twenty keystrokes
    // offline therefore collapse into one request instead of twenty replays of
    // superseded bodies.
    `CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      op TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_attempt_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (entity, entity_id)
    )`,
    `CREATE INDEX IF NOT EXISTS outbox_ready ON outbox (next_attempt_at, id)`,

    `CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value_json TEXT NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS stt_models (
      id TEXT PRIMARY KEY NOT NULL,
      path TEXT NOT NULL DEFAULT '',
      bytes INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL,
      downloaded_at TEXT
    )`,

    // Which account this database belongs to. Read before anything else on
    // startup — see `lib/db/viewer-cache.ts`.
    `CREATE TABLE IF NOT EXISTS cache_metadata (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    )`,
  ],

  // Speech is no longer the only thing this device downloads weights for: a
  // language model reads the transcript and writes the note. The table held
  // exactly what both need — a file, its size, its digest, its state — so it is
  // renamed for what it now holds rather than copied, and `kind` keeps the two
  // apart for callers that only care about one.
  [
    `ALTER TABLE stt_models RENAME TO model_files`,
    `ALTER TABLE model_files ADD COLUMN kind TEXT NOT NULL DEFAULT 'stt'`,
  ],

  // What the app itself wrote into a note, so the next pass can replace it
  // instead of treating it as the user's writing and appending another copy.
  // Local bookkeeping: it is never sent anywhere, and the note's `body` remains
  // the whole truth on the wire.
  [`ALTER TABLE notes ADD COLUMN generated_body TEXT NOT NULL DEFAULT ''`],

  // What a generator produced, as structure rather than as a string.
  //
  // `generated_body` above says WHICH text the app wrote and nothing about what
  // is inside it, so nothing can close a question two windows later, merge a
  // point somebody made twice, or protect the one checklist item the user
  // ticked. These tables hold the same contribution with its parts intact — see
  // `lib/artifact/types.ts` — and the old column stays beside them until the
  // whole pipeline reads from here.
  [
    // One row per (note, capture, stage): the provisional artifact and the
    // settled one are different rows on purpose, so finalisation can land
    // without a live pass having anything to overwrite.
    `CREATE TABLE IF NOT EXISTS note_artifacts (
      id TEXT PRIMARY KEY NOT NULL,
      note_id TEXT NOT NULL,
      capture_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      profile TEXT NOT NULL DEFAULT 'auto',
      intent TEXT NOT NULL DEFAULT 'freeform',
      transcript_revision INTEGER NOT NULL DEFAULT 0,
      artifact_revision INTEGER NOT NULL DEFAULT 0,
      doc_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS note_artifacts_slot
      ON note_artifacts (note_id, capture_id, stage)`,
    `CREATE INDEX IF NOT EXISTS note_artifacts_by_note ON note_artifacts (note_id)`,

    // What the user did to a generated item, keyed by that item's stable id.
    // The old code inferred this by looking for the generated block's exact text
    // inside the note, which cannot tell an edit from a paragraph typed after it
    // and cannot say anything at all about a checklist item.
    `CREATE TABLE IF NOT EXISTS note_item_overrides (
      note_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      text TEXT,
      checked INTEGER,
      removed INTEGER NOT NULL DEFAULT 0,
      adopted INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (note_id, item_id)
    )`,

    // Three machines instead of one enum: the microphone, the transcript and the
    // note finish at different moments, and `state` could only ever describe
    // whichever of them wrote last. `state` is still maintained alongside these
    // so a row stays readable to a build that has not migrated.
    `ALTER TABLE captures ADD COLUMN capture_status TEXT NOT NULL DEFAULT 'stopped'`,
    `ALTER TABLE captures ADD COLUMN transcription_status TEXT NOT NULL DEFAULT 'idle'`,
    `ALTER TABLE captures ADD COLUMN generation_status TEXT NOT NULL DEFAULT 'idle'`,
    `ALTER TABLE captures ADD COLUMN profile TEXT NOT NULL DEFAULT 'auto'`,
    `ALTER TABLE captures ADD COLUMN transcript_revision INTEGER NOT NULL DEFAULT 0`,

    // One statement per old state rather than a CASE, so a test can read the
    // mapping back out and check it against `lifecycleFromLegacyState` — the two
    // are the same fact written twice and would otherwise be free to drift.
    `UPDATE captures SET capture_status = 'recording', transcription_status = 'live',
       generation_status = 'live' WHERE state = 'recording'`,
    `UPDATE captures SET capture_status = 'interrupted', transcription_status = 'pending',
       generation_status = 'idle' WHERE state = 'interrupted'`,
    `UPDATE captures SET capture_status = 'stopped', transcription_status = 'running',
       generation_status = 'idle' WHERE state = 'transcribing'`,
    `UPDATE captures SET capture_status = 'stopped', transcription_status = 'complete',
       generation_status = 'complete' WHERE state = 'complete'`,
    `UPDATE captures SET capture_status = 'failed', transcription_status = 'failed',
       generation_status = 'idle' WHERE state = 'failed'`,

    // A segment's identity, so whisper re-emitting a slice as it fills updates
    // the row it already wrote instead of leaving a shorter copy of the same
    // sentence behind it.
    `ALTER TABLE transcript_segments ADD COLUMN slice_index INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE transcript_segments ADD COLUMN segment_index INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE transcript_segments ADD COLUMN revision INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE transcript_segments ADD COLUMN is_final INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE transcript_segments ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''`,
    // Existing rows have no logical key — they were written before there was one
    // — so each is given a distinct position rather than being left to collide
    // under the unique index below, which would fail the migration and strand
    // every device that already has a transcript.
    `UPDATE transcript_segments SET segment_index = rowid, updated_at = created_at`,
    `CREATE UNIQUE INDEX IF NOT EXISTS transcript_segments_logical
      ON transcript_segments (capture_id, slice_index, segment_index)`,
  ],

  // Making a note better is not the same operation as writing one, and one
  // column could not say both. A model that failed to load reported "Noted could
  // not finish the notes" over a finished document — the most alarming sentence
  // in the app, about a note sitting on the user's screen.
  //
  // `pending` for existing rows because that is what they were: nothing had
  // tried. A capture that genuinely finished is corrected below, so a note that
  // is already as good as it will get does not offer to redo itself.
  [
    `ALTER TABLE captures ADD COLUMN enhancement_status TEXT NOT NULL DEFAULT 'pending'`,

    `UPDATE captures SET enhancement_status = 'complete'
       WHERE generation_status = 'complete' AND transcription_status = 'complete'`,
  ],

  // WHY the enhancement did not land, kept apart from `error_code`.
  // `enhancement_status` alone could only ever say "unsupported", which the user
  // reads as a statement about their device — and it was that for a truncated
  // reply, a parser rejection and a lost commit race alike. This column is what
  // lets the screen name the actual reason and offer a retry where one helps.
  //
  // ITS OWN MIGRATION, and that is the whole lesson. It was first written into
  // the entry above, which every existing database had already applied: a
  // migration list keyed on `user_version` only ever runs entries a device has
  // not reached, so a statement appended to an old one is a statement that
  // never runs. A fresh install worked perfectly and every real device failed
  // with `no such column: enhancement_reason` — on the FIRST WRITE, which is
  // starting a recording.
  [`ALTER TABLE captures ADD COLUMN enhancement_reason TEXT`],
];

/** Every table this schema owns, newest first for dependency-free deletion. */
export const LOCAL_TABLES: readonly string[] = [
  'note_item_overrides',
  'note_artifacts',
  'transcript_segments',
  'captures',
  'note_labels',
  'notes',
  'labels',
  'outbox',
  'sync_state',
  'app_settings',
  'model_files',
  'cache_metadata',
];

export async function migrate(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current >= MIGRATIONS.length) return;

  for (let version = current; version < MIGRATIONS.length; version += 1) {
    await db.execAsync('BEGIN IMMEDIATE');
    try {
      for (const statement of MIGRATIONS[version]) {
        await db.execAsync(statement);
      }
      // PRAGMA does not take bound parameters; the value is a loop counter.
      await db.execAsync(`PRAGMA user_version = ${version + 1}`);
      await db.execAsync('COMMIT');
    } catch (error) {
      await db.execAsync('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }
  logger.info('Local schema migrated', { from: current, to: MIGRATIONS.length });
}
