/**
 * Reminder sweep — delivers note reminders.
 *
 * A BullMQ repeatable job runs every minute (leader-elected by BullMQ itself
 * via the shared queue), finds notes whose `reminderAt` is due and not yet
 * delivered, and sends a push/in-app notification. Entirely gated on
 * `REDIS_URL`: with no Redis configured, reminders are simply not delivered
 * (the field is still stored and returned).
 */

import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { and, eq, isNotNull, isNull, lte } from 'drizzle-orm';

import { getRedisConnection } from './redis.js';
import { getDb } from '../db/postgres.js';
import { sweepExpired } from '../db/expiry.js';
import { notes } from '../db/schema/notes.js';
import { sendNotification } from './notification-service.js';
import { log } from './logger.js';
import { publishReminderDueEvent } from '../capabilities/noted.events.js';

// BullMQ queue names cannot contain ':'.
const QUEUE_NAME = 'noted-reminders';
const SWEEP_JOB = 'reminder-sweep';
const SWEEP_EVERY_MS = 60_000;

let queue: Queue | null = null;
let worker: Worker | null = null;

/** How many reminders one sweep delivers before leaving the rest for the next. */
const SWEEP_BATCH = 500;

/** Longest preview of a note's body a reminder carries. */
const REMINDER_BODY_LENGTH = 200;

/** Find and deliver all due, undelivered reminders. */
async function sweepDueReminders(): Promise<number> {
  const db = getDb();
  const due = await db
    .select({
      id: notes.id,
      oxyUserId: notes.oxyUserId,
      title: notes.title,
      body: notes.body,
      reminderAt: notes.reminderAt,
    })
    .from(notes)
    .where(
      and(
        isNotNull(notes.reminderAt),
        lte(notes.reminderAt, new Date()),
        isNull(notes.reminderSentAt),
        eq(notes.trashed, false),
        // Deleting a note clears its reminder, so this is redundant today — and
        // stated anyway, because "a deleted note never notifies" should hold no
        // matter what a future delete path forgets to clear.
        isNull(notes.deletedAt),
      ),
    )
    .limit(SWEEP_BATCH);

  let delivered = 0;
  for (const note of due) {
    const claimedAt = new Date();
    const [claimed] = await db
      .update(notes)
      .set({ reminderSentAt: claimedAt })
      .where(and(eq(notes.id, note.id), isNull(notes.reminderSentAt)))
      .returning({ id: notes.id });
    if (!claimed) continue;

    try {
      await sendNotification({
        userId: note.oxyUserId,
        type: 'reminder',
        title: note.title || 'Note reminder',
        body: note.body.slice(0, REMINDER_BODY_LENGTH) || 'You have a note reminder.',
        data: { noteId: note.id },
      });
      if (note.reminderAt) {
        await publishReminderDueEvent({
          accountId: note.oxyUserId,
          noteId: note.id,
          reminderAt: note.reminderAt,
        });
      }
      delivered += 1;
    } catch (error: unknown) {
      // Release only this worker's claim. A newer reminder edit resets the
      // column to NULL and must not be overwritten by this failed delivery.
      await db
        .update(notes)
        .set({ reminderSentAt: null })
        .where(and(eq(notes.id, note.id), eq(notes.reminderSentAt, claimedAt)));
      log.notes.error({ err: error, noteId: note.id }, 'Failed to deliver note reminder');
    }
  }
  return delivered;
}

/**
 * Start the reminder sweep. No-op (returns false) when REDIS_URL is unset.
 */
export async function startReminderScheduler(): Promise<boolean> {
  const connection = getRedisConnection();
  if (!connection) {
    log.notes.info('REDIS_URL not set — reminder scheduler disabled');
    return false;
  }

  const bullConnection = connection as ConnectionOptions;
  queue = new Queue(QUEUE_NAME, { connection: bullConnection });

  // Idempotent repeatable job — re-registering with the same id is safe.
  await queue.add(
    SWEEP_JOB,
    {},
    { repeat: { every: SWEEP_EVERY_MS }, removeOnComplete: true, removeOnFail: 100 },
  );

  worker = new Worker(
    QUEUE_NAME,
    async () => {
      const delivered = await sweepDueReminders();
      if (delivered > 0) log.notes.info({ delivered }, 'Delivered note reminders');
      // Postgres has no TTL index, so expired rows are only removed because
      // something calls the sweep. This is the service's one periodic job, so
      // it is where that call belongs. A failure here must not stop reminders.
      await sweepExpired().catch((error: unknown) => {
        log.general.error({ err: error }, 'Expiry sweep failed');
      });
    },
    { connection: bullConnection },
  );

  worker.on('failed', (_job, err) => {
    log.notes.error({ err }, 'Reminder sweep job failed');
  });

  log.notes.info('Reminder scheduler started');
  return true;
}

/** Stop the scheduler (used on graceful shutdown). */
export async function stopReminderScheduler(): Promise<void> {
  await worker?.close();
  await queue?.close();
  worker = null;
  queue = null;
}
