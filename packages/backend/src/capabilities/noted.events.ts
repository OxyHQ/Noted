import { createHash } from 'node:crypto';
import { normalizedAppEventSchema, type NormalizedAppEvent } from '@oxyhq/contracts';

import type { DatabaseOrTransaction } from '../db/postgres.js';
import { normalizedAppEventOutbox } from '../db/schema/normalized-app-event-outbox.js';

function eventId(parts: readonly string[]): string {
  return `noted:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`;
}

async function enqueue(db: DatabaseOrTransaction, event: NormalizedAppEvent): Promise<void> {
  const parsed = normalizedAppEventSchema.parse(event);
  await db
    .insert(normalizedAppEventOutbox)
    .values({ eventId: parsed.eventId, event: parsed })
    .onConflictDoNothing({ target: normalizedAppEventOutbox.eventId });
}

export type NoteChange =
  | 'created'
  | 'updated'
  | 'archived'
  | 'trashed'
  | 'restored'
  | 'deleted';

export function buildNoteChangedEvent(input: {
  accountId: string;
  noteId: string;
  change: NoteChange;
  idempotencyKey: string;
  occurredAt: string;
}): NormalizedAppEvent {
  return normalizedAppEventSchema.parse({
    eventId: eventId([input.accountId, input.noteId, input.change, input.idempotencyKey]),
    appId: 'noted',
    accountId: input.accountId,
    resource: {
      appId: 'noted',
      effectiveAccountId: input.accountId,
      resourceType: 'note',
      resourceId: input.noteId,
    },
    type: 'note_changed',
    occurredAt: input.occurredAt,
    data: { noteId: input.noteId, change: input.change },
  });
}

export async function enqueueNoteChangedEvent(
  db: DatabaseOrTransaction,
  input: Parameters<typeof buildNoteChangedEvent>[0],
): Promise<void> {
  await enqueue(db, buildNoteChangedEvent(input));
}

export function buildReminderEvent(input: {
  accountId: string;
  noteId: string;
  reminderAt: Date;
}): NormalizedAppEvent {
  const reminderAt = input.reminderAt.toISOString();
  return normalizedAppEventSchema.parse({
    eventId: eventId([input.accountId, input.noteId, 'reminder', reminderAt]),
    appId: 'noted',
    accountId: input.accountId,
    resource: {
      appId: 'noted',
      effectiveAccountId: input.accountId,
      resourceType: 'note',
      resourceId: input.noteId,
    },
    type: 'reminder',
    occurredAt: reminderAt,
    data: { noteId: input.noteId, reminderAt },
  });
}

export async function enqueueReminderEvent(
  db: DatabaseOrTransaction,
  input: Parameters<typeof buildReminderEvent>[0],
): Promise<void> {
  await enqueue(db, buildReminderEvent(input));
}
