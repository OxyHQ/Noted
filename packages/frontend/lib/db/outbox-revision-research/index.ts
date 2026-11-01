/** Disconnected research: these statements are not applied by production. */
export const REVISION_RESEARCH_MIGRATION = [
  'ALTER TABLE outbox ADD COLUMN revision INTEGER NOT NULL DEFAULT 0',
  `CREATE TRIGGER outbox_update_revision AFTER UPDATE ON outbox
   WHEN NEW.revision = OLD.revision
   BEGIN
     SELECT CASE WHEN OLD.revision >= 9007199254740991 THEN RAISE(ABORT, 'Outbox revision exhausted') END;
     UPDATE outbox SET revision = OLD.revision + 1 WHERE id = NEW.id;
   END`,
] as const;

/** Check the original row and revision before acknowledging its note. */
export const ACK_RESEARCH_SQL = `UPDATE notes SET dirty = 0 WHERE id = ? AND updated_at = ? AND EXISTS (
  SELECT 1 FROM outbox WHERE id = ? AND revision = ? AND op = 'upsert'
)`;

/** A replaced or modified intent must survive the response to an older request. */
export const RETIRE_RESEARCH_SQL = `DELETE FROM outbox WHERE id = ? AND revision = ? AND NOT EXISTS (
  SELECT 1 FROM notes WHERE notes.id = outbox.entity_id AND notes.dirty = 1
)`;

/** A failed request must not apply backoff to a newer intent. */
export const BACKOFF_RESEARCH_SQL = `UPDATE outbox SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ? AND revision = ?`;
