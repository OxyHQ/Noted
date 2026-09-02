import { createHash } from 'node:crypto';
import { normalizedAppEventSchema, type NormalizedAppEvent } from '@oxyhq/contracts';

import { log } from '../lib/logger.js';
import { oxyServiceClient } from './oxy-service-client.js';

const ALIA_API_URL = (process.env.ALIA_API_URL ?? 'https://api.alia.onl').replace(/\/$/, '');
function eventId(parts: readonly string[]): string {
  return `noted:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`;
}

async function publish(event: NormalizedAppEvent): Promise<void> {
  const client = oxyServiceClient();
  if (!client) {
    log.notes.warn({ eventId: event.eventId }, 'Noted event credentials are not configured');
    return;
  }
  try {
    const token = await client.getServiceToken();
    const response = await fetch(`${ALIA_API_URL}/webhooks/oxy`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(normalizedAppEventSchema.parse(event)),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Alia rejected Noted event (${response.status})`);
    }
  } catch (error) {
    log.notes.warn({ err: error, eventId: event.eventId }, 'Noted event publish failed');
  }
}

export async function publishNoteChangedEvent(input: {
  accountId: string;
  noteId: string;
  change: 'created' | 'updated' | 'archived' | 'trashed' | 'restored';
  idempotencyKey: string;
  occurredAt: string;
}): Promise<void> {
  await publish({
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

export async function publishReminderDueEvent(input: {
  accountId: string;
  noteId: string;
  reminderAt: Date;
}): Promise<void> {
  const reminderAt = input.reminderAt.toISOString();
  await publish({
    eventId: eventId([input.accountId, input.noteId, 'reminder_due', reminderAt]),
    appId: 'noted',
    accountId: input.accountId,
    resource: {
      appId: 'noted',
      effectiveAccountId: input.accountId,
      resourceType: 'note',
      resourceId: input.noteId,
    },
    type: 'reminder_due',
    occurredAt: new Date().toISOString(),
    data: { noteId: input.noteId, reminderAt },
  });
}
