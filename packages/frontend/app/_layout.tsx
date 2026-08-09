import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect } from "react";
import { OxyProvider, useOxy } from "@oxyhq/services";
import { BloomThemeProvider } from "@oxyhq/bloom/theme";
import { ImageResolverProvider } from "@oxyhq/bloom/image-resolver";
import * as Linking from "expo-linking";
import { Platform, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppErrorBoundary } from "@/components/error-boundary";
import { RecordingPill } from "@/components/capture/recording-pill";
import { UndoSnackbar } from "@/components/notes/undo-snackbar";
import {
  SIDEBAR_WIDTH_COLLAPSED,
  SIDEBAR_WIDTH_EXPANDED,
} from "@/components/sidebar";
import { useUIStore } from "@/lib/stores/ui-store";
import { KeyboardProvider } from "@/lib/keyboard";
import { useColorScheme } from "@/lib/useColorScheme";
import { setTokenGetter } from "@/lib/api/client";
import { OXY_CLIENT_ID } from "@/lib/oxy-client-id";
import {
  BLOOM_THEME_PERSIST_KEY,
  BLOOM_THEME_STORAGE,
} from "@/lib/themePersistence";
import "react-native-reanimated";
import "../global.css";
import "@/lib/i18n";

export { ErrorBoundary } from "expo-router";

/** Clear of the home indicator and any bottom chrome. */
const BOTTOM_STACK_MARGIN = 16;

export const unstable_settings = {
  initialRouteName: "(app)",
};

SplashScreen.preventAutoHideAsync();

const OXY_API_URL = process.env.EXPO_PUBLIC_OXY_API_URL || "https://api.oxy.so";
const AUTH_REDIRECT_URI = Linking.createURL("/");

function AuthSetup({ children }: { children: React.ReactNode }) {
  const { oxyServices } = useOxy();

  setTokenGetter(() => oxyServices.getAccessToken() || null);

  // Resolve Oxy file IDs to thumbnail download URLs for any Bloom component
  // that reads useImageResolver() (e.g. Avatar with a raw file id `source`).
  const resolveImageSource = useCallback(
    (fileId: string): string | undefined => {
      const url = oxyServices.getFileDownloadUrl(fileId, "thumb");
      return url && url.startsWith("http") ? url : undefined;
    },
    [oxyServices],
  );

  return (
    <ImageResolverProvider value={resolveImageSource}>
      {children}
    </ImageResolverProvider>
  );
}

/**
 * The recording indicator, its stop button, and the undo snackbar.
 *
 * Mounted HERE, above the root `Stack`, rather than in the `(app)` layout: the
 * note editor is a sibling route presented as a transparent modal, so it paints
 * above the whole `(app)` subtree. A stack drawn inside `(app)` therefore
 * disappeared behind an open note — the microphone stayed open with no visible
 * indicator and no reachable stop control, which is exactly the screen a person
 * is on while a meeting is being recorded.
 *
 * Anchored to the BOTTOM edge on purpose: while recording, the pill carries a
 * live transcription line below it that is rewritten as the recogniser re-reads
 * the current span, so the stack's height changes several times a second. Only
 * the bottom edge is stable.
 */
function FloatingBottomStack() {
  const insets = useSafeAreaInsets();
  const dimensions = useWindowDimensions();
  const isLargeScreen = dimensions.width >= 768;
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);

  // An open drawer covers the content on a small screen, so the stack stands
  // down rather than floating over the sidebar and its scrim. A permanent
  // drawer reports itself open for the whole session and shares the width
  // instead of covering it — hence the breakpoint.
  if (sidebarOpen && !isLargeScreen) return null;

  const sidebarWidth = isLargeScreen
    ? sidebarCollapsed
      ? SIDEBAR_WIDTH_COLLAPSED
      : SIDEBAR_WIDTH_EXPANDED
    : 0;

  return (
    // Hugging its contents (`self-center`) rather than stretching: a full-width
    // layer over the app, sidebar included, would leave everything beneath it
    // depending on `pointerEvents: 'box-none'` surviving every future style
    // change. Shifted right by half the sidebar because `self-center` centres on
    // the WINDOW, while the notes are centred on what is left of it;
    // transitioned to match the sidebar's own width animation.
    <View
      className="absolute bottom-0 self-center items-center gap-2"
      style={{
        paddingBottom: insets.bottom + BOTTOM_STACK_MARGIN,
        transform: [{ translateX: sidebarWidth / 2 }],
        ...(Platform.OS === "web"
          ? {
              transitionProperty: "transform",
              transitionDuration: "200ms",
              transitionTimingFunction: "ease-out",
            }
          : {}),
      }}
    >
      <UndoSnackbar />
      <RecordingPill />
    </View>
  );
}

function AppContent() {
  const { colors } = useColorScheme();

  return (
    <AuthSetup>
      <KeyboardProvider>
        <View style={{ flex: 1 }}>
          <Stack
            screenOptions={{
              contentStyle: {
                backgroundColor: colors.background,
              },
            }}
          >
            <Stack.Screen name="(app)" options={{ headerShown: false }} />
            {/* Editor presented as a transparent modal ABOVE the (app) drawer so
              the masonry grid + sidebar stay mounted and visible behind it —
              Keep-style overlay, not a page change. */}
            <Stack.Screen
              name="n/[id]"
              options={{
                presentation: "transparentModal",
                animation: "fade",
                headerShown: false,
                // Override the global opaque contentStyle so the modal screen's
                // content container does NOT paint a solid background. Without this
                // the inherited `colors.background` covers the (app) grid → solid
                // black behind the dialog on web. The native-stack web renderer
                // already (a) sets the transparentModal screen's own wrapper to
                // transparent and (b) keeps the previous (app) screen mounted and
                // displayed because the next screen is a transparent presentation,
                // so the grid + sidebar stay visible behind the dim backdrop.
                contentStyle: { backgroundColor: "transparent" },
              }}
            />
          </Stack>
          <FloatingBottomStack />
        </View>
      </KeyboardProvider>
    </AuthSetup>
  );
}

function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    Inter: require("../assets/fonts/Inter-VariableFont_opsz,wght.ttf"),
    "Inter-Italic": require("../assets/fonts/Inter-Italic-VariableFont_opsz,wght.ttf"),
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
      <BloomThemeProvider
        defaultMode="system"
        defaultColorPreset="yellow"
        persistKey={BLOOM_THEME_PERSIST_KEY}
        storage={BLOOM_THEME_STORAGE}
        fonts={false}
      >
        <OxyProvider
          baseURL={OXY_API_URL}
          clientId={OXY_CLIENT_ID}
          authRedirectUri={
            Platform.OS !== "web" ? AUTH_REDIRECT_URI : undefined
          }
        >
          <AppContent />
        </OxyProvider>
      </BloomThemeProvider>
    </AppErrorBoundary>
  );
}

export default RootLayout;
