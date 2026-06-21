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
import { getRedisConnection } from './redis.js';
import { Note } from '../models/note.js';
import { sendNotification } from './notification-service.js';
import { log } from './logger.js';

// BullMQ queue names cannot contain ':'.
const QUEUE_NAME = 'noted-reminders';
const SWEEP_JOB = 'reminder-sweep';
const SWEEP_EVERY_MS = 60_000;

let queue: Queue | null = null;
let worker: Worker | null = null;

/** Find and deliver all due, undelivered reminders. */
async function sweepDueReminders(): Promise<number> {
  const now = new Date();
  const due = await Note.find({
    reminderAt: { $ne: null, $lte: now },
    reminderSentAt: null,
    trashed: false,
  }).limit(500);

  let delivered = 0;
  for (const note of due) {
    try {
      await sendNotification({
        userId: note.oxyUserId.toString(),
        type: 'reminder',
        title: note.title || 'Note reminder',
        body: note.body.slice(0, 200) || 'You have a note reminder.',
        data: { noteId: note._id.toString() },
      });
      note.reminderSentAt = new Date();
      await note.save();
      delivered += 1;
    } catch (error: unknown) {
      log.notes.error({ err: error, noteId: note._id.toString() }, 'Failed to deliver note reminder');
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
