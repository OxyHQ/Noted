import React from 'react';
import { View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { Calendar, TimeField } from '@oxy.so/bloom/date-picker';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import { combineDateAndTime, isUpcoming, splitReminder } from '@/lib/notes/reminder';

interface ReminderPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The reminder the note has now, to start from. */
  current: string | null;
  onPick: (when: Date) => void;
}

const DEFAULT_TIME = '09:00';

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Choose any date and time for a reminder. */
export function ReminderPickerDialog({
  open,
  onOpenChange,
  current,
  onPick,
}: ReminderPickerDialogProps) {
  const { t } = useTranslation();
  const [day, setDay] = React.useState<Date | null>(null);
  const [time, setTime] = React.useState<string | null>(DEFAULT_TIME);

  // Every opening starts from the reminder the note has, or from nothing.
  React.useEffect(() => {
    if (!open) return;
    const existing = current ? splitReminder(current) : null;
    setDay(existing?.day ?? null);
    setTime(existing?.time ?? DEFAULT_TIME);
  }, [open, current]);

  const existing = current ? splitReminder(current) : null;
  const unchanged =
    day !== null &&
    time !== null &&
    existing !== null &&
    day.getFullYear() === existing.day.getFullYear() &&
    day.getMonth() === existing.day.getMonth() &&
    day.getDate() === existing.day.getDate() &&
    time === existing.time;
  // A repeated local hour can refer to two instants. Retain the stored one
  // when the visible selection has not changed.
  const when =
    unchanged && current ? new Date(current) : day && time ? combineDateAndTime(day, time) : null;
  const upcoming = when !== null && isUpcoming(when);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('notes.pickDateTime')}</DialogTitle>
        </DialogHeader>
        <View className="items-center gap-3">
          <Calendar value={day} onChange={setDay} minDate={startOfToday()} />
          <TimeField
            value={time}
            onChange={setTime}
            step={5}
            accessibilityLabel={t('notes.reminderTime')}
          />
          {when && !upcoming ? (
            <Text accessibilityRole="alert" className="text-sm text-destructive">
              {t('notes.reminderInPast')}
            </Text>
          ) : null}
          {day && time && !when ? (
            <Text accessibilityRole="alert" className="text-sm text-destructive">
              {t('notes.reminderInvalidTime')}
            </Text>
          ) : null}
        </View>
        <View className="flex-row justify-end gap-4">
          <Button appearance="plain" tone="neutral" onPress={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!upcoming}
            onPress={() => {
              if (when && upcoming) {
                if (!unchanged) onPick(when);
                onOpenChange(false);
              }
            }}
          >
            {t('notes.setReminder')}
          </Button>
        </View>
      </DialogContent>
    </Dialog>
  );
}
