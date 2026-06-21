import { View, Pressable, TextInput, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "expo-router";
import type { DrawerNavigationProp } from "@react-navigation/drawer";
import { Menu, Search, X, LayoutGrid, Rows3 } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/useColorScheme";
import { useTranslation } from "@/hooks/useTranslation";
import { useNotesUIStore, type ViewMode } from "@/lib/stores/notes-ui-store";

interface NotesHeaderProps {
  title: string;
  /** Show the live search input (home only). */
  searchable?: boolean;
}

type DrawerNav = DrawerNavigationProp<Record<string, object | undefined>>;

/** Top bar for note list screens: drawer toggle, title/search, layout toggle. */
export function NotesHeader({ title, searchable = false }: NotesHeaderProps) {
  const navigation = useNavigation<DrawerNav>();
  const insets = useSafeAreaInsets();
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const isLargeScreen = width >= 768;

  const viewMode = useNotesUIStore((s) => s.viewMode);
  const toggleViewMode = useNotesUIStore((s) => s.toggleViewMode);
  const searchQuery = useNotesUIStore((s) => s.searchQuery);
  const setSearchQuery = useNotesUIStore((s) => s.setSearchQuery);

  const LayoutIcon = viewMode === "grid" ? Rows3 : LayoutGrid;
  const nextMode: ViewMode = viewMode === "grid" ? "list" : "grid";

  return (
    <View
      className="border-b border-border bg-background px-3"
      style={{ paddingTop: insets.top }}
    >
      <View className="h-14 flex-row items-center gap-1">
        {!isLargeScreen && (
          <Pressable
            onPress={() => navigation.toggleDrawer()}
            accessibilityLabel="Open menu"
            className="h-10 w-10 items-center justify-center rounded-full active:bg-muted"
          >
            <Menu size={20} color={colors.foreground} />
          </Pressable>
        )}

        {searchable ? (
          <View className="ml-1 h-10 flex-1 flex-row items-center gap-2 rounded-full bg-muted px-3">
            <Search size={18} color={colors.mutedForeground} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t("notes.searchPlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              className="h-10 flex-1 text-base text-foreground"
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <Pressable
                onPress={() => setSearchQuery("")}
                accessibilityLabel={t("common.close")}
                hitSlop={8}
              >
                <X size={16} color={colors.mutedForeground} />
              </Pressable>
            )}
          </View>
        ) : (
          <Text className="ml-1 flex-1 text-lg font-bold text-foreground">
            {title}
          </Text>
        )}

        <Pressable
          onPress={toggleViewMode}
          accessibilityLabel={`Switch to ${nextMode} view`}
          className="h-10 w-10 items-center justify-center rounded-full active:bg-muted"
        >
          <LayoutIcon size={20} color={colors.foreground} />
        </Pressable>
      </View>
    </View>
  );
}
