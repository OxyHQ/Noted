import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { SettingsCard, SettingsRow } from '@oxy.so/bloom/settings-modal';
import { Switch } from '@oxy.so/bloom/switch';
import { toast } from '@oxy.so/bloom/toast';
import { useTranslation } from '@/hooks/useTranslation';
import { SETTING_KEYS, readSetting, useSettings, writeSetting } from '@/lib/db/settings-repo';

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/** Remind me on this device too (native only). */
export function LocalRemindersRow() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const enabled = readSetting(settings, SETTING_KEYS.localReminders, isBoolean, false);

  if (Platform.OS === 'web') return null;

  const change = async (next: boolean) => {
    if (next) {
      // Without permission the switch would claim a protection it does not give.
      const { status } = await Notifications.getPermissionsAsync();
      const granted =
        status === 'granted' ||
        (await Notifications.requestPermissionsAsync()).status === 'granted';
      if (!granted) {
        toast.error(t('settings.localReminders.denied'));
        return;
      }
    }
    await writeSetting(SETTING_KEYS.localReminders, next);
  };

  return (
    <SettingsCard>
      <SettingsRow
        label={t('settings.localReminders.title')}
        description={t('settings.localReminders.description')}
      >
        <Switch
          checked={enabled}
          accessibilityLabel={t('settings.localReminders.title')}
          onCheckedChange={(value) => void change(value)}
        />
      </SettingsRow>
    </SettingsCard>
  );
}
