/**
 * Which reminders to schedule on THIS device.
 *
 * The server sends reminders as pushes, which needs a connection and a running
 * scheduler. This lets the device remind the person itself, so a reminder set on
 * a plane still fires. Pure: given the notes with a reminder and what is already
 * scheduled, it says what to schedule and what to cancel, so the reconciling is
 * tested without the notification module.
 */

/** iOS keeps at most 64 pending local notifications; stay under it. */
export const MAX_LOCAL_REMINDERS = 60;

const PREFIX = 'noted-reminder:';

export function reminderIdentifier(noteId: string): string {
  return `${PREFIX}${noteId}`;
}

export interface ReminderNote {
  id: string;
  title: string;
  /** ISO instant. */
  reminderAt: string;
}

export interface ScheduledReminder {
  identifier: string;
  /** When it will fire, in ms since the epoch; null if the trigger is not a date. */
  fireAt: number | null;
  title: string;
}

export interface PlannedReminder {
  identifier: string;
  noteId: string;
  fireAt: Date;
  title: string;
}

export interface ReminderPlan {
  schedule: PlannedReminder[];
  cancel: string[];
}

/** A one-second wobble in how the OS reports a trigger is not a change. */
const SAME_INSTANT_MS = 1_000;

export function planLocalReminders(input: {
  notes: readonly ReminderNote[];
  scheduled: readonly ScheduledReminder[];
  now: number;
  /** What to call a note with no title. */
  untitled: string;
}): ReminderPlan {
  const wanted = input.notes
    .map((note) => ({ note, at: new Date(note.reminderAt).getTime() }))
    // Past reminders are the server's and the list's business; a notification for
    // a moment that already happened would fire immediately and look like a bug.
    .filter(({ at }) => Number.isFinite(at) && at > input.now)
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_LOCAL_REMINDERS);

  const ours = new Map(
    input.scheduled
      .filter((item) => item.identifier.startsWith(PREFIX))
      .map((item) => [item.identifier, item] as const),
  );

  const schedule: PlannedReminder[] = [];
  const keep = new Set<string>();
  for (const { note, at } of wanted) {
    const identifier = reminderIdentifier(note.id);
    keep.add(identifier);
    const title = note.title.trim() || input.untitled;
    const existing = ours.get(identifier);
    const unchanged =
      existing !== undefined &&
      existing.fireAt !== null &&
      Math.abs(existing.fireAt - at) < SAME_INSTANT_MS &&
      existing.title === title;
    if (!unchanged) schedule.push({ identifier, noteId: note.id, fireAt: new Date(at), title });
  }

  const cancel = [...ours.keys()].filter((identifier) => !keep.has(identifier));
  return { schedule, cancel };
}
