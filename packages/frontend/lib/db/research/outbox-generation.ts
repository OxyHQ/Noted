/**
 * Disconnected research only. No production sync, pull, erase, or UI calls this.
 * These statements do not establish identity, snapshot audio, authorize a
 * request, or make old clients and other processes cooperate.
 */
import type { Statement } from '@/lib/db/client';

export const RESEARCH_MIGRATION = [
  'ALTER TABLE outbox ADD COLUMN generation TEXT',
  'ALTER TABLE outbox ADD COLUMN generation_mixed INTEGER NOT NULL DEFAULT 0',
] as const;

/**
 * These two statements must run in one account-pinned SQLite transaction. The
 * caller is responsible for establishing that the generation came from the
 * opt-in server protocol; a missing, disabled or legacy response is not proof.
 * Mismatched and legacy rows become permanently blocked, including on A-B-A.
 */
export function recordVerifiedGeneration(generation: string): Statement[] {
  if (typeof generation !== 'string' || !generation.trim()) {
    throw new Error('A verified generation is required');
  }
  return [
    {
      sql: `UPDATE outbox SET generation_mixed = 1
            WHERE generation IS NULL OR generation != ?`,
      params: [generation],
    },
    {
      sql: `INSERT INTO sync_state (key, value) VALUES ('notes_generation', ?)
            ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      params: [generation],
    },
  ];
}

/**
 * Add this to the SAME transaction as the edit. A pre-existing unknown,
 * mismatched or blocked intent rejects the edit rather than overwriting it.
 * The transaction runner must enforce expectedRowsAffected and roll back all
 * preceding statements on failure. First edits made offline remain unknown.
 */
export function guardedEnqueue(entityId: string, op: 'upsert' | 'delete', now: string): Statement {
  return {
    sql: `INSERT INTO outbox (entity, entity_id, op, payload_json, attempts, next_attempt_at, created_at, generation)
          VALUES ('note', ?, ?, '{}', 0, ?, ?, (SELECT value FROM sync_state WHERE key = 'notes_generation'))
          ON CONFLICT (entity, entity_id) DO UPDATE SET
            op = excluded.op, attempts = 0, last_error = NULL, next_attempt_at = excluded.next_attempt_at
          WHERE outbox.generation_mixed = 0 AND outbox.generation IS NOT NULL
            AND outbox.generation = excluded.generation`,
    params: [entityId, op, now, now],
    expectedRowsAffected: 1,
  };
}

/**
 * Preflight is a read-only diagnostic, not permission to send. A server-enforced
 * generation precondition is still required on every mutation, and a local
 * payload snapshot and account-lifecycle barrier are not provided here.
 */
export const OUTBOX_PREFLIGHT_SQL = `SELECT COUNT(*) AS total,
  COALESCE(SUM(CASE WHEN generation IS NULL OR generation_mixed != 0 OR generation != ?
    THEN 1 ELSE 0 END), 0) AS blocked,
  EXISTS (SELECT 1 FROM sync_state WHERE key = 'notes_generation' AND value = ?) AS current
  FROM outbox`;

export type OutboxPreflight = { total: number; blocked: number; current: number };

/** Never treat a missing or malformed server generation as an empty outbox. */
export function canConsiderSending(generation: string | null, row: OutboxPreflight): boolean {
  return (
    typeof generation === 'string' &&
    Boolean(generation.trim()) &&
    Number.isSafeInteger(row.total) &&
    Number.isSafeInteger(row.blocked) &&
    row.total >= 0 &&
    row.blocked === 0 &&
    row.current === 1
  );
}
