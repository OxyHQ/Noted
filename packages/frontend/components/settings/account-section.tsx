import { View } from 'react-native';
import { Text } from '@oxy.so/bloom/typography';
import { Button } from '@oxy.so/bloom/button';
import { alert } from '@oxy.so/bloom/surfaces';
import { SettingsCard, SettingsRow } from '@oxy.so/bloom/settings-modal';
import { useOxy } from '@oxy.so/services/ui/client';
import { useTranslation } from '@/hooks/useTranslation';
import { useEraseAccountData } from '@/lib/hooks/use-erase-account-data';
import { useNotedSettings } from './settings-provider';
import { EmptyState } from '@/components/empty-state';

export function AccountSection() {
  const { user, isAuthenticated, showBottomSheet, openAccountDialog } = useOxy();
  const { t } = useTranslation();
  const { afterClose } = useNotedSettings();
  const erase = useEraseAccountData();
  if (!isAuthenticated || !user)
    return (
      <EmptyState
        sticker="welcome"
        title={t('notes.signInTitle')}
        subtitle={t('notes.signInSubtitle')}
        action={{
          label: t('emptyStates.signIn'),
          onPress: () => afterClose(() => openAccountDialog()),
        }}
      />
    );
  const displayName = user.name?.displayName?.trim() || user.username || t('common.user');
  return (
    <View className="gap-6">
      <SettingsCard>
        <SettingsRow label={displayName} description={user.email}>
          <Text variant="body-regular">@{user.username}</Text>
        </SettingsRow>
      </SettingsCard>
      <Button
        appearance="outline"
        onPress={() => afterClose(() => showBottomSheet?.('ManageAccount'))}
      >
        {t('settings.account.title')}
      </Button>
      <SettingsCard>
        <SettingsRow
          label={t('settings.eraseData.title')}
          description={t('settings.eraseData.description')}
        >
          <Button
            appearance="outline"
            tone="danger"
            size="sm"
            disabled={erase.isPending}
            loading={erase.isPending}
            onPress={() =>
              alert(t('settings.eraseData.confirmTitle'), t('settings.eraseData.confirmBody'), [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('settings.eraseData.confirm'),
                  style: 'destructive',
                  onPress: () => erase.mutate(),
                },
              ])
            }
          >
            {t('settings.eraseData.button')}
          </Button>
        </SettingsRow>
      </SettingsCard>
    </View>
  );
}
