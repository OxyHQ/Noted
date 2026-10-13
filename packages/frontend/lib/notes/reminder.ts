/**
 * Picking a reminder time by hand.
 *
 * Local time throughout: the person picks "9:00 on Friday" on their own clock,
 * and the stored value is the ISO instant that moment is. The reminder is sent
 * by the server from that instant, so no timezone is stored beside it.
 */

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A local `Date` at `time` ("HH:mm", 24h) on the calendar day of `day`; null if `time` is malformed. */
export function combineDateAndTime(day: Date, time: string): Date | null {
  const match = TIME.exec(time);
  if (!match) return null;
  const combined = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    Number(match[1]),
    Number(match[2]),
    0,
    0,
  );
  return Number.isNaN(combined.getTime()) ? null : combined;
}

/** The day and "HH:mm" of a stored reminder, in local time. */
export function splitReminder(iso: string): { day: Date; time: string } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    day: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

/** Whether a reminder at `when` could still fire (strictly after `now`). */
export function isUpcoming(when: Date, now = new Date()): boolean {
  return when.getTime() > now.getTime();
}
