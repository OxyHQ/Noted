import type { ReactNode } from 'react';
import { View } from 'react-native';
import { openAccountDialog, useOxy } from '@oxy.so/services';
import { EmptyState } from '@/components/empty-state';
import { useLocalStoreState } from '@/lib/db/local-store-context';
import { storageErrorKind } from '@/lib/db/storage-error';
import { useTranslation } from '@/hooks/useTranslation';

export function LocalStoreError() {
  const { retry, error } = useLocalStoreState();
  const { t } = useTranslation();
  const kind = storageErrorKind(error);
  return <EmptyState sticker="loadError" title={t('emptyStates.storeErrorTitle')}
    subtitle={t(kind === 'locked' ? 'emptyStates.storeLockedSubtitle'
      : kind === 'reload' ? 'emptyStates.storeReloadSubtitle'
      : kind === 'paused' ? 'emptyStates.storePausedSubtitle' : 'emptyStates.storeErrorSubtitle')}
    action={{ label: t(kind === 'locked' || kind === 'reload' ? 'emptyStates.reload' : 'emptyStates.retry'), onPress: retry }} />;
}

/** Children must mount only after their account's SQLite file has opened. */
export function LocalStoreBoundary({ children, fallbackHeader }: { children: ReactNode; fallbackHeader?: ReactNode }) {
  const { isAuthenticated } = useOxy();
  const { isReady, error, viewerId } = useLocalStoreState();
  const { t } = useTranslation();
  if (isAuthenticated && isReady) return <View key={viewerId} style={{ flex: 1 }}>{children}</View>;
  return <View className="flex-1 bg-background">
    {fallbackHeader}
    <View className="flex-1 justify-center">
    {!isAuthenticated ? <EmptyState sticker="welcome"
      title={t('notes.signInTitle')} subtitle={t('notes.signInSubtitle')}
      action={{ label: t('emptyStates.signIn'), onPress: () => openAccountDialog() }} />
      : error ? <LocalStoreError />
      : <EmptyState sticker="notes" title={t('emptyStates.loadingTitle')}
        subtitle={t('emptyStates.loadingSubtitle')} />}
    </View>
  </View>;
}
