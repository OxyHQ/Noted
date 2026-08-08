/**
 * The expiry registry — Noted's replacement for Mongo's TTL indexes.
 *
 * Postgres has no TTL index. Every collection that carried `expireAfterSeconds`
 * before the port needs an entry here, or its table grows forever with no error,
 * no failing test and no symptom of any kind until the disk fills. It is the
 * quietest failure in a Mongo-to-Postgres port precisely because the thing doing
 * the work was never in this codebase to be missed.
 *
 * Both entries below were TTL indexes on the Mongo models they replace. Each was
 * checked for INTENT rather than replicated blindly: deleting really is what
 * should happen to both, and neither table holds unprocessed work that a stalled
 * consumer would lose to the sweep.
 *
 * Scheduling lives with the reminder scheduler in `lib/reminders.ts`, which is
 * already the one periodic job this service runs.
 */

import {
  sweepAllExpiredRows,
  type ExpirySweepResult,
  type ExpirySweepTarget,
} from '@oxyhq/db/expiry';

import { log } from '../lib/logger.js';
import { getDb } from './postgres.js';
import { notes } from './schema/notes.js';
import { notifications } from './schema/notifications.js';

const DAY_SECONDS = 24 * 60 * 60;

/**
 * How long a deleted note's tombstone is retained.
 *
 * It only has to outlive the longest plausible offline stretch of a client that
 * still holds the note — after this, a client returning from the dead re-uploads
 * a note the user deleted. A month is generous for that and bounded.
 */
export const DELETED_NOTE_TTL_DAYS = 30;

/** How long a dismissed notification is kept before it is dropped. */
export const DISMISSED_NOTIFICATION_TTL_DAYS = 90;

const TARGETS: readonly ExpirySweepTarget[] = [
  {
    table: notes,
    column: notes.deletedAt,
    retentionSeconds: DELETED_NOTE_TTL_DAYS * DAY_SECONDS,
    reason:
      'Tombstone of a note deleted forever, kept only so an offline client stops ' +
      're-uploading it. Its content is cleared at deletion time, and every read ' +
      'filters `deletedAt is null` independently of this sweep, so a row still ' +
      'awaiting the sweep is never visible as a note.',
  },
  {
    table: notifications,
    column: notifications.dismissedAt,
    retentionSeconds: DISMISSED_NOTIFICATION_TTL_DAYS * DAY_SECONDS,
    reason:
      'Notification the user dismissed. Only dismissed ones expire, which is why ' +
      'the column is `dismissedAt` and not `createdAt`: a sweep target has no ' +
      'predicate, and a NULL never matches `column <= now() - retention`, so the ' +
      'nullable column IS the filter. Registering `createdAt` — the column Mongo ' +
      'TTL-indexed, with a partial filter it could express and this cannot — ' +
      'would delete every notification past the retention, dismissed or not.',
  },
];

/** Delete everything past its retention. Safe to call on a schedule. */
export async function sweepExpired(): Promise<ExpirySweepResult[]> {
  const results = await sweepAllExpiredRows(getDb(), TARGETS);
  const deleted = results.reduce((total, result) => total + result.deleted, 0);
  if (deleted > 0) log.general.info({ deleted }, 'Expiry sweep removed rows');
  return results;
}
