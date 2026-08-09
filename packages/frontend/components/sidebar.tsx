import React from "react";
import {
  View,
  Pressable,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { Text } from "@/components/ui/text";
import {
  Tag,
  Archive,
  Trash2,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  Plus,
} from "lucide-react-native";
import { AddTaskIcon, StickyNoteIcon } from "@/components/ui/nav-icons";
import { useTranslation } from "@/hooks/useTranslation";
import { useUIStore } from "@/lib/stores/ui-store";
import { useNotesUIStore } from "@/lib/stores/notes-ui-store";
import { useRouter, usePathname, useNavigation } from "expo-router";
import { useDrawerStatus } from "expo-router/drawer";
import type { DrawerNavigationProp } from "@react-navigation/drawer";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";
import { openAccountDialog, ProfileButton } from "@oxyhq/services";
import { NotedWordmark } from "@/components/ui/noted-wordmark";
import { NotedMark } from "@/components/ui/noted-mark";
import { useLabels } from "@/lib/hooks/use-labels";
import { useColorScheme } from "@/lib/useColorScheme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cn } from "@/lib/utils";

type DrawerNav = DrawerNavigationProp<Record<string, object | undefined>>;

/* ================================================================
   Root sidebar — routes to settings sidebar on /settings
   ================================================================ */

/**
 * Width of the drawer, expanded and collapsed. Both layouts need it: `(app)`
 * sizes the drawer with it, and the root layout offsets the floating bottom
 * stack by half of it so the stack centres on the content rather than the
 * window.
 */
export const SIDEBAR_WIDTH_EXPANDED = 280;
export const SIDEBAR_WIDTH_COLLAPSED = 48;

export function Sidebar() {
  const pathname = usePathname();
  // Mirrored into the store because the drawer's status is only readable from
  // inside its own context, and the layout that draws the floating bottom
  // stack is outside it.
  const status = useDrawerStatus();
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  React.useEffect(() => {
    setSidebarOpen(status === "open");
  }, [status, setSidebarOpen]);

  if (pathname.startsWith("/settings")) return <SettingsSidebar />;
  return <NotesSidebar />;
}

/* ================================================================
   Nav item
   ================================================================ */

interface NavItemProps {
  /** Lucide or one of the Material Symbols in `nav-icons` — both draw at a size in a colour. */
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  onPress: () => void;
  isActive?: boolean;
  collapsed?: boolean;
}

function NavItem({ icon: Icon, label, onPress, isActive, collapsed }: NavItemProps) {
  const { colors } = useColorScheme();

  if (collapsed) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityLabel={label}
        className={cn(
          "h-12 w-12 items-center justify-center rounded-full web:transition",
          isActive ? "bg-primary/10" : "active:bg-muted web:hover:bg-muted"
        )}
      >
        <Icon size={20} color={isActive ? colors.primary : colors.foreground} />
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      className={cn(
        "mx-2 h-12 flex-row items-center gap-4 rounded-full px-4 web:transition",
        isActive ? "bg-primary/10" : "active:bg-muted web:hover:bg-muted"
      )}
    >
      <Icon size={20} color={isActive ? colors.primary : colors.foreground} />
      <Text
        className={cn(
          "flex-1 text-sm",
          isActive ? "font-semibold text-primary" : "text-foreground"
        )}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/* ================================================================
   Notes sidebar
   ================================================================ */

const NotesSidebar = React.memo(function NotesSidebar() {
  const router = useRouter();
  const navigation = useNavigation<DrawerNav>();
  const pathname = usePathname();
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const insets = useSafeAreaInsets();
  const dimensions = useWindowDimensions();
  const isLargeScreen = dimensions.width >= 768;

  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useUIStore((s) => s.toggleSidebarCollapsed);
  const activeLabel = useNotesUIStore((s) => s.activeLabel);
  const setActiveLabel = useNotesUIStore((s) => s.setActiveLabel);
  const setSearchQuery = useNotesUIStore((s) => s.setSearchQuery);

  const { data: labels } = useLabels();

  const isCollapsed = isLargeScreen && sidebarCollapsed;

  const closeDrawerOnMobile = React.useCallback(() => {
    if (!isLargeScreen) navigation.closeDrawer();
  }, [isLargeScreen, navigation]);

  const goHome = React.useCallback(() => {
    setActiveLabel(null);
    setSearchQuery("");
    router.push("/(app)");
    closeDrawerOnMobile();
  }, [router, setActiveLabel, setSearchQuery, closeDrawerOnMobile]);

  const goReminders = React.useCallback(() => {
    router.push("/(app)/reminders");
    closeDrawerOnMobile();
  }, [router, closeDrawerOnMobile]);

  const goArchive = React.useCallback(() => {
    router.push("/(app)/archive");
    closeDrawerOnMobile();
  }, [router, closeDrawerOnMobile]);

  const goTrash = React.useCallback(() => {
    router.push("/(app)/trash");
    closeDrawerOnMobile();
  }, [router, closeDrawerOnMobile]);

  const goLabels = React.useCallback(() => {
    router.push("/(app)/labels");
    closeDrawerOnMobile();
  }, [router, closeDrawerOnMobile]);

  const goSettings = React.useCallback(() => {
    router.push("/(app)/settings");
    closeDrawerOnMobile();
  }, [router, closeDrawerOnMobile]);

  const openLabel = React.useCallback(
    (labelId: string) => {
      setActiveLabel(labelId);
      setSearchQuery("");
      router.push("/(app)");
      closeDrawerOnMobile();
    },
    [router, setActiveLabel, setSearchQuery, closeDrawerOnMobile]
  );

  const handleLogin = React.useCallback(() => openAccountDialog(), []);

  const isHome = pathname === "/" || pathname === "/(app)" || (pathname.startsWith("/(app)") && !pathname.includes("/"));
  const allLabels = labels ?? [];

  /* ───────────────── Collapsed (desktop) ───────────────── */
  if (isCollapsed) {
    return (
      <View
        className="h-full flex-col items-center border-r border-border bg-background"
        style={{ width: 48, paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        {/* The mark, not the wordmark: the rail is 48px wide, and a word
            squeezed into it is unreadable rather than small. */}
        <View className="h-14 items-center justify-center">
          <NotedMark size={24} color={colors.foreground} />
        </View>
        <View className="flex-col items-center gap-1 py-1">
          <NavItem icon={StickyNoteIcon} label={t("notes.title")} onPress={goHome} collapsed />
          <NavItem icon={AddTaskIcon} label={t("notes.remindersTitle")} onPress={goReminders} collapsed />
          <NavItem icon={Tag} label={t("notes.labelsTitle")} onPress={goLabels} collapsed />
          <NavItem icon={Archive} label={t("notes.archiveTitle")} onPress={goArchive} collapsed />
          <NavItem icon={Trash2} label={t("notes.trashTitle")} onPress={goTrash} collapsed />
          <NavItem icon={Settings} label={t("nav.settings")} onPress={goSettings} collapsed />
        </View>
        <View className="flex-1" />
        <View className="flex-col items-center gap-2 p-2">
          <Pressable
            onPress={toggleSidebarCollapsed}
            accessibilityLabel="Expand sidebar"
            className="h-10 w-10 items-center justify-center rounded-full active:bg-muted"
          >
            <ChevronsRight size={18} color={colors.mutedForeground} />
          </Pressable>
          <ProfileButton
            expanded={false}
            onNavigateManage={goSettings}
            onAddAccount={handleLogin}
          />
        </View>
      </View>
    );
  }

  /* ───────────────── Expanded ───────────────── */
  return (
    <View
      className="h-full w-full flex-col border-r border-border bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      {/* Header */}
      <View className="h-14 flex-row items-center px-4">
        <Pressable onPress={goHome} className="rounded-xl p-1 active:bg-muted">
          <NotedWordmark width={96} color={colors.foreground} />
        </Pressable>
        {isLargeScreen && (
          <View className="ml-auto">
            <Pressable
              onPress={toggleSidebarCollapsed}
              accessibilityLabel="Collapse sidebar"
              className="h-10 w-10 items-center justify-center rounded-full active:bg-muted"
            >
              <ChevronsLeft size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>
        )}
      </View>

      {/* Nav */}
      <ScrollView className="flex-1" contentContainerClassName="py-1">
        <NavItem
          icon={StickyNoteIcon}
          label={t("notes.title")}
          onPress={goHome}
          isActive={isHome && !activeLabel}
        />
        <NavItem icon={AddTaskIcon} label={t("notes.remindersTitle")} onPress={goReminders} isActive={pathname.includes("/reminders")} />

        {/* Labels */}
        {allLabels.length > 0 && (
          <>
            <View className="mb-1 mt-3 pl-6">
              <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("notes.labelsTitle")}
              </Text>
            </View>
            {allLabels.map((label) => (
              <NavItem
                key={label.id}
                icon={Tag}
                label={label.name}
                onPress={() => openLabel(label.id)}
                isActive={isHome && activeLabel === label.id}
              />
            ))}
          </>
        )}

        <Pressable
          onPress={goLabels}
          className="mx-2 h-12 flex-row items-center gap-4 rounded-full px-4 web:transition active:bg-muted web:hover:bg-muted"
        >
          <Plus size={20} color={colors.mutedForeground} />
          <Text className="text-sm text-muted-foreground">{t("notes.editLabels")}</Text>
        </Pressable>

        <View className="my-2 mx-4 border-t border-border/40" />

        <NavItem icon={Archive} label={t("notes.archiveTitle")} onPress={goArchive} isActive={pathname.includes("/archive")} />
        <NavItem icon={Trash2} label={t("notes.trashTitle")} onPress={goTrash} isActive={pathname.includes("/trash")} />
        <NavItem icon={Settings} label={t("nav.settings")} onPress={goSettings} isActive={pathname.includes("/settings")} />
      </ScrollView>

      {/* Account trigger. `ProfileButton` from the SDK owns all three auth
          states (undetermined skeleton, signed-in row + account switcher,
          signed-out "Sign in") and the device-account menu — the same component
          Mention's sidebar uses, so switching accounts behaves identically
          across Oxy apps and no app re-implements the session UI. */}
      <View className="mt-auto border-t border-border/40 p-2">
        <ProfileButton onNavigateManage={goSettings} onAddAccount={handleLogin} />
      </View>
    </View>
  );
});
