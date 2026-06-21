import React from "react";
import { View, Pressable, TextInput } from "react-native";
import { CheckSquare, X } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/useColorScheme";
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";

interface QuickCaptureProps {
  /** Create a plain note from the composed title/body. */
  onCreate: (input: { title: string; body: string }) => void;
  /** Open the full editor in checklist mode for a new note. */
  onCreateChecklist: () => void;
}

/**
 * Home-screen quick-capture bar. Collapsed it shows a single "Take a note…"
 * affordance; tapping expands it to a title + body composer that commits on
 * blur / close (Keep-style — no explicit save button).
 */
export function QuickCapture({ onCreate, onCreateChecklist }: QuickCaptureProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const [expanded, setExpanded] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const bodyRef = React.useRef<TextInput>(null);

  const reset = React.useCallback(() => {
    setTitle("");
    setBody("");
    setExpanded(false);
  }, []);

  const commit = React.useCallback(() => {
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (trimmedTitle || trimmedBody) {
      onCreate({ title: trimmedTitle, body: trimmedBody });
    }
    reset();
  }, [title, body, onCreate, reset]);

  const expand = React.useCallback(() => {
    setExpanded(true);
    // Focus the body after the layout expands.
    requestAnimationFrame(() => bodyRef.current?.focus());
  }, []);

  if (!expanded) {
    return (
      <View className="flex-row items-center rounded-2xl border border-border bg-card px-4 shadow-sm">
        <Pressable onPress={expand} className="h-12 flex-1 justify-center">
          <Text className="text-base text-muted-foreground">
            {t("notes.takeANote")}
          </Text>
        </Pressable>
        <Pressable
          onPress={onCreateChecklist}
          accessibilityLabel={t("notes.newChecklist")}
          className="h-10 w-10 items-center justify-center rounded-full active:bg-muted"
        >
          <CheckSquare size={20} className="text-muted-foreground" />
        </Pressable>
      </View>
    );
  }

  return (
    <View className="rounded-2xl border border-border bg-card px-4 py-2 shadow-sm">
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder={t("notes.titlePlaceholder")}
        placeholderTextColor={colors.mutedForeground}
        className="py-2 text-base font-semibold text-foreground"
        returnKeyType="next"
        onSubmitEditing={() => bodyRef.current?.focus()}
      />
      <TextInput
        ref={bodyRef}
        value={body}
        onChangeText={setBody}
        placeholder={t("notes.takeANote")}
        placeholderTextColor={colors.mutedForeground}
        className="min-h-[44px] py-1 text-base text-foreground"
        multiline
      />
      <View className="mt-1 flex-row items-center justify-between">
        <Pressable
          onPress={onCreateChecklist}
          accessibilityLabel={t("notes.newChecklist")}
          className="h-9 w-9 items-center justify-center rounded-full active:bg-muted"
        >
          <CheckSquare size={18} className="text-muted-foreground" />
        </Pressable>
        <Pressable
          onPress={commit}
          className={cn(
            "h-9 items-center justify-center rounded-lg px-4 active:bg-muted"
          )}
        >
          <Text className="text-sm font-semibold text-foreground">
            {t("common.close")}
          </Text>
        </Pressable>
      </View>
      <Pressable
        onPress={reset}
        accessibilityLabel={t("common.cancel")}
        className="absolute right-2 top-2 h-7 w-7 items-center justify-center rounded-full active:bg-muted"
      >
        <X size={14} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}
