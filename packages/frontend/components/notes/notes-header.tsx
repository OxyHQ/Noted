import { View } from "react-native";
import { AppShellMenuButton } from "@oxy.so/bloom/app-shell";
import { PageHeader } from "@oxy.so/bloom/page-header";
import { Button } from "@oxy.so/bloom/button";
import { Search } from "@oxy.so/bloom/search";
import { RiLayoutGridLine } from "@oxy.so/bloom/icons/RiLayoutGridLine";
import { RiListView } from "@oxy.so/bloom/icons/RiListView";
import { useTranslation } from "@/hooks/useTranslation";
import { useNotesUIStore } from "@/lib/stores/notes-ui-store";

interface NotesHeaderProps {
  title: string;
  /** Show the live local search input (home only). */
  searchable?: boolean;
}

export function NotesHeader({ title, searchable = false }: NotesHeaderProps) {
  const { t } = useTranslation();
  const viewMode = useNotesUIStore((state) => state.viewMode);
  const toggleViewMode = useNotesUIStore((state) => state.toggleViewMode);
  const searchQuery = useNotesUIStore((state) => state.searchQuery);
  const setSearchQuery = useNotesUIStore((state) => state.setSearchQuery);

  return (
    <PageHeader
      safeArea={false}
      leading={<AppShellMenuButton />}
      title={searchable ? (
        <View style={{ width: "100%", maxWidth: 720 }}>
          <Search
            value={searchQuery}
            onChangeText={setSearchQuery}
            label={t("notes.searchPlaceholder")}
            onClearText={() => setSearchQuery("")}
          />
        </View>
      ) : title}
      actions={
        <Button
          appearance="plain"
          tone="neutral"
          iconOnly
          icon={viewMode === "grid" ? RiListView : RiLayoutGridLine}
          onPress={toggleViewMode}
          accessibilityLabel={t(viewMode === "grid" ? "notes.listView" : "notes.gridView")}
        />
      }
    />
  );
}
