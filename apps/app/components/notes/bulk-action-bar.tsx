import { View, Pressable } from "react-native";
import Animated, { FadeInDown, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X, Pin, Palette, Archive, Trash2 } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/useColorScheme";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";

interface BulkActionBarProps {
  count: number;
  onClose: () => void;
  onPin: () => void;
  onColor: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

/** Top action bar shown while in multi-select mode on a list screen. */
export function BulkActionBar({
  count,
  onClose,
  onPin,
  onColor,
  onArchive,
  onDelete,
}: BulkActionBarProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useColorScheme();
  const reduceMotion = useReducedMotion();

  const Action = ({
    icon: Icon,
    label,
    onPress,
  }: {
    icon: typeof Pin;
    label: string;
    onPress: () => void;
  }) => (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      className="h-10 w-10 items-center justify-center rounded-full active:bg-muted"
    >
      <Icon size={20} color={colors.foreground} />
    </Pressable>
  );

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInDown.duration(200)}
      exiting={reduceMotion ? undefined : FadeOutUp.duration(150)}
      className="flex-row items-center border-b border-border bg-background px-2"
      style={{ paddingTop: insets.top }}
    >
      <View className="h-14 flex-row items-center">
        <Pressable
          onPress={onClose}
          accessibilityLabel="Close selection"
          className="h-10 w-10 items-center justify-center rounded-full active:bg-muted"
        >
          <X size={20} color={colors.foreground} />
        </Pressable>
        <Text className="ml-1 text-base font-semibold text-foreground">{count}</Text>
      </View>
      <View className="ml-auto flex-row items-center gap-1">
        <Action icon={Pin} label="Pin" onPress={onPin} />
        <Action icon={Palette} label="Color" onPress={onColor} />
        <Action icon={Archive} label="Archive" onPress={onArchive} />
        <Action icon={Trash2} label="Delete" onPress={onDelete} />
      </View>
    </Animated.View>
  );
}
