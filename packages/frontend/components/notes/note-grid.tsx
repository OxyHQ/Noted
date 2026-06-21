import { View, useWindowDimensions } from "react-native";
import Animated, {
  LinearTransition,
  FadeIn,
  FadeOut,
} from "react-native-reanimated";
import { NoteCard } from "@/components/notes/note-card";
import type { Label, Note } from "@noted/shared-types";
import type { ViewMode } from "@/lib/stores/notes-ui-store";
import { useNotesUIStore } from "@/lib/stores/notes-ui-store";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";

interface NoteGridProps {
  notes: Note[];
  allLabels: Label[];
  viewMode: ViewMode;
  onPressNote: (note: Note) => void;
  onLongPressNote: (note: Note) => void;
  /** Forwarded to each card's web hover affordances (optional). */
  onTogglePin?: (note: Note) => void;
  onToggleSelect?: (note: Note) => void;
  onReminder?: (note: Note) => void;
  onColor?: (note: Note) => void;
  onArchive?: (note: Note) => void;
  onAttach?: (note: Note) => void;
  onDelete?: (note: Note) => void;
}

/** Approximate column width in grid mode; drives the column count. */
const GRID_COLUMN_WIDTH = 252;

/** Reflow / enter / exit timings (ms) — Keep-style: quick and ease-out. */
const REFLOW_MS = 200;
const ENTER_MS = 180;
const EXIT_MS = 150;

/** Column count for grid mode, derived from available width (clamped 1..6). */
function columnsForWidth(width: number, viewMode: ViewMode): number {
  if (viewMode === "list") return 1;
  const cols = Math.floor(width / GRID_COLUMN_WIDTH);
  return Math.min(6, Math.max(1, cols));
}

/**
 * Rough per-card height estimate (in arbitrary units) used to balance the
 * shortest-column masonry packing. It does not need to be pixel-accurate — it
 * just has to rank cards by how tall they roughly are so the next card lands in
 * the column that currently has the least content.
 */
function estimateHeight(note: Note): number {
  let h = 56; // base padding + chrome
  if ((note.attachments?.length ?? 0) > 0) h += 48; // attachment thumbnail / chip row
  if (note.title) h += 24;
  if (note.checklist.length > 0) {
    h += Math.min(note.checklist.length, 6) * 22;
    if (note.checklist.length > 6) h += 18;
  } else if (note.body) {
    // ~36 chars per line, capped at the card's 8-line clamp.
    const lines = Math.min(8, Math.ceil(note.body.length / 36));
    h += lines * 20;
  }
  if (note.labels.length > 0) h += 26;
  if (note.reminderAt) h += 24;
  return h;
}

/**
 * Masonry layout with shortest-column packing: each note is placed into the
 * column whose running height estimate is currently smallest, so cards of
 * varying height pack tightly instead of leaving the big vertical gaps a naive
 * round-robin or fixed grid would.
 *
 * Cards (and their columns) are `Animated.View`s with a `LinearTransition`
 * layout animation, so adding / removing / pinning / recoloring / filtering
 * notes makes the cards smoothly slide to their new position (Keep-style FLIP)
 * instead of hard-jumping. Cards fade/translate in on enter and fade out on
 * exit (e.g. archive / trash). All of this is skipped under reduced motion.
 */
export function NoteGrid({
  notes,
  allLabels,
  viewMode,
  onPressNote,
  onLongPressNote,
  onTogglePin,
  onToggleSelect,
  onReminder,
  onColor,
  onArchive,
  onAttach,
  onDelete,
}: NoteGridProps) {
  const { width } = useWindowDimensions();
  const selectedIds = useNotesUIStore((s) => s.selectedIds);
  const selectionMode = useNotesUIStore((s) => s.selectionMode);
  const reduceMotion = useReducedMotion();

  const columnCount = columnsForWidth(width, viewMode);

  const layout = reduceMotion ? undefined : LinearTransition.duration(REFLOW_MS);
  const entering = reduceMotion ? undefined : FadeIn.duration(ENTER_MS);
  const exiting = reduceMotion ? undefined : FadeOut.duration(EXIT_MS);

  const columns: Note[][] = Array.from({ length: columnCount }, () => []);
  const heights = new Array<number>(columnCount).fill(0);
  for (const note of notes) {
    let shortest = 0;
    for (let i = 1; i < columnCount; i += 1) {
      if (heights[i] < heights[shortest]) shortest = i;
    }
    columns[shortest].push(note);
    heights[shortest] += estimateHeight(note);
  }

  const grid = (
    <View className="flex-row gap-3">
      {columns.map((column, colIndex) => (
        <Animated.View key={colIndex} layout={layout} className="flex-1 gap-3">
          {column.map((note) => (
            <Animated.View
              key={note.id}
              layout={layout}
              entering={entering}
              exiting={exiting}
            >
              <NoteCard
                note={note}
                allLabels={allLabels}
                selected={selectedIds.has(note.id)}
                selectionMode={selectionMode}
                onPress={onPressNote}
                onLongPress={onLongPressNote}
                onTogglePin={onTogglePin}
                onToggleSelect={onToggleSelect}
                onReminder={onReminder}
                onColor={onColor}
                onArchive={onArchive}
                onAttach={onAttach}
                onDelete={onDelete}
              />
            </Animated.View>
          ))}
        </Animated.View>
      ))}
    </View>
  );

  // List mode is a single centered, slightly wider column.
  if (viewMode === "list") {
    return <View className="w-full max-w-[640px] self-center">{grid}</View>;
  }

  return grid;
}
