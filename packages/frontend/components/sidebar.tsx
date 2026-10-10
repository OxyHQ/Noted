import { useCallback } from "react";
import { usePathname, useRouter, type Href } from "expo-router";
import type { SidebarProps } from "@oxy.so/bloom/sidebar";
import { ProfileButton, openAccountDialog } from "@oxy.so/services";
import { RiFileTextLine } from "@oxy.so/bloom/icons/RiFileTextLine";
import { RiCalendarScheduleLine } from "@oxy.so/bloom/icons/RiCalendarScheduleLine";
import { RiPriceTag3Line } from "@oxy.so/bloom/icons/RiPriceTag3Line";
import { RiArchiveLine } from "@oxy.so/bloom/icons/RiArchiveLine";
import { RiDeleteBinLine } from "@oxy.so/bloom/icons/RiDeleteBinLine";
import { RiSettings3Line } from "@oxy.so/bloom/icons/RiSettings3Line";
import { RiAddLine } from "@oxy.so/bloom/icons/RiAddLine";
import { RiNotification3Line } from "@oxy.so/bloom/icons/RiNotification3Line";
import { NotedMark } from "@/components/ui/noted-mark";
import { useNotedSettings } from "@/components/settings/settings-provider";
import { useTranslation } from "@/hooks/useTranslation";
import { useLabels } from "@/lib/hooks/use-labels";
import { useLocalStoreState } from "@/lib/db/local-store-context";
import { useUIStore } from "@/lib/stores/ui-store";
import { useNotesUIStore } from "@/lib/stores/notes-ui-store";
import { useColorScheme } from "@/lib/useColorScheme";

/** Noted owns destinations; Bloom owns the responsive rail, drawer and chrome. */
export function useNotedSidebar(closeDrawer: () => void): SidebarProps {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const settings = useNotedSettings();
  const { isReady } = useLocalStoreState();
  const { data: labels } = useLabels();
  const collapsed = useUIStore((state) => state.sidebarCollapsed);
  const setCollapsed = useUIStore((state) => state.setSidebarCollapsed);
  const activeLabel = useNotesUIStore((state) => state.activeLabel);
  const setActiveLabel = useNotesUIStore((state) => state.setActiveLabel);
  const setSearchQuery = useNotesUIStore((state) => state.setSearchQuery);

  const navigate = useCallback((href: Href) => {
    closeDrawer();
    router.navigate(href);
  }, [closeDrawer, router]);
  const goHome = useCallback(() => {
    setActiveLabel(null);
    setSearchQuery("");
    navigate("/(app)");
  }, [navigate, setActiveLabel, setSearchQuery]);
  const openSettings = useCallback(() => {
    closeDrawer();
    settings.open();
  }, [closeDrawer, settings]);
  const openAccount = useCallback(() => {
    closeDrawer();
    settings.open("account");
  }, [closeDrawer, settings]);
  const addAccount = useCallback(() => {
    closeDrawer();
    openAccountDialog();
  }, [closeDrawer]);

  return {
    surface: "plain",
    size: "md",
    showSearch: false,
    showThemeToggle: false,
    collapsed,
    onCollapsedChange: setCollapsed,
    logo: {
      icon: <NotedMark size={28} color={colors.foreground} />,
      wordmark: "Noted",
      accessibilityLabel: "Noted",
      href: "/",
      onPress: goHome,
    },
    selected: pathname === "/" && activeLabel ? `label:${activeLabel}` : pathname,
    items: [
      { key: "/", label: t("notes.title"), icon: RiFileTextLine, href: "/", onPress: goHome },
      { key: "/reminders", label: t("notes.remindersTitle"), icon: RiCalendarScheduleLine, href: "/reminders", onPress: () => navigate("/(app)/reminders") },
      { key: "/archive", label: t("notes.archiveTitle"), icon: RiArchiveLine, href: "/archive", onPress: () => navigate("/(app)/archive") },
      { key: "/trash", label: t("notes.trashTitle"), icon: RiDeleteBinLine, href: "/trash", onPress: () => navigate("/(app)/trash") },
      { key: "/labels", label: t("notes.editLabels"), icon: RiPriceTag3Line, href: "/labels", onPress: () => navigate("/(app)/labels") },
      ...(labels ?? []).map((label) => ({
        key: `label:${label.id}`,
        label: label.name,
        icon: RiPriceTag3Line,
        onPress: () => {
          setActiveLabel(label.id);
          setSearchQuery("");
          navigate("/(app)");
        },
      })),
    ],
    secondaryItems: [
      { key: "/notifications", label: t("notifications.title"), icon: RiNotification3Line, href: "/notifications", onPress: () => navigate("/(app)/notifications") },
      { key: "settings", label: t("nav.settings"), icon: RiSettings3Line, onPress: openSettings },
    ],
    primaryAction: {
      label: t("notes.takeANote"),
      icon: RiAddLine,
      disabled: !isReady,
      onPress: () => {
        navigate({ pathname: "/n/[id]", params: { id: "new", ...(pathname === "/" && activeLabel ? { label: activeLabel } : {}) } });
      },
    },
    footer: ({ collapsed: isCollapsed }) => (
      <ProfileButton expanded={!isCollapsed} onNavigateManage={openAccount} onAddAccount={addAccount} />
    ),
  };
}
