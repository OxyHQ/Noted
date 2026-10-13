import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';
import { SettingsCard, SettingsRow, SettingsSection } from '@oxy.so/bloom/settings-modal';
import { Switch } from '@oxy.so/bloom/switch';
import { useTranslation } from '@/hooks/useTranslation';
import { SETTING_KEYS, readSetting, useSettings, writeSetting } from '@/lib/db/settings-repo';
import { useCanAuthenticate } from '@/lib/hooks/use-app-lock-support';

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/**
 * The switch for the app lock. Nothing on the web, which has no such prompt.
 *
 * Turning it ON asks the person to authenticate first: a lock enabled on a
 * device whose biometrics do not actually work would lock them out of their own
 * notes. Turning it off needs nothing, because the screen is already unlocked.
 */
export function AppLockSection() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const canAuthenticate = useCanAuthenticate();
  const enabled = readSetting(settings, SETTING_KEYS.appLock, isBoolean, false);

  if (Platform.OS === 'web') return null;

  const change = async (next: boolean) => {
    if (next) {
      try {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: t('lock.enablePrompt'),
          cancelLabel: t('common.cancel'),
        });
        if (!result.success) return;
      } catch {
        return;
      }
    }
    await writeSetting(SETTING_KEYS.appLock, next);
  };

  return (
    <SettingsSection label={t('lock.section')}>
      <SettingsCard>
        <SettingsRow
          label={t('lock.settingTitle')}
          description={
            canAuthenticate === false && !enabled
              ? t('lock.settingUnavailable')
              : t('lock.settingDescription')
          }
        >
          <Switch
            checked={enabled}
            disabled={canAuthenticate !== true && !enabled}
            accessibilityLabel={t('lock.settingTitle')}
            onCheckedChange={(value) => void change(value)}
          />
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
