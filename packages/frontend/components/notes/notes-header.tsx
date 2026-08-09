import { View, Pressable, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "expo-router";
import type { DrawerNavigationProp } from "@react-navigation/drawer";
import { Menu, LayoutGrid, Rows3, Mic } from "lucide-react-native";
import { Search } from "@oxyhq/bloom/search";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/useColorScheme";
import { useTranslation } from "@/hooks/useTranslation";
import { useNotesUIStore, type ViewMode } from "@/lib/stores/notes-ui-store";
import { useStartCapture } from "@/lib/capture/use-start-capture";

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

  const { start: startCapture, isRecording, isSupported: canCapture } = useStartCapture();

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
          // Bloom's Search rather than a hand-rolled field: it already carries
          // the magnifier, the pill shape, the clear button, the search return
          // key and the `search` accessibility role, and it follows the Bloom
          // theme everywhere else in the ecosystem does. `label` is what Bloom
          // renders as the placeholder.
          <View className="ml-1 flex-1">
            <Search
              value={searchQuery}
              onChangeText={setSearchQuery}
              label={t("notes.searchPlaceholder")}
              onClearText={() => setSearchQuery("")}
            />
          </View>
        ) : (
          <Text className="ml-1 flex-1 text-lg font-bold text-foreground">
            {title}
          </Text>
        )}

        {/* Hidden where the platform cannot record, and while recording: the
            stop control is in the bar directly above, so a second, inert
            microphone button here would only be somewhere to press that does
            nothing. Offering it on web and failing afterwards is worse still —
            the user has granted the microphone for nothing. */}
        {canCapture && !isRecording && (
          <Pressable
            onPress={() => void startCapture()}
            accessibilityLabel={t("capture.start")}
            className="h-10 w-10 items-center justify-center rounded-full active:bg-muted"
          >
            <Mic size={20} color={colors.foreground} />
          </Pressable>
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
