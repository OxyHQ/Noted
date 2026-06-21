import React from "react";
import { View, Pressable, Platform } from "react-native";
import Animated, { ZoomIn, ZoomOut } from "react-native-reanimated";
import { Image } from "expo-image";
import {
  Check,
  Pin,
  Square,
  CheckSquare,
  Bell,
  Palette,
  Paperclip,
  Archive,
  Trash2,
} from "lucide-react-native";
import { useOxy } from "@oxyhq/services";
import { Text } from "@/components/ui/text";
import { LabelChips } from "@/components/notes/label-chips";
import { getNoteColorTint } from "@/lib/note-colors";
import { useColorScheme } from "@/lib/useColorScheme";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { useFileMetadata } from "@/lib/hooks/use-file-metadata";
import { categorizeContentType } from "@/lib/attachments";
import { cn } from "@/lib/utils";
import type { Label, Note } from "@/lib/types/note";

const CHECKLIST_PREVIEW = 6;

const isWeb = Platform.OS === "web";

interface NoteCardProps {
  note: Note;
  allLabels: Label[];
  selected: boolean;
  selectionMode: boolean;
  onPress: (note: Note) => void;
  onLongPress: (note: Note) => void;
  /** Toggle pin without opening the editor (web hover affordance). */
  onTogglePin?: (note: Note) => void;
  /** Toggle multi-select without opening the editor (web hover affordance). */
  onToggleSelect?: (note: Note) => void;
  /** Open the reminder picker (web hover action row). */
  onReminder?: (note: Note) => void;
  /** Open the color popover (web hover action row). */
  onColor?: (note: Note) => void;
  /** Archive the note (web hover action row). */
  onArchive?: (note: Note) => void;
  /** Attach a file (web hover action row). */
  onAttach?: (note: Note) => void;
  /** Send the note to trash (web hover action row). */
  onDelete?: (note: Note) => void;
}

function formatReminder(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Small circular icon button used in the card's web hover affordances. */
function HoverIconButton({
  icon: Icon,
  label,
  color,
  onPress,
}: {
  icon: typeof Pin;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={(e) => {
        e.stopPropagation();
        onPress();
      }}
      accessibilityLabel={label}
      className="h-8 w-8 items-center justify-center rounded-full web:transition web:duration-150 web:hover:bg-foreground/10"
    >
      <Icon size={16} color={color} />
    </Pressable>
  );
}

export const NoteCard = React.memo(function NoteCard({
  note,
  allLabels,
  selected,
  selectionMode,
  onPress,
  onLongPress,
  onTogglePin,
  onToggleSelect,
  onReminder,
  onColor,
  onArchive,
  onAttach,
  onDelete,
}: NoteCardProps) {
  const { colorScheme, colors } = useColorScheme();
  const { oxyServices } = useOxy();
  const reduceMotion = useReducedMotion();
  const tint = getNoteColorTint(note.color, colorScheme);

  // Web-only hover state. The Pressable callbacks fire only on react-native-web;
  // on native they never fire, so `hovered` stays false and the hover
  // affordances stay hidden (long-press / tap is the native path).
  const [hovered, setHovered] = React.useState(false);
  const showHoverAffordances = isWeb && hovered;

  const hasChecklist = note.checklist.length > 0;
  const shownChecklist = note.checklist.slice(0, CHECKLIST_PREVIEW);
  const remainingChecklist = note.checklist.length - shownChecklist.length;

  // The card only resolves metadata for the FIRST attachment (bounded: one query
  // per card). If it's an image we show it as the top thumbnail; otherwise the
  // card shows a compact paperclip + count indicator. Full per-type chips live
  // in the editor/detail view.
  const firstAttachment = note.attachments[0];
  const { data: firstMeta } = useFileMetadata(firstAttachment ?? "");
  const firstIsImage =
    !!firstAttachment &&
    categorizeContentType(firstMeta?.contentType) === "image";
  const thumbnailId = firstIsImage ? firstAttachment : undefined;
  const attachmentCount = note.attachments.length;

  const isEmpty =
    !note.title && !note.body && !hasChecklist && attachmentCount === 0;

  // Top-right corner control: pin (web hover) / pin indicator (pinned) / nothing.
  const showPinControl =
    !selectionMode && (note.pinned || (showHoverAffordances && Boolean(onTogglePin)));
  // Top-left select control appears on hover or whenever selection mode is on.
  const showSelectControl =
    selectionMode || (showHoverAffordances && Boolean(onToggleSelect));

  const hasActionRow =
    Boolean(onReminder) ||
    Boolean(onColor) ||
    Boolean(onAttach) ||
    Boolean(onArchive) ||
    Boolean(onDelete);
  const showActionRow = showHoverAffordances && !selectionMode && hasActionRow;

  return (
    <Pressable
      onPress={() => onPress(note)}
      onLongPress={() => onLongPress(note)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      delayLongPress={250}
      className={cn(
        "overflow-hidden rounded-xl border web:transition web:duration-150",
        selected ? "border-primary" : "border-border",
        isWeb && !tint && !selected ? "web:hover:border-foreground/30" : "",
        isWeb ? "web:hover:shadow-lg" : ""
      )}
      style={{
        backgroundColor: tint ? tint.background : colors.card,
        borderColor: selected
          ? colors.primary
          : tint
            ? tint.border
            : colors.border,
        borderWidth: selected ? 2 : 1,
      }}
    >
      {/* Top-left multi-select control */}
      {showSelectControl && (
        <Animated.View
          entering={reduceMotion ? undefined : ZoomIn.duration(150)}
          exiting={reduceMotion ? undefined : ZoomOut.duration(120)}
          className="absolute left-2 top-2 z-10"
        >
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              onToggleSelect?.(note);
            }}
            accessibilityLabel="Select note"
            className="h-6 w-6 items-center justify-center rounded-full border web:transition"
            style={{
              backgroundColor: selected ? colors.primary : colors.background,
              borderColor: selected ? colors.primary : colors.border,
            }}
          >
            {selected && <Check size={14} color={colors.primaryForeground} />}
          </Pressable>
        </Animated.View>
      )}

      {/* Top-right pin control */}
      {showPinControl && (
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            onTogglePin?.(note);
          }}
          disabled={!onTogglePin}
          accessibilityLabel={note.pinned ? "Unpin note" : "Pin note"}
          className="absolute right-2 top-2 z-10 h-7 w-7 items-center justify-center rounded-full web:transition web:hover:bg-foreground/10"
        >
          <Pin
            size={15}
            color={colors.mutedForeground}
            fill={note.pinned ? colors.mutedForeground : "transparent"}
          />
        </Pressable>
      )}

      {thumbnailId && (
        <Image
          source={{ uri: oxyServices.getFileDownloadUrl(thumbnailId, "thumb") }}
          style={{ width: "100%", aspectRatio: 4 / 3 }}
          className="rounded-t-xl"
          contentFit="cover"
          transition={150}
        />
      )}

      <View className="p-4">
        {note.title ? (
          <Text
            className="text-sm font-medium text-foreground"
            numberOfLines={2}
          >
            {note.title}
          </Text>
        ) : null}

        {!hasChecklist && note.body ? (
          <Text
            className={cn("text-sm text-foreground/80", note.title ? "mt-1.5" : "")}
            numberOfLines={8}
          >
            {note.body}
          </Text>
        ) : null}

        {hasChecklist ? (
          <View className={cn("gap-1.5", note.title ? "mt-2.5" : "")}>
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

        <View className="mt-2 flex-row flex-wrap items-center gap-1.5">
          {note.reminderAt ? (
            <View className="flex-row items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5">
              <Bell size={10} className="text-muted-foreground" />
              <Text className="text-[11px] text-muted-foreground">
                {formatReminder(note.reminderAt)}
              </Text>
            </View>
          ) : null}

          {/* Compact attachment indicator. When the top thumbnail already shows
              an image we only surface the count if there are additional files. */}
          {attachmentCount > 0 && (!thumbnailId || attachmentCount > 1) ? (
            <View className="flex-row items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5">
              <Paperclip size={10} className="text-muted-foreground" />
              <Text className="text-[11px] text-muted-foreground">
                {attachmentCount}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Bottom hover action row (web only) */}
      {showActionRow && (
        <View className="flex-row items-center gap-0.5 px-2 pb-1.5">
          {onReminder && (
            <HoverIconButton
              icon={Bell}
              label="Reminder"
              color={colors.mutedForeground}
              onPress={() => onReminder(note)}
            />
          )}
          {onColor && (
            <HoverIconButton
              icon={Palette}
              label="Color"
              color={colors.mutedForeground}
              onPress={() => onColor(note)}
            />
          )}
          {onAttach && (
            <HoverIconButton
              icon={Paperclip}
              label="Attach file"
              color={colors.mutedForeground}
              onPress={() => onAttach(note)}
            />
          )}
          {onArchive && (
            <HoverIconButton
              icon={Archive}
              label="Archive"
              color={colors.mutedForeground}
              onPress={() => onArchive(note)}
            />
          )}
          {onDelete && (
            <HoverIconButton
              icon={Trash2}
              label="Delete"
              color={colors.mutedForeground}
              onPress={() => onDelete(note)}
            />
          )}
        </View>
      )}
    </Pressable>
  );
});
