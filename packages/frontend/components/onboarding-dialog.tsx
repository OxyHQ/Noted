import React from 'react';
import { View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import type { Row } from '@/lib/db/client';
import { useLiveQuery } from '@/lib/db/live-query';
import { SETTING_KEYS, readSetting, useSettings, writeSetting } from '@/lib/db/settings-repo';
import { shouldShowOnboarding } from '@/lib/onboarding';

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

interface CountRow extends Row {
  n: number;
}

/**
 * Every note the account has, in any view. Not the visible list: that one is
 * filtered by label and search, and an empty filter is not an empty account.
 */
function useNoteCount() {
  const { data, isLoading } = useLiveQuery<CountRow, number>({
    sql: 'SELECT COUNT(*) AS n FROM notes WHERE deleted_at IS NULL',
    mapRows: (rows) => rows[0]?.n ?? 0,
  });
  return { noteCount: data ?? 0, isLoading };
}

const POINTS = ['local', 'private', 'import'] as const;

/** A first-run welcome: where notes live, what stays on the device, how to bring notes in. */
export function OnboardingDialog() {
  const { t } = useTranslation();
  const { noteCount, isLoading: notesLoading } = useNoteCount();
  const { settings, isLoading } = useSettings();
  const [dismissed, setDismissed] = React.useState(false);
  const seen = readSetting(settings, SETTING_KEYS.onboardingSeen, isBoolean, false);

  const open =
    !dismissed &&
    shouldShowOnboarding({ settingsLoading: isLoading, notesLoading, seen, noteCount });

  const close = () => {
    setDismissed(true);
    // Remembered per device. A failed write only means it shows once more.
    void writeSetting(SETTING_KEYS.onboardingSeen, true).catch(() => {});
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('onboarding.title')}</DialogTitle>
        </DialogHeader>
        <View className="gap-4">
          {POINTS.map((point) => (
            <View key={point} className="gap-1">
              <Text className="text-base font-medium text-foreground">
                {t(`onboarding.${point}.title`)}
              </Text>
              <Text className="text-sm text-muted-foreground">{t(`onboarding.${point}.body`)}</Text>
            </View>
          ))}
        </View>
        <View className="flex-row justify-end">
          <Button onPress={close}>{t('onboarding.start')}</Button>
        </View>
      </DialogContent>
    </Dialog>
  );
}
