import React from "react";
import { View, Pressable, TextInput } from "react-native";
import { Square, CheckSquare, X, Plus } from "lucide-react-native";
import { useColorScheme } from "@/lib/useColorScheme";
import { useTranslation } from "@/hooks/useTranslation";
import { generateUUID } from "@/lib/utils";
import type { ChecklistItem } from "@noted/shared-types";

interface ChecklistEditorProps {
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
}

/** Editable checklist: toggle, edit text, remove, and add new items. */
export function ChecklistEditor({ items, onChange }: ChecklistEditorProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const [draft, setDraft] = React.useState("");
  const draftRef = React.useRef("");
  const inputRef = React.useRef<TextInput>(null);

  const toggle = (id: string) =>
    onChange(
      items.map((it) => (it.id === id ? { ...it, checked: !it.checked } : it))
    );

  const editText = (id: string, text: string) =>
    onChange(items.map((it) => (it.id === id ? { ...it, text } : it)));

  const remove = (id: string) => onChange(items.filter((it) => it.id !== id));

  const addItem = () => {
    const text = draftRef.current.trim();
    if (!text) return;
    draftRef.current = "";
    onChange([...items, { id: generateUUID(), text, checked: false }]);
    setDraft("");
  };

  return (
    <View className="gap-1">
      {items.map((item) => {
        const Box = item.checked ? CheckSquare : Square;
        return (
          <View key={item.id} className="flex-row items-center gap-2">
            <Pressable
              onPress={() => toggle(item.id)}
              accessibilityLabel={item.text}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: item.checked }}
              hitSlop={6}
            >
              <Box size={20} color={colors.mutedForeground} />
            </Pressable>
            <TextInput
              value={item.text}
              onChangeText={(text) => editText(item.id, text)}
              placeholderTextColor={colors.mutedForeground}
              className="flex-1 py-1 text-base text-foreground"
              style={item.checked ? { textDecorationLine: "line-through" } : undefined}
            />
            <Pressable onPress={() => remove(item.id)} hitSlop={6} accessibilityLabel={t("notes.removeItem")}>
              <X size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>
        );
      })}

      <View className="flex-row items-center gap-2">
        <Pressable onPress={() => { addItem(); inputRef.current?.focus(); }} accessibilityRole="button" accessibilityLabel={t("notes.addItem")} hitSlop={8}>
          <Plus size={20} color={colors.mutedForeground} />
        </Pressable>
        <TextInput
          ref={inputRef}
          value={draft}
          onChangeText={(text) => { draftRef.current = text; setDraft(text); }}
          onBlur={addItem}
          onSubmitEditing={addItem}
          blurOnSubmit={false}
          placeholder={t("notes.addItem")}
          placeholderTextColor={colors.mutedForeground}
          className="flex-1 py-1 text-base text-foreground"
          returnKeyType="done"
        />
      </View>
    </View>
  );
}
