import { useCallback, useState } from "react";
import { Slot, Stack, usePathname } from "expo-router";
import { Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AppShell } from "@oxy.so/bloom/app-shell";
import { AppErrorBoundary } from "@/components/error-boundary";
import { useNotedSidebar } from "@/components/sidebar";
import { LocalStoreBoundary } from "@/components/local-store-boundary";
import { NotesHeader } from "@/components/notes/notes-header";
import { FloatingBottomStack } from "@/components/floating-bottom-stack";
import { useTranslation } from "@/hooks/useTranslation";
import { useNotificationSetup } from "@/lib/hooks/use-notification-setup";
import { useNotesRealtime } from "@/lib/hooks/use-notes-realtime";
import { useColorScheme } from "@/lib/useColorScheme";

/** Keep each routed screen behind account-scoped SQLite readiness. */
function Scene({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const publicRoute = pathname.startsWith("/settings") || pathname.startsWith("/authorize") ||
    pathname === "/forgot-password" || pathname === "/reset-password";
  if (publicRoute) return <View style={{ flex: 1 }}>{children}</View>;
  return (
    <LocalStoreBoundary fallbackHeader={<NotesHeader title={t("notes.title")} />}>
      {children}
    </LocalStoreBoundary>
  );
}
const renderScene = ({ children }: { children: React.ReactNode }) => <Scene>{children}</Scene>;

/** Bloom owns shell geometry, mobile navigation and the shared sidebar. */
export default function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const sidebar = useNotedSidebar(closeDrawer);
  const { colors } = useColorScheme();

  useNotificationSetup();
  useNotesRealtime();

  return (
    <AppErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <AppShell
          variant="feed"
          scroll={Platform.OS === "web" ? "document" : "fixed"}
          safeArea
          panel
          sidebar={sidebar}
          drawer="reveal"
          drawerOpen={drawerOpen}
          onDrawerOpenChange={setDrawerOpen}
          navFrom={768}
          contentWidth={1800}
          navigationGap={8}
          gutter={8}
          header={null}
          bottomBar={<FloatingBottomStack />}
          bottomBarVisibility="always"
          testID="noted-app-shell"
        >
          {Platform.OS === "web" ? <Scene><Slot /></Scene> : <Stack
            screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
            screenLayout={renderScene}
          />}
        </AppShell>
      </GestureHandlerRootView>
    </AppErrorBoundary>
  );
}
