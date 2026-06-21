import { View, useWindowDimensions } from "react-native";
import { NoteCard } from "@/components/notes/note-card";
import type { Label, Note } from "@/lib/types/note";
import type { ViewMode } from "@/lib/stores/notes-ui-store";
import { useNotesUIStore } from "@/lib/stores/notes-ui-store";

interface NoteGridProps {
  notes: Note[];
  allLabels: Label[];
  viewMode: ViewMode;
  onPressNote: (note: Note) => void;
  onLongPressNote: (note: Note) => void;
}

/** Column count for grid mode, derived from available width. */
function columnsForWidth(width: number, viewMode: ViewMode): number {
  if (viewMode === "list") return 1;
  if (width >= 1100) return 4;
  if (width >= 820) return 3;
  if (width >= 520) return 2;
  return 2; // phones still show two narrow columns, Keep-style
}

/**
 * Masonry layout: distribute notes round-robin across columns so cards of
 * varying height pack without leaving the big vertical gaps a fixed grid would.
 * Round-robin keeps the original order readable top-to-bottom-ish while still
 * balancing column count.
 */
export function NoteGrid({
  notes,
  allLabels,
  viewMode,
  onPressNote,
  onLongPressNote,
}: NoteGridProps) {
  const { width } = useWindowDimensions();
  const selectedIds = useNotesUIStore((s) => s.selectedIds);
  const selectionMode = useNotesUIStore((s) => s.selectionMode);

  const columnCount = columnsForWidth(width, viewMode);

  const columns: Note[][] = Array.from({ length: columnCount }, () => []);
  notes.forEach((note, index) => {
    columns[index % columnCount].push(note);
  });

  return (
    <View className="flex-row gap-3">
      {columns.map((column, colIndex) => (
        <View key={colIndex} className="flex-1 gap-3">
          {column.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              allLabels={allLabels}
              selected={selectedIds.has(note.id)}
              selectionMode={selectionMode}
              onPress={onPressNote}
              onLongPress={onLongPressNote}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
