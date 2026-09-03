import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { normalizedAppEventSchema, type NormalizedAppEvent } from '@oxyhq/contracts';
import { and, asc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

import { oxyServiceClient } from '../capabilities/oxy-service-client.js';
import { getDb, type Database } from '../db/postgres.js';
import { normalizedAppEventOutbox } from '../db/schema/normalized-app-event-outbox.js';
import { notes, type NoteRow } from '../db/schema/notes.js';
import { log } from './logger.js';
import { sendNotification } from './notification-service.js';

export const NOTED_EVENT_OUTBOX_MAX_ATTEMPTS = 12;
export const NOTED_EVENT_OUTBOX_LEASE_MS = 60_000;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const MAX_RECORDED_ERROR_LENGTH = 500;
const REMINDER_BODY_LENGTH = 200;

export type NotedEventDelivery = (event: NormalizedAppEvent) => Promise<void>;
export type ReminderNotificationDelivery = (note: NoteRow, eventId: string) => Promise<void>;

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function enabled(name: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(process.env[name]?.trim().toLowerCase() ?? '');
}

function aliaApiUrl(): string {
  return (process.env.ALIA_API_URL ?? 'https://api.alia.onl').replace(/\/$/, '');
}

async function postEvent(event: NormalizedAppEvent, token: string): Promise<Response> {
  return fetch(`${aliaApiUrl()}/webhooks/oxy`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': event.eventId,
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(10_000),
  });
}

/** Authenticate as the Noted service; the outbox contains no credential material. */
export async function deliverNotedEvent(event: NormalizedAppEvent): Promise<void> {
  const parsed = normalizedAppEventSchema.parse(event);
  const client = oxyServiceClient();
  if (!client) throw new Error('Noted application credentials are not configured');
  let response = await postEvent(parsed, await client.getServiceToken());
  if (response.status === 401) {
    client.invalidateServiceToken();
    response = await postEvent(parsed, await client.getServiceToken());
  }
  if (!response.ok) {
    throw new Error(`Alia rejected Noted event (${response.status})`);
  }
}

async function deliverReminderNotification(note: NoteRow, eventId: string): Promise<void> {
  await sendNotification({
    userId: note.oxyUserId,
    sourceEventId: eventId,
    type: 'reminder',
    title: note.title || 'Note reminder',
    body: note.body.slice(0, REMINDER_BODY_LENGTH) || 'You have a note reminder.',
    data: { noteId: note.id },
  });
}

function reminderIdentity(event: NormalizedAppEvent): { noteId: string; reminderAt: Date } | null {
  if (event.type !== 'reminder') return null;
  const noteId = event.data.noteId;
  const reminderAtValue = event.data.reminderAt;
  if (typeof noteId !== 'string' || typeof reminderAtValue !== 'string') {
    throw new Error('Reminder event is missing noteId or reminderAt');
  }
  const reminderAt = new Date(reminderAtValue);
  if (Number.isNaN(reminderAt.getTime())) throw new Error('Reminder event has an invalid reminderAt');
  return { noteId, reminderAt };
}

async function activeReminder(
  db: Database,
  event: NormalizedAppEvent,
): Promise<NoteRow | null> {
  const identity = reminderIdentity(event);
  if (!identity) return null;
  const [note] = await db
    .select()
    .from(notes)
    .where(and(
      eq(notes.id, identity.noteId),
      eq(notes.oxyUserId, event.accountId),
      eq(notes.reminderAt, identity.reminderAt),
      isNotNull(notes.reminderQueuedAt),
      isNull(notes.reminderSentAt),
      eq(notes.trashed, false),
      isNull(notes.deletedAt),
    ));
  return note ?? null;
}

interface ReminderIdentity {
  noteId: string;
  reminderAt: Date;
}

export interface ClaimedNotedEventDependencies {
  loadReminder: (event: NormalizedAppEvent) => Promise<NoteRow | null>;
  deliver: NotedEventDelivery;
  notifyReminder: ReminderNotificationDelivery;
  acknowledge: (reminder: ReminderIdentity | null) => Promise<boolean>;
}

/**
 * Run every external effect before acknowledgement. A rejection from either
 * Alia or reminder notification delivery leaves acknowledgement untouched, so
 * the leased row remains retryable and `reminderSentAt` cannot advance.
 */
export async function processClaimedNotedEvent(
  event: NormalizedAppEvent,
  dependencies: ClaimedNotedEventDependencies,
): Promise<boolean> {
  const reminder = reminderIdentity(event);
  const note = reminder ? await dependencies.loadReminder(event) : null;
  // A reminder edit/delete makes its old queued event stale. Acknowledge it
  // without emitting; the newly edited reminder has its own event identity.
  if (!reminder || note) {
    await dependencies.deliver(event);
    if (note) await dependencies.notifyReminder(note, event.eventId);
  }
  return dependencies.acknowledge(note ? reminder : null);
}

export interface NotedEventOutboxBatchOptions {
  ownerId: string;
  batchSize?: number;
  leaseMs?: number;
  deliver?: NotedEventDelivery;
  notifyReminder?: ReminderNotificationDelivery;
}

export interface NotedEventOutboxBatchResult {
  claimed: number;
  processed: number;
  failed: number;
  deadLettered: number;
}

function claimableEvents(db: Database, claimedBefore: Date, limit: number) {
  return db
    .select({ id: normalizedAppEventOutbox.id })
    .from(normalizedAppEventOutbox)
    .where(and(
      isNull(normalizedAppEventOutbox.processedAt),
      isNull(normalizedAppEventOutbox.failedAt),
      or(
        isNull(normalizedAppEventOutbox.claimedAt),
        lt(normalizedAppEventOutbox.claimedAt, claimedBefore),
      ),
    ))
    .orderBy(asc(normalizedAppEventOutbox.createdAt))
    .limit(limit)
    .for('update', { skipLocked: true });
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > MAX_RECORDED_ERROR_LENGTH
    ? `${message.slice(0, MAX_RECORDED_ERROR_LENGTH)}…`
    : message;
}

async function finishEvent(
  db: Database,
  rowId: string,
  ownerId: string,
  reminder: { noteId: string; reminderAt: Date } | null,
): Promise<boolean> {
  return db.transaction(async (transaction) => {
    const acknowledged = await transaction
      .update(normalizedAppEventOutbox)
      .set({ processedAt: new Date(), lastError: null })
      .where(and(
        eq(normalizedAppEventOutbox.id, rowId),
        eq(normalizedAppEventOutbox.claimedBy, ownerId),
        isNull(normalizedAppEventOutbox.processedAt),
      ))
      .returning({ id: normalizedAppEventOutbox.id });
    if (acknowledged.length !== 1) return false;
    if (reminder) {
      await transaction
        .update(notes)
        .set({ reminderSentAt: new Date() })
        .where(and(
          eq(notes.id, reminder.noteId),
          eq(notes.reminderAt, reminder.reminderAt),
          isNotNull(notes.reminderQueuedAt),
          isNull(notes.reminderSentAt),
        ));
    }
    return true;
  });
}

export async function runNotedEventOutboxBatch(
  options: NotedEventOutboxBatchOptions,
): Promise<NotedEventOutboxBatchResult> {
  const db = getDb();
  const claimed = await db
    .update(normalizedAppEventOutbox)
    .set({
      claimedAt: new Date(),
      claimedBy: options.ownerId,
      attempts: sql`${normalizedAppEventOutbox.attempts} + 1`,
    })
    .where(inArray(
      normalizedAppEventOutbox.id,
      claimableEvents(
        db,
        new Date(Date.now() - (options.leaseMs ?? NOTED_EVENT_OUTBOX_LEASE_MS)),
        options.batchSize ?? positiveInteger('NOTED_EVENT_OUTBOX_BATCH_SIZE', DEFAULT_BATCH_SIZE),
      ),
    ))
    .returning({
      id: normalizedAppEventOutbox.id,
      eventId: normalizedAppEventOutbox.eventId,
      event: normalizedAppEventOutbox.event,
      attempts: normalizedAppEventOutbox.attempts,
    });

  const result: NotedEventOutboxBatchResult = {
    claimed: claimed.length,
    processed: 0,
    failed: 0,
    deadLettered: 0,
  };

  for (const row of claimed) {
    if (row.attempts > NOTED_EVENT_OUTBOX_MAX_ATTEMPTS) {
      await db.update(normalizedAppEventOutbox).set({
        failedAt: new Date(),
        lastError: sql`coalesce(${normalizedAppEventOutbox.lastError}, 'Attempt limit reached')`,
      }).where(and(
        eq(normalizedAppEventOutbox.id, row.id),
        eq(normalizedAppEventOutbox.claimedBy, options.ownerId),
        isNull(normalizedAppEventOutbox.processedAt),
      ));
      result.deadLettered += 1;
      continue;
    }

    let parsed: NormalizedAppEvent;
    try {
      parsed = normalizedAppEventSchema.parse(row.event);
      const acknowledged = await processClaimedNotedEvent(parsed, {
        loadReminder: (event) => activeReminder(db, event),
        deliver: options.deliver ?? deliverNotedEvent,
        notifyReminder: options.notifyReminder ?? deliverReminderNotification,
        acknowledge: (reminder) => finishEvent(db, row.id, options.ownerId, reminder),
      });
      if (acknowledged) result.processed += 1;
    } catch (error) {
      const deadLetter = row.attempts >= NOTED_EVENT_OUTBOX_MAX_ATTEMPTS;
      await db.update(normalizedAppEventOutbox).set({
        lastError: describeError(error),
        ...(deadLetter ? { failedAt: new Date() } : {}),
      }).where(and(
        eq(normalizedAppEventOutbox.id, row.id),
        eq(normalizedAppEventOutbox.claimedBy, options.ownerId),
        isNull(normalizedAppEventOutbox.processedAt),
      ));
      result.failed += 1;
      if (deadLetter) result.deadLettered += 1;
      log.notes.warn(
        { eventId: row.eventId, attempts: row.attempts, deadLetter, err: error },
        'Normalized Noted event delivery failed',
      );
      continue;
    }

  }
  return result;
}

const WORKER_OWNER_ID = `${hostname()}:${process.pid}:${randomBytes(4).toString('hex')}`;
let timer: ReturnType<typeof setInterval> | null = null;
let tickInFlight = false;

async function tick(): Promise<void> {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    await runNotedEventOutboxBatch({ ownerId: WORKER_OWNER_ID });
  } catch (error) {
    log.notes.error({ err: error }, 'Normalized Noted event outbox batch failed');
  } finally {
    tickInFlight = false;
  }
}

export function startNotedEventOutboxWorker(): boolean {
  if (!enabled('NOTED_EVENT_OUTBOX_WORKER_ENABLED')) {
    log.notes.info('Normalized event outbox worker disabled; events remain durable');
    return false;
  }
  if (!oxyServiceClient()) {
    log.notes.error('Normalized event outbox worker requires Oxy application credentials');
    return false;
  }
  if (timer) return true;
  const intervalMs = Math.max(
    positiveInteger('NOTED_EVENT_OUTBOX_POLL_INTERVAL_MS', DEFAULT_POLL_INTERVAL_MS),
    100,
  );
  timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  void tick();
  log.notes.info({ ownerId: WORKER_OWNER_ID, intervalMs }, 'Normalized event outbox worker started');
  return true;
}

export function stopNotedEventOutboxWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  log.notes.info({ ownerId: WORKER_OWNER_ID }, 'Normalized event outbox worker stopped');
}
