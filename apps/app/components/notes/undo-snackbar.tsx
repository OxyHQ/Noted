import { Pressable } from "react-native";
import Animated, { SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/useColorScheme";
import { useTranslation } from "@/hooks/useTranslation";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";

interface UndoSnackbarProps {
  /** Message shown on the left of the snackbar. */
  message: string;
  /** Invoked when the user taps "Undo". */
  onUndo: () => void;
}

/**
 * Keep-style undo snackbar: a dark pill anchored bottom-center that slides up
 * from the bottom edge, carrying a message and an "Undo" action. Mount/unmount
 * is owned by the caller (which also drives the auto-dismiss timer); this
 * component is purely presentational and animates its own enter/exit.
 */
export function UndoSnackbar({ message, onUndo }: UndoSnackbarProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();

  return (
    <Animated.View
      entering={reduceMotion ? undefined : SlideInDown.duration(200)}
      exiting={reduceMotion ? undefined : SlideOutDown.duration(150)}
      pointerEvents="box-none"
      className="absolute inset-x-0 items-center px-4"
      style={{ bottom: insets.bottom + 16 }}
    >
      <Pressable
        accessibilityRole="alert"
        className="w-full max-w-[420px] flex-row items-center justify-between rounded-lg px-4 py-3 shadow-lg"
        style={{ backgroundColor: colors.foreground }}
      >
        <Text
          className="flex-1 text-sm"
          numberOfLines={1}
          style={{ color: colors.background }}
        >
          {message}
        </Text>
        <Pressable
          onPress={onUndo}
          accessibilityLabel={t("common.undo")}
          className="ml-3 rounded-md px-2 py-1 web:transition active:opacity-70 web:hover:opacity-80"
        >
          <Text
            className="text-sm font-semibold uppercase"
            style={{ color: colors.primary }}
          >
            {t("common.undo")}
          </Text>
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}
