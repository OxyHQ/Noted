import React from "react";
import { View, Pressable, Platform } from "react-native";
import Animated, { ZoomIn, ZoomOut } from "react-native-reanimated";
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
import { Text } from "@/components/ui/text";
import { LabelChips } from "@/components/notes/label-chips";
import { AttachmentsRow } from "@/components/notes/attachments/AttachmentsRow";
import { getNoteColorTint } from "@/lib/note-colors";
import { useColorScheme } from "@/lib/useColorScheme";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";
import { toPreviewText } from "@/lib/markdown/blocks";
import type { Label, Note } from "@noted/shared-types";

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
  focusable,
}: {
  icon: typeof Pin;
  label: string;
  color: string;
  onPress: () => void;
  /** False while the row is invisible, so it is not a blind tab stop. */
  focusable: boolean;
}) {
  return (
    <Pressable
      onPress={(e) => {
        e.stopPropagation();
        onPress();
      }}
      accessibilityLabel={label}
      focusable={focusable}
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

  // Attachments render through the shared `AttachmentsRow` card variant (cheap:
  // thumbnails via `getFileDownloadUrl` + a generic count chip, no per-item
  // metadata queries). The card only needs to know whether any exist.
  const hasAttachments = (note.attachments?.length ?? 0) > 0;

  const isEmpty =
    !note.title && !note.body && !hasChecklist && !hasAttachments;

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
  // The row is MOUNTED whenever it could be used and only fades in on hover,
  // rather than mounting on hover. Mounting it changes the card's height, which
  // the grid's layout transition then animates, so every card the pointer
  // crossed would grow and shove its column around. Hover changing nothing but
  // opacity keeps the masonry still.
  const renderActionRow = isWeb && !selectionMode && hasActionRow;

  return (
    <Pressable
      onPress={() => onPress(note)}
      onLongPress={() => onLongPress(note)}
      // Raw pointer events, NOT `onHoverIn`/`onHoverOut`. Every RNW `Pressable`
      // passes `contain: true` to `useHover`, which makes a hovered Pressable
      // dispatch a BUBBLING `react-gui:hover:lock` event; every ancestor
      // Pressable listening for it calls its own `hoverEnd`. So hovering one of
      // the icons below — each its own Pressable — forcibly ended the card's
      // hover, which hid the icon, which un-hovered it, which restored the
      // card's hover, which showed the icon again: one flip per mouse movement,
      // and the click never landed. `onPointerEnter`/`onPointerLeave` are
      // forwarded straight to the DOM node and do not fire when the pointer
      // moves between an element and its own descendants.
      onPointerEnter={(e) => {
        // A tap on a touchscreen also produces a pointer enter; hover
        // affordances are for a real pointing device, as `useHover` had it.
        if (e.nativeEvent.pointerType !== "touch") setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
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

      {hasAttachments && (
        <View className="px-4 pt-4">
          <AttachmentsRow attachments={note.attachments ?? []} variant="card" />
        </View>
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
            {/* Flattened, because a card is a glance: `## Summary` in a preview
                is syntax where prose should be, and it costs a line to say
                nothing. The note itself keeps its Markdown. */}
            {toPreviewText(note.body)}
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

        {note.reminderAt ? (
          <View className="mt-2 flex-row flex-wrap items-center gap-1.5">
            <View className="flex-row items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5">
              <Bell size={10} className="text-muted-foreground" />
              <Text className="text-[11px] text-muted-foreground">
                {formatReminder(note.reminderAt)}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      {/* Bottom hover action row (web only) */}
      {renderActionRow && (
        <View
          style={{
            opacity: hovered ? 1 : 0,
            pointerEvents: hovered ? "auto" : "none",
          }}
          className="flex-row items-center gap-0.5 px-2 pb-1.5 web:transition web:duration-150"
        >
          {onReminder && (
            <HoverIconButton
              icon={Bell}
              label="Reminder"
              color={colors.mutedForeground}
              onPress={() => onReminder(note)}
              focusable={hovered}
            />
          )}
          {onColor && (
            <HoverIconButton
              icon={Palette}
              label="Color"
              color={colors.mutedForeground}
              onPress={() => onColor(note)}
              focusable={hovered}
            />
          )}
          {onAttach && (
            <HoverIconButton
              icon={Paperclip}
              label="Attach file"
              color={colors.mutedForeground}
              onPress={() => onAttach(note)}
              focusable={hovered}
            />
          )}
          {onArchive && (
            <HoverIconButton
              icon={Archive}
              label="Archive"
              color={colors.mutedForeground}
              onPress={() => onArchive(note)}
              focusable={hovered}
            />
          )}
          {onDelete && (
            <HoverIconButton
              icon={Trash2}
              label="Delete"
              color={colors.mutedForeground}
              onPress={() => onDelete(note)}
              focusable={hovered}
            />
          )}
        </View>
      )}
    </Pressable>
  );
});
