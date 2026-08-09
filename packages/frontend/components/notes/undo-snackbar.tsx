import { Pressable } from "react-native";
import Animated, { SlideInDown, SlideOutDown } from "react-native-reanimated";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/useColorScheme";
import { useTranslation } from "@/hooks/useTranslation";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { useUndoStore } from "@/lib/stores/undo-store";

/**
 * Keep-style undo snackbar: a dark pill carrying a message and an "Undo"
 * action, drawn in the layout's bottom stack directly above the record button.
 *
 * It reads the offer from the store rather than taking props, because the
 * screen that creates the offer is not the thing that draws it — see the store
 * for why the two are separated. Where it sits is the stack's business; this
 * component only animates its own arrival and departure.
 */
export function UndoSnackbar() {
  const message = useUndoStore((s) => s.message);
  const onUndo = useUndoStore((s) => s.onUndo);
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();

  if (message === null || onUndo === null) return null;

  return (
    <Animated.View
      entering={reduceMotion ? undefined : SlideInDown.duration(200)}
      exiting={reduceMotion ? undefined : SlideOutDown.duration(150)}
    >
      <Pressable
        accessibilityRole="alert"
        className="max-w-[420px] flex-row items-center justify-between rounded-lg px-4 py-3 shadow-lg"
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
