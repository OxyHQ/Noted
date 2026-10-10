import { View } from "react-native";
import { Card } from "@oxy.so/bloom/card";
import { Button } from "@oxy.so/bloom/button";
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
      <Card
        radius="radius-12"
        elevation="m"
        style={{ backgroundColor: colors.foreground }}
      >
        <View
          accessibilityRole="alert"
          className="max-w-[420px] flex-row items-center justify-between px-4 py-3"
        >
          <Text
            className="flex-1 text-sm"
            numberOfLines={1}
            style={{ color: colors.background }}
          >
            {message}
          </Text>
          <Button
            appearance="plain"
            size="sm"
            onPress={onUndo}
            colors={{
              background: colors.foreground,
              foreground: colors.background,
            }}
          >
            {t("common.undo")}
          </Button>
        </View>
      </Card>
    </Animated.View>
  );
}
