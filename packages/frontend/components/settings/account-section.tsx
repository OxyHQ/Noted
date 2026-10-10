import { View } from 'react-native';
import { Text } from '@oxy.so/bloom/typography';
import { Button } from '@oxy.so/bloom/button';
import { SettingsCard, SettingsRow } from '@oxy.so/bloom/settings-modal';
import { openAccountDialog, useOxy } from '@oxy.so/services';
import { useTranslation } from '@/hooks/useTranslation';
import { useNotedSettings } from './settings-provider';
import { EmptyState } from '@/components/empty-state';

export function AccountSection() {
  const { user, isAuthenticated, showBottomSheet } = useOxy();
  const { t } = useTranslation();
  const { afterClose } = useNotedSettings();
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
    </View>
  );
}
