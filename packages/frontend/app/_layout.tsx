import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFonts } from 'expo-font';
import { Navigator, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { Fragment, useCallback, useEffect, useMemo } from 'react';
import { OxyProvider, useOxy } from '@oxy.so/services';
import { BloomProvider } from '@oxy.so/bloom/provider';
import { expoRouterScrollAdapter } from '@oxy.so/bloom/scroll/expo-router';
import { OverlayInertBoundary } from '@oxy.so/bloom/overlay';
import { ImageResolverProvider } from '@oxy.so/bloom/image-resolver';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

import { createStickersClient } from '@oxy.so/stickers';
import { StickersProvider } from '@oxy.so/stickers/react';
import { NotedSettingsProvider } from '@/components/settings/settings-provider';
import { LocalStoreProvider } from '@/components/local-store-provider';
import { QueryProvider } from '@/lib/query-client';
import { configureLottieWeb } from '@/lib/lottieWeb';

import { AppErrorBoundary } from '@/components/error-boundary';
import { KeyboardProvider } from '@/lib/keyboard';
import { useColorScheme } from '@/lib/useColorScheme';
import { oxyServices } from '@/lib/oxy';
import { OXY_CLIENT_ID } from '@/lib/oxy-client-id';
import { BLOOM_THEME_PERSIST_KEY, BLOOM_THEME_STORAGE } from '@/lib/themePersistence';
import { SUPPORTED_LOCALES } from '@/lib/i18n';
import { useI18nStore } from '@/lib/stores/i18n-store';
import { handleLanguageError } from '@/lib/i18n/handleLanguageError';
import 'react-native-reanimated';
import '../global.css';
import '@/lib/i18n';

// Configure the bundled web renderer before any sticker mounts.
configureLottieWeb();

// The bare locale codes `OxyProvider` matches an account's language against —
// derived from the catalogue's entries rather than duplicated, so a locale
// added there is automatically one Oxy may resolve to here.
const SUPPORTED_LANGUAGE_CODES = SUPPORTED_LOCALES.map(({ code }) => code);

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(app)',
};

SplashScreen.preventAutoHideAsync();

const AUTH_REDIRECT_URI = Linking.createURL('/');

function AuthSetup({ children }: { children: React.ReactNode }) {
  const { oxyServices } = useOxy();

  const stickersClient = useMemo(() => createStickersClient(oxyServices), [oxyServices]);

  // Resolve Oxy file IDs to thumbnail download URLs for any Bloom component
  // that reads useImageResolver() (e.g. Avatar with a raw file id `source`).
  const resolveImageSource = useCallback(
    (fileId: string): string | undefined => {
      const url = oxyServices.assets.publicUrl(fileId, 'thumb');
      return url && url.startsWith('http') ? url : undefined;
    },
    [oxyServices],
  );

  return (
    <ImageResolverProvider value={resolveImageSource}>
      <StickersProvider client={stickersClient}>{children}</StickersProvider>
    </ImageResolverProvider>
  );
}

/** Expo's unstyled navigator preserves the notes route underneath Bloom's dialog
 * without imposing a viewport-sized native-stack scene on the web document. */
function WebRoutes() {
  const { state, descriptors, NavigationContent } = Navigator.useContext();
  const current = state.routes[state.index];
  const routes = state.routes.filter(
    (route) => route.key === current.key || (current.name === 'n/[id]' && route.name === '(app)'),
  );
  return (
    <NavigationContent>
      {routes.map((route) => (
        <Fragment key={route.key}>{descriptors[route.key].render()}</Fragment>
      ))}
    </NavigationContent>
  );
}

function AppContent() {
  const { colors } = useColorScheme();

  return (
    <AuthSetup>
      <QueryProvider>
        <LocalStoreProvider>
          <KeyboardProvider>
            <NotedSettingsProvider>
              {Platform.OS === 'web' ? (
                <OverlayInertBoundary>
                  <Navigator initialRouteName="(app)">
                    <WebRoutes />
                  </Navigator>
                </OverlayInertBoundary>
              ) : (
                <Stack
                  screenOptions={{
                    contentStyle: {
                      backgroundColor: colors.background,
                    },
                  }}
                >
                  <Stack.Screen name="(app)" options={{ headerShown: false }} />
                  {/* Editor presented as a transparent modal ABOVE the (app) shell so
              the masonry grid + sidebar stay mounted and visible behind it —
              Keep-style overlay, not a page change. */}
                  <Stack.Screen
                    name="n/[id]"
                    options={{
                      presentation: 'transparentModal',
                      animation: 'fade',
                      headerShown: false,
                      // Keep the native shell visible beneath the editor scene.
                      contentStyle: { backgroundColor: 'transparent' },
                    }}
                  />
                </Stack>
              )}
            </NotedSettingsProvider>
          </KeyboardProvider>
        </LocalStoreProvider>
      </QueryProvider>
    </AuthSetup>
  );
}

function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    Inter: require('../assets/fonts/Inter-VariableFont_opsz,wght.ttf'),
    'Inter-Italic': require('../assets/fonts/Inter-Italic-VariableFont_opsz,wght.ttf'),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;

  return (
    <AppErrorBoundary>
      <BloomProvider
        scrollAdapter={expoRouterScrollAdapter}
        defaultMode="system"
        defaultColorPreset="yellow"
        persistKey={BLOOM_THEME_PERSIST_KEY}
        storage={BLOOM_THEME_STORAGE}
        fonts={false}
      >
        <OxyProvider
          oxyServices={oxyServices}
          clientId={OXY_CLIENT_ID}
          authRedirectUri={Platform.OS !== 'web' ? AUTH_REDIRECT_URI : undefined}
          language={{
            supportedLocales: SUPPORTED_LANGUAGE_CODES,
            fallbackLocale: 'en',
            onChange: (locale) => useI18nStore.getState().setLocale(locale),
            onError: handleLanguageError,
          }}
        >
          <AppContent />
        </OxyProvider>
      </BloomProvider>
    </AppErrorBoundary>
  );
}

export default RootLayout;
