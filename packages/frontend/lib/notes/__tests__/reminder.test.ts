import { describe, expect, it } from 'vitest';
import { combineDateAndTime, isUpcoming, splitReminder } from '@/lib/notes/reminder';

describe('combineDateAndTime', () => {
  it('puts the time on the local day, ignoring the time the day carried', () => {
    const when = combineDateAndTime(new Date(2026, 9, 16, 23, 59), '09:30');
    expect(when?.getFullYear()).toBe(2026);
    expect(when?.getMonth()).toBe(9);
    expect(when?.getDate()).toBe(16);
    expect(when?.getHours()).toBe(9);
    expect(when?.getMinutes()).toBe(30);
    expect(when?.getSeconds()).toBe(0);
  });

  it('rejects anything that is not HH:mm on a 24h clock', () => {
    for (const bad of ['', '9:30', '24:00', '12:60', 'ab:cd', '09:30 PM']) {
      expect(combineDateAndTime(new Date(), bad), bad).toBeNull();
    }
    expect(combineDateAndTime(new Date(), '00:00')).not.toBeNull();
    expect(combineDateAndTime(new Date(), '23:59')).not.toBeNull();
  });
});

describe('splitReminder', () => {
  it('round-trips with combineDateAndTime', () => {
    const original = new Date(2026, 11, 31, 18, 5);
    const parts = splitReminder(original.toISOString());
    expect(parts?.time).toBe('18:05');
    expect(parts && combineDateAndTime(parts.day, parts.time)?.getTime()).toBe(original.getTime());
  });

  it('returns null for text that is not a date', () => {
    expect(splitReminder('not a date')).toBeNull();
  });
});

describe('isUpcoming', () => {
  it('is strictly after now', () => {
    const now = new Date('2026-10-13T10:00:00Z');
    expect(isUpcoming(new Date('2026-10-13T10:00:01Z'), now)).toBe(true);
    expect(isUpcoming(new Date('2026-10-13T10:00:00Z'), now)).toBe(false);
    expect(isUpcoming(new Date('2026-10-13T09:59:59Z'), now)).toBe(false);
  });
});
