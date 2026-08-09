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
import { useNotificationSetup } from "@/lib/hooks/use-notification-setup";
import { useNotesRealtime } from "@/lib/hooks/use-notes-realtime";
import { useLocalStore } from "@/lib/db/use-local-store";
import { RecordingPill } from "@/components/capture/recording-pill";
import { UndoSnackbar } from "@/components/notes/undo-snackbar";

// Top-level list routes that render their own header (and own top inset).
const SELF_INSET_ROUTES = new Set([
  "index",
  "reminders",
  "archive",
  "trash",
  "labels",
]);

// Routes shown as items in the drawer sidebar list. The Sidebar component
// renders its own nav, so we hide the auto-generated drawer items entirely.
const VISIBLE_ROUTES = new Set<string>();

/** Clear of the home indicator and any bottom chrome. */
const BOTTOM_STACK_MARGIN = 16;

const SIDEBAR_WIDTH_EXPANDED = 280;
const SIDEBAR_WIDTH_COLLAPSED = 48;

export default function AppLayout() {
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
    [insets.top, colors.background, isLargeScreen, drawerWidth]
  );

  return (
    <AppErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View className="isolate flex h-screen flex-row">
          <View className="isolate flex h-auto max-h-screen min-w-0 grow flex-col">
            <View className="relative isolate min-h-0 flex-1 overflow-hidden bg-background">
              <Drawer drawerContent={renderDrawerContent} screenOptions={screenOptions}>
                <Drawer.Screen name="index" options={{ title: i18n.t("notes.title") }} />
                <Drawer.Screen name="reminders" options={{ title: i18n.t("notes.remindersTitle") }} />
                <Drawer.Screen name="archive" options={{ title: i18n.t("notes.archiveTitle") }} />
                <Drawer.Screen name="trash" options={{ title: i18n.t("notes.trashTitle") }} />
                <Drawer.Screen name="labels" options={{ title: i18n.t("notes.labelsTitle") }} />
                <Drawer.Screen name="settings/index" options={{ title: i18n.t("nav.settings") }} />
              </Drawer>
              {/* The floating bottom stack, above the navigator so it survives
                  every screen change: the recording keeps running across screens
                  and into the background, and a control tied to one screen would
                  strand the microphone. The undo snackbar sits in the same stack
                  rather than inside the screen that raised it — a snackbar drawn
                  inside the navigator is painted under this button whatever
                  z-index it asks for, because the navigator is a whole stacking
                  context lower.

                  Hugging its contents (`self-center`) rather than stretching:
                  a full-width layer over the app, sidebar included, would leave
                  everything beneath it depending on `pointerEvents: 'box-none'`
                  surviving every future style change. Shifted right by half the
                  sidebar because `self-center` centres on the WINDOW, while the
                  notes are centred on what is left of it; transitioned to match
                  the sidebar's own width animation. */}
              <View
                className="absolute bottom-0 self-center items-center gap-2"
                style={{
                  paddingBottom: insets.bottom + BOTTOM_STACK_MARGIN,
                  transform: [
                    { translateX: (isLargeScreen ? drawerWidth : 0) / 2 },
                  ],
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
            </View>
          </View>
        </View>
      </GestureHandlerRootView>
    </AppErrorBoundary>
  );
}
