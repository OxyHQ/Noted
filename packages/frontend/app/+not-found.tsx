import { Stack, useRouter } from 'expo-router';
import { View } from 'react-native';
import Head from 'expo-router/head';
import { EmptyState } from '@/components/empty-state';
import { useTranslation } from '@/hooks/useTranslation';

export default function NotFoundScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  return <>
    <Head><title>404 | Noted</title><meta name="robots" content="noindex, nofollow" /></Head>
    <Stack.Screen options={{ title: t('emptyStates.notFoundTitle') }} />
    <View className="flex-1 justify-center bg-background">
      <EmptyState sticker="notFound" title={t('emptyStates.notFoundTitle')}
        subtitle={t('emptyStates.notFoundSubtitle')}
        action={{ label: t('emptyStates.backToNotes'), onPress: () => router.replace('/') }} />
    </View>
  </>;
}
