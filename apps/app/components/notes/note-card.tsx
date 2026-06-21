import React from "react";
import { View, Pressable } from "react-native";
import { Image } from "expo-image";
import { Check, Pin, Square, CheckSquare, Bell } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { LabelChips } from "@/components/notes/label-chips";
import { getNoteColorTint } from "@/lib/note-colors";
import { useColorScheme } from "@/lib/useColorScheme";
import { cn } from "@/lib/utils";
import type { Label, Note } from "@/lib/types/note";

const CHECKLIST_PREVIEW = 6;

interface NoteCardProps {
  note: Note;
  allLabels: Label[];
  selected: boolean;
  selectionMode: boolean;
  onPress: (note: Note) => void;
  onLongPress: (note: Note) => void;
}

function formatReminder(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const NoteCard = React.memo(function NoteCard({
  note,
  allLabels,
  selected,
  selectionMode,
  onPress,
  onLongPress,
}: NoteCardProps) {
  const { colorScheme, colors } = useColorScheme();
  const tint = getNoteColorTint(note.color, colorScheme);

  const hasChecklist = note.checklist.length > 0;
  const shownChecklist = note.checklist.slice(0, CHECKLIST_PREVIEW);
  const remainingChecklist = note.checklist.length - shownChecklist.length;
  const firstImage = note.images[0];

  const isEmpty =
    !note.title &&
    !note.body &&
    !hasChecklist &&
    note.images.length === 0;

  return (
    <Pressable
      onPress={() => onPress(note)}
      onLongPress={() => onLongPress(note)}
      delayLongPress={250}
      className={cn(
        "overflow-hidden rounded-2xl border",
        selected ? "border-primary" : "border-border"
      )}
      style={{
        backgroundColor: tint ? tint.background : colors.card,
        borderColor: selected ? colors.primary : tint ? tint.border : colors.border,
        borderWidth: selected ? 2 : 1,
      }}
    >
      {/* Selection check overlay */}
      {selectionMode && (
        <View
          className="absolute right-2 top-2 z-10 h-6 w-6 items-center justify-center rounded-full"
          style={{ backgroundColor: selected ? colors.primary : colors.background }}
        >
          {selected && <Check size={14} color={colors.primaryForeground} />}
        </View>
      )}

      {/* Pin indicator */}
      {note.pinned && !selectionMode && (
        <View className="absolute right-2 top-2 z-10">
          <Pin size={14} color={colors.mutedForeground} fill={colors.mutedForeground} />
        </View>
      )}

      {firstImage && (
        <Image
          source={{ uri: firstImage.url }}
          style={{ width: "100%", aspectRatio: 4 / 3 }}
          contentFit="cover"
          transition={150}
        />
      )}

      <View className="p-3">
        {note.title ? (
          <Text
            className="text-sm font-semibold text-foreground"
            numberOfLines={2}
          >
            {note.title}
          </Text>
        ) : null}

        {!hasChecklist && note.body ? (
          <Text
            className={cn(
              "text-sm text-foreground/80",
              note.title ? "mt-1" : ""
            )}
            numberOfLines={8}
          >
            {note.body}
          </Text>
        ) : null}

        {hasChecklist ? (
          <View className={cn("gap-1", note.title ? "mt-2" : "")}>
            {shownChecklist.map((item) => {
              const Box = item.checked ? CheckSquare : Square;
              return (
                <View key={item.id} className="flex-row items-center gap-2">
                  <Box size={14} className="text-muted-foreground" />
                  <Text
                    className={cn(
                      "flex-1 text-sm",
                      item.checked
                        ? "text-muted-foreground line-through"
                        : "text-foreground/80"
                    )}
                    numberOfLines={1}
                  >
                    {item.text}
                  </Text>
                </View>
              );
            })}
            {remainingChecklist > 0 && (
              <Text className="text-xs text-muted-foreground">
                + {remainingChecklist} more
              </Text>
            )}
          </View>
        ) : null}

        {isEmpty && (
          <Text className="text-sm italic text-muted-foreground">Empty note</Text>
        )}

        <LabelChips labelIds={note.labels} allLabels={allLabels} max={3} />

        {note.reminderAt ? (
          <View className="mt-1.5 flex-row items-center gap-1 self-start rounded-full bg-foreground/10 px-2 py-0.5">
            <Bell size={10} className="text-muted-foreground" />
            <Text className="text-[11px] text-muted-foreground">
              {formatReminder(note.reminderAt)}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});
