import { describe, expect, it } from 'vitest';
import { MAX_LOCAL_REMINDERS, planLocalReminders, reminderIdentifier } from '@/lib/local-reminders';

const now = Date.parse('2026-10-13T10:00:00Z');
const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
const plan = (
  notes: { id: string; title: string; reminderAt: string }[],
  scheduled: { identifier: string; fireAt: number | null; title: string }[] = [],
) => planLocalReminders({ notes, scheduled, now, untitled: 'Reminder' });

describe('planLocalReminders', () => {
  it('schedules a future reminder with the note title', () => {
    const result = plan([{ id: 'a', title: 'Call the bank', reminderAt: at(30) }]);
    expect(result.cancel).toEqual([]);
    expect(result.schedule).toEqual([
      {
        identifier: reminderIdentifier('a'),
        noteId: 'a',
        fireAt: new Date(now + 30 * 60_000),
        title: 'Call the bank',
      },
    ]);
  });

  it('names an untitled note rather than showing a blank notification', () => {
    expect(plan([{ id: 'a', title: '   ', reminderAt: at(5) }]).schedule[0].title).toBe('Reminder');
  });

  it('ignores reminders in the past and unreadable dates', () => {
    const result = plan([
      { id: 'old', title: 'x', reminderAt: at(-5) },
      { id: 'now', title: 'x', reminderAt: at(0) },
      { id: 'bad', title: 'x', reminderAt: 'not a date' },
    ]);
    expect(result.schedule).toEqual([]);
  });

  it('leaves alone what is already scheduled correctly', () => {
    const result = plan(
      [{ id: 'a', title: 'T', reminderAt: at(30) }],
      [{ identifier: reminderIdentifier('a'), fireAt: now + 30 * 60_000 + 400, title: 'T' }],
    );
    expect(result).toEqual({ schedule: [], cancel: [] });
  });

  it('reschedules when the time or the title changed', () => {
    const moved = plan(
      [{ id: 'a', title: 'T', reminderAt: at(60) }],
      [{ identifier: reminderIdentifier('a'), fireAt: now + 30 * 60_000, title: 'T' }],
    );
    expect(moved.schedule).toHaveLength(1);
    const renamed = plan(
      [{ id: 'a', title: 'New', reminderAt: at(30) }],
      [{ identifier: reminderIdentifier('a'), fireAt: now + 30 * 60_000, title: 'T' }],
    );
    expect(renamed.schedule).toHaveLength(1);
  });

  it("cancels ours that no longer have a reminder, and never touches anyone else's", () => {
    const result = plan(
      [],
      [
        { identifier: reminderIdentifier('gone'), fireAt: now + 60_000, title: 'x' },
        { identifier: 'something-else', fireAt: now + 60_000, title: 'x' },
      ],
    );
    expect(result.cancel).toEqual([reminderIdentifier('gone')]);
  });

  it('keeps the soonest ones when there are more than the OS allows', () => {
    const notes = Array.from({ length: MAX_LOCAL_REMINDERS + 5 }, (_, i) => ({
      id: `n${i}`,
      title: 'x',
      reminderAt: at(i + 1),
    }));
    const result = plan(notes.reverse());
    expect(result.schedule).toHaveLength(MAX_LOCAL_REMINDERS);
    expect(result.schedule[0].noteId).toBe('n0');
    expect(result.schedule.at(-1)?.noteId).toBe(`n${MAX_LOCAL_REMINDERS - 1}`);
  });

  it('cancels a scheduled one that fell off the end of the list', () => {
    const notes = Array.from({ length: MAX_LOCAL_REMINDERS + 1 }, (_, i) => ({
      id: `n${i}`,
      title: 'x',
      reminderAt: at(i + 1),
    }));
    const last = `n${MAX_LOCAL_REMINDERS}`;
    const result = plan(notes, [
      {
        identifier: reminderIdentifier(last),
        fireAt: now + (MAX_LOCAL_REMINDERS + 1) * 60_000,
        title: 'x',
      },
    ]);
    expect(result.cancel).toEqual([reminderIdentifier(last)]);
  });
});
