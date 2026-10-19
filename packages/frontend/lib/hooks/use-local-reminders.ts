import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useOxy } from '@oxy.so/services/ui/client';
import { useTranslation } from '@/hooks/useTranslation';
import type { Row } from '@/lib/db/client';
import { useLiveQuery } from '@/lib/db/live-query';
import { SETTING_KEYS, readSetting, useSettings } from '@/lib/db/settings-repo';
import {
  MAX_LOCAL_REMINDERS,
  planLocalReminders,
  reminderIdentifier,
  type ReminderNote,
  type ScheduledReminder,
} from '@/lib/local-reminders';

interface ReminderRow extends Row {
  id: string;
  title: string;
  reminder_at: string;
}

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/** Notes with a reminder still to come, soonest first — more than the device can hold is pointless. */
const UPCOMING_SQL = `
SELECT id, title, reminder_at FROM notes
WHERE reminder_at IS NOT NULL AND reminder_at > ? AND trashed = 0 AND deleted_at IS NULL
ORDER BY reminder_at ASC LIMIT ${MAX_LOCAL_REMINDERS}
`;

/**
 * Keep this device's scheduled reminders in step with the notes, when the person
 * asked for that. Call once in the authenticated layout.
 *
 * Off by default, because the server also sends reminders: with both on, a
 * reminder can arrive twice. The Settings row says so. Turning it off cancels
 * everything this scheduled.
 */
export function useLocalReminders() {
  const { t } = useTranslation();
  const { isAuthenticated } = useOxy();
  const { settings } = useSettings();
  const enabled = readSetting(settings, SETTING_KEYS.localReminders, isBoolean, false);
  const active = Platform.OS !== 'web' && isAuthenticated;

  // Fixed when the hook mounts. A parameter that changed every render would be a
  // new query every render, and the live query would resubscribe forever. Nothing
  // is lost: the live query re-runs whenever a note changes (which is when a
  // reminder is set, moved or cleared), and the planner drops anything already
  // past using the real current time.
  const [since] = useState(() => new Date().toISOString());
  const { data: rows } = useLiveQuery<ReminderRow, ReminderNote[]>({
    sql: UPCOMING_SQL,
    params: [since],
    mapRows: (found) =>
      found.map((row) => ({ id: row.id, title: row.title, reminderAt: row.reminder_at })),
  });

  const untitled = t('notes.reminder');
  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    void (async () => {
      try {
        const existing = await Notifications.getAllScheduledNotificationsAsync();
        const scheduled: ScheduledReminder[] = existing.map((item) => ({
          identifier: item.identifier,
          fireAt:
            item.trigger && 'value' in item.trigger && typeof item.trigger.value === 'number'
              ? item.trigger.value
              : null,
          title: item.content.title ?? '',
        }));

        const plan = enabled
          ? planLocalReminders({ notes: rows ?? [], scheduled, now: Date.now(), untitled })
          : // Off: take down every one of ours and schedule nothing.
            planLocalReminders({ notes: [], scheduled, now: Date.now(), untitled });
        if (cancelled) return;

        for (const identifier of plan.cancel) {
          await Notifications.cancelScheduledNotificationAsync(identifier);
        }
        if (!enabled) return;

        const { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') return;
        for (const item of plan.schedule) {
          if (cancelled) return;
          await Notifications.scheduleNotificationAsync({
            identifier: item.identifier,
            content: { title: item.title, data: { noteId: item.noteId, local: true } },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: item.fireAt,
              channelId: 'default',
            },
          });
        }
      } catch {
        // Scheduling is best-effort: the server's push still covers the reminder.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, enabled, rows, untitled]);
}

export { reminderIdentifier };
