import { describe, expect, it, mock } from 'bun:test';

import type { NoteRow } from '../../db/schema/notes.js';
import {
  processClaimedNotedEvent,
  type ClaimedNotedEventDependencies,
} from '../../lib/normalized-event-outbox.js';
import { buildNoteChangedEvent, buildReminderEvent } from '../noted.events.js';

const reminderAt = new Date('2026-09-04T09:00:00.000Z');

function reminderEvent() {
  return buildReminderEvent({ accountId: 'account-1', noteId: 'note-1', reminderAt });
}

function reminderNote(): NoteRow {
  return {
    id: 'note-1',
    oxyUserId: 'account-1',
    kind: 'note',
    title: 'Review plan',
    body: 'Check the rollout details.',
    checklist: [],
    color: 'default',
    labels: [],
    folderId: null,
    pinned: false,
    archived: false,
    trashed: false,
    attachments: [],
    reminderAt,
    reminderQueuedAt: new Date('2026-09-04T09:00:01.000Z'),
    reminderSentAt: null,
    sortOrder: 0,
    deletedAt: null,
    createdAt: new Date('2026-09-03T08:00:00.000Z'),
    updatedAt: new Date('2026-09-03T08:00:00.000Z'),
    searchVector: '',
  };
}

function dependencies(overrides: Partial<ClaimedNotedEventDependencies> = {}) {
  const defaults: ClaimedNotedEventDependencies = {
    loadReminder: mock().mockResolvedValue(reminderNote()),
    deliver: mock().mockResolvedValue(undefined),
    notifyReminder: mock().mockResolvedValue(undefined),
    acknowledge: mock().mockResolvedValue(true),
  };
  return { ...defaults, ...overrides };
}

describe('Noted normalized events', () => {
  it('binds each event to the exact account and note with a stable eventId', () => {
    const input = {
      accountId: 'account-1',
      noteId: 'note-1',
      change: 'updated' as const,
      idempotencyKey: 'request-1',
      occurredAt: '2026-09-03T08:00:00.000Z',
    };
    const first = buildNoteChangedEvent(input);
    expect(buildNoteChangedEvent(input).eventId).toBe(first.eventId);
    expect(first).toMatchObject({
      appId: 'noted',
      accountId: 'account-1',
      type: 'note_changed',
      resource: {
        appId: 'noted',
        effectiveAccountId: 'account-1',
        resourceType: 'note',
        resourceId: 'note-1',
      },
    });
    expect(reminderEvent()).toMatchObject({
      type: 'reminder',
      occurredAt: reminderAt.toISOString(),
      data: { noteId: 'note-1', reminderAt: reminderAt.toISOString() },
    });
  });

  it('does not acknowledge or notify when normalized delivery fails', async () => {
    const deps = dependencies({ deliver: mock().mockRejectedValue(new Error('offline')) });
    await expect(processClaimedNotedEvent(reminderEvent(), deps)).rejects.toThrow('offline');
    expect(deps.notifyReminder).not.toHaveBeenCalled();
    expect(deps.acknowledge).not.toHaveBeenCalled();
  });

  it('does not acknowledge when reminder notification delivery fails', async () => {
    const deps = dependencies({
      notifyReminder: mock().mockRejectedValue(new Error('notification unavailable')),
    });
    await expect(processClaimedNotedEvent(reminderEvent(), deps)).rejects.toThrow(
      'notification unavailable',
    );
    expect(deps.deliver).toHaveBeenCalledTimes(1);
    expect(deps.acknowledge).not.toHaveBeenCalled();
  });

  it('acknowledges only after both reminder deliveries succeed', async () => {
    const order: string[] = [];
    const deps = dependencies({
      deliver: mock(async () => {
        order.push('event');
      }),
      notifyReminder: mock(async () => {
        order.push('notification');
      }),
      acknowledge: mock(async () => {
        order.push('acknowledge');
        return true;
      }),
    });
    await expect(processClaimedNotedEvent(reminderEvent(), deps)).resolves.toBe(true);
    expect(order).toEqual(['event', 'notification', 'acknowledge']);
    expect(deps.acknowledge).toHaveBeenCalledWith({ noteId: 'note-1', reminderAt });
  });

  it('acknowledges a stale reminder without delivering it', async () => {
    const deps = dependencies({ loadReminder: mock().mockResolvedValue(null) });
    await expect(processClaimedNotedEvent(reminderEvent(), deps)).resolves.toBe(true);
    expect(deps.deliver).not.toHaveBeenCalled();
    expect(deps.notifyReminder).not.toHaveBeenCalled();
    expect(deps.acknowledge).toHaveBeenCalledTimes(1);
    expect(deps.acknowledge).toHaveBeenCalledWith(null);
  });
});
