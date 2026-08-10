import { Drawer } from "expo-router/drawer";
import { Sidebar } from "@/components/sidebar";
import { AppErrorBoundary } from "@/components/error-boundary";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { View, Platform, useWindowDimensions } from "react-native";
import { useCallback } from "react";
import { useColorScheme } from "@/lib/useColorScheme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUIStore } from "@/lib/stores/ui-store";
import i18n from "@/lib/i18n";
import { QueryProvider } from "@/lib/query-client";
import { useNotificationSetup } from "@/lib/hooks/use-notification-setup";
import { useNotesRealtime } from "@/lib/hooks/use-notes-realtime";
import { useLocalStore } from "@/lib/db/use-local-store";
import { CaptureEngineHost } from "@/components/capture/capture-engine-host";
import { FloatingBottomStack } from "@/components/floating-bottom-stack";

// Top-level list routes that render their own header (and own top inset).
const SELF_INSET_ROUTES = new Set([
  "index",
  "reminders",
  "archive",
  "trash",
  "labels",
]);

const SIDEBAR_WIDTH_EXPANDED = 280;
const SIDEBAR_WIDTH_COLLAPSED = 48;

/**
 * Every drawer scene carries the floating bottom stack.
 *
 * Inside the scene rather than beside the navigator, so an open drawer covers
 * the recording indicator exactly as it covers the note cards and the FAB — the
 * scene is also the content area, so `self-center` lands on the content without
 * anything having to know the sidebar's width.
 */
const renderScene = ({ children }: { children: React.ReactNode }) => (
  <View style={{ flex: 1 }}>
    {children}
    <FloatingBottomStack />
  </View>
);

// Routes shown as items in the drawer sidebar list. The Sidebar component
// renders its own nav, so we hide the auto-generated drawer items entirely.
const VISIBLE_ROUTES = new Set<string>();


/**
 * The app's own react-query client, mounted where its own hooks can see it.
 *
 * `useNotificationSetup` calls `useQueryClient()`, which THROWS rather than
 * returning null when no provider is above it — and this app had none. It worked
 * only for as long as it borrowed the client `OxyProvider` mounts for its own
 * internals, which is not a contract: a dependency reorganising its provider tree
 * takes the app's notifications down with it, and the failure is a white screen
 * behind an error boundary rather than anything that names the cause.
 *
 * `lib/query-client.tsx` was written for this and never mounted. It is mounted
 * here rather than at the root because the hooks that need it live in THIS
 * component, and a provider cannot serve the component that renders it.
 */
export default function AppLayout() {
  return (
    <QueryProvider>
      <AppLayoutContent />
    </QueryProvider>
  );
}

function AppLayoutContent() {
  const dimensions = useWindowDimensions();
  const isLargeScreen = dimensions.width >= 768;
  const { colors } = useColorScheme();
  const insets = useSafeAreaInsets();
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);

  // Push notification registration + tap handling.
  useNotificationSetup();
  // Open this account's local database and keep it synchronised. Must be
  // mounted before anything queries notes — a query with no active account has
  // no database file to open.
  useLocalStore();
  // Server-side changes arrive here and are pulled in through the same
  // reconciliation path as any other sync.
  useNotesRealtime();

  const renderDrawerContent = useCallback(() => <Sidebar />, []);

  const drawerWidth =
    isLargeScreen && sidebarCollapsed
      ? SIDEBAR_WIDTH_COLLAPSED
      : SIDEBAR_WIDTH_EXPANDED;

  const screenOptions = useCallback(
    ({ route }: { route: { name: string } }) => ({
      headerShown: false,
      sceneContainerStyle: {
        paddingTop:
          SELF_INSET_ROUTES.has(route.name) || route.name.startsWith("settings")
            ? 0
            : insets.top,
      },
      drawerStyle: {
        width: drawerWidth,
        backgroundColor: colors.background,
        borderRightWidth: 0,
        boxShadow: "none" as const,
        elevation: 0,
        ...(Platform.OS === "web" && isLargeScreen
          ? {
              transitionProperty: "width",
              transitionDuration: "200ms",
              transitionTimingFunction: "ease-out",
            }
          : {}),
      },
      drawerType: isLargeScreen ? ("permanent" as const) : ("front" as const),
      swipeEnabled: !isLargeScreen,
      overlayColor: isLargeScreen ? "transparent" : "rgba(0, 0, 0, 0.5)",
      drawerItemStyle: VISIBLE_ROUTES.has(route.name)
        ? undefined
        : { display: "none" as const },
    }),
    [insets.top, colors.background, isLargeScreen, drawerWidth],
  );

  return (
    <AppErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View className="isolate flex h-screen flex-row">
          <View className="isolate flex h-auto max-h-screen min-w-0 grow flex-col">
            <View className="relative isolate min-h-0 flex-1 overflow-hidden bg-background">
              <Drawer
                drawerContent={renderDrawerContent}
                screenOptions={screenOptions}
                screenLayout={renderScene}
              >
                <Drawer.Screen
                  name="index"
                  options={{ title: i18n.t("notes.title") }}
                />
                <Drawer.Screen
                  name="reminders"
                  options={{ title: i18n.t("notes.remindersTitle") }}
                />
                <Drawer.Screen
                  name="archive"
                  options={{ title: i18n.t("notes.archiveTitle") }}
                />
                <Drawer.Screen
                  name="trash"
                  options={{ title: i18n.t("notes.trashTitle") }}
                />
                <Drawer.Screen
                  name="labels"
                  options={{ title: i18n.t("notes.labelsTitle") }}
                />
                <Drawer.Screen
                  name="settings/index"
                  options={{ title: i18n.t("nav.settings") }}
                />
              </Drawer>
              {/* Holds the microphone and draws nothing. One mount, here rather
                  than beside the indicator, because two engines would be two
                  microphones — and because it reads the local database, which
                  only exists once this layout has opened an account's store. */}
              <CaptureEngineHost />
            </View>
          </View>
        </View>
      </GestureHandlerRootView>
    </AppErrorBoundary>
  );
}
