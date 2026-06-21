import { View, Pressable, ScrollView } from "react-native";
import { Check } from "lucide-react-native";
import { NOTE_COLORS, type NoteColor } from "@/lib/types/note";
import { getNoteColorSwatch } from "@/lib/note-colors";
import { useColorScheme } from "@/lib/useColorScheme";
import { cn } from "@/lib/utils";

interface NoteColorPickerProps {
  selected: NoteColor;
  onSelect: (color: NoteColor) => void;
  /** Render horizontally scrollable (editor toolbar) vs wrapped (bulk bar). */
  scroll?: boolean;
}

/**
 * The Google-Keep color palette. The `default` swatch is the theme card color
 * (rendered as a bordered transparent dot); all others use their concrete tint.
 */
export function NoteColorPicker({ selected, onSelect, scroll = true }: NoteColorPickerProps) {
  const { colorScheme, colors } = useColorScheme();

  const dots = NOTE_COLORS.map((color) => {
    const swatch = getNoteColorSwatch(color, colorScheme);
    const isSelected = selected === color;
    return (
      <Pressable
        key={color}
        onPress={() => onSelect(color)}
        accessibilityLabel={`Color ${color}`}
        accessibilityState={{ selected: isSelected }}
        className={cn(
          "h-8 w-8 items-center justify-center rounded-full border-2",
          isSelected ? "border-foreground" : "border-border"
        )}
        style={{ backgroundColor: swatch ?? colors.card }}
      >
        {isSelected && <Check size={14} color={colors.foreground} />}
      </Pressable>
    );
  });

  if (scroll) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="flex-row gap-2 px-1 py-1"
      >
        {dots}
      </ScrollView>
    );
  }

  return <View className="flex-row flex-wrap gap-2">{dots}</View>;
}
