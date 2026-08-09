import React from "react";
import { View, ScrollView, ActivityIndicator, Pressable, useWindowDimensions } from "react-native";
import Head from "expo-router/head";
import { useRouter } from "expo-router";
import { useOxy } from "@oxyhq/services";
import { Lightbulb, Plus } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { NotesHeader } from "@/components/notes/notes-header";
import { QuickCapture } from "@/components/notes/quick-capture";
import { NoteGrid } from "@/components/notes/note-grid";
import { BulkActionBar } from "@/components/notes/bulk-action-bar";
import { NoteColorPicker } from "@/components/notes/note-color-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useNotes,
  useCreateNote,
  useUpdateNote,
  useTrashNote,
  useRestoreNote,
} from "@/lib/hooks/use-notes";
import { useLabels } from "@/lib/hooks/use-labels";
import { useNotesUIStore } from "@/lib/stores/notes-ui-store";
import { useUndoStore } from "@/lib/stores/undo-store";
import { useTranslation } from "@/hooks/useTranslation";
import { useColorScheme } from "@/lib/useColorScheme";
import type { Note, NoteColor, NoteListParams } from "@noted/shared-types";

export default function HomeScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const { isAuthenticated } = useOxy();
  const { width } = useWindowDimensions();
  const isLargeScreen = width >= 768;

  const activeLabel = useNotesUIStore((s) => s.activeLabel);
  const searchQuery = useNotesUIStore((s) => s.searchQuery);
  const viewMode = useNotesUIStore((s) => s.viewMode);
  const selectionMode = useNotesUIStore((s) => s.selectionMode);
  const selectedIds = useNotesUIStore((s) => s.selectedIds);
  const enterSelection = useNotesUIStore((s) => s.enterSelection);
  const toggleSelected = useNotesUIStore((s) => s.toggleSelected);
  const clearSelection = useNotesUIStore((s) => s.clearSelection);

  const listParams: NoteListParams = React.useMemo(
    () => ({
      view: "active",
      ...(activeLabel ? { label: activeLabel } : {}),
      ...(searchQuery.trim() ? { q: searchQuery.trim() } : {}),
    }),
    [activeLabel, searchQuery]
  );

  const { data: notes, isLoading } = useNotes(listParams);
  const { data: labels } = useLabels();
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const trashNote = useTrashNote();
  const restoreNote = useRestoreNote();

  // Color popover: in bulk mode it targets the selection; from a card's hover
  // palette it targets a single note id.
  const [colorTarget, setColorTarget] = React.useState<"selection" | string | null>(
    null
  );

  // The snackbar itself is drawn by the layout, stacked above the record
  // button; this screen only says what happened and how to reverse it.
  const showUndo = useUndoStore((s) => s.showUndo);
  const dismissUndo = useUndoStore((s) => s.dismissUndo);

  const allLabels = labels ?? [];
  const allNotes = notes ?? [];
  const pinned = allNotes.filter((n) => n.pinned);
  const others = allNotes.filter((n) => !n.pinned);

  const handlePressNote = React.useCallback(
    (note: Note) => {
      if (selectionMode) {
        toggleSelected(note.id);
        return;
      }
      router.push(`/n/${note.id}`);
    },
    [selectionMode, toggleSelected, router]
  );

  const handleLongPressNote = React.useCallback(
    (note: Note) => {
      enterSelection(note.id);
    },
    [enterSelection]
  );

  const handleCreate = React.useCallback(
    (input: { title: string; body: string; color?: NoteColor }) => {
      createNote.mutate(input);
    },
    [createNote]
  );

  const handleCreateChecklist = React.useCallback(() => {
    router.push("/n/new?mode=checklist");
  }, [router]);

  const handleCreateNote = React.useCallback(() => {
    router.push("/n/new");
  }, [router]);

  // ── Per-card hover actions (web) ───────────────────────────────────────────
  const handleCardTogglePin = React.useCallback(
    (note: Note) => {
      updateNote.mutate({ id: note.id, patch: { pinned: !note.pinned } });
    },
    [updateNote]
  );

  const handleCardToggleSelect = React.useCallback(
    (note: Note) => {
      if (selectionMode) {
        toggleSelected(note.id);
      } else {
        enterSelection(note.id);
      }
    },
    [selectionMode, toggleSelected, enterSelection]
  );

  const handleCardArchive = React.useCallback(
    (note: Note) => {
      updateNote.mutate({ id: note.id, patch: { archived: true } });
      showUndo(t("notes.archived"), () => {
        updateNote.mutate({ id: note.id, patch: { archived: false } });
        dismissUndo();
      });
    },
    [updateNote, showUndo, dismissUndo, t]
  );

  const handleCardDelete = React.useCallback(
    (note: Note) => {
      trashNote.mutate(note.id);
      showUndo(t("notes.trashed"), () => {
        restoreNote.mutate(note.id);
        dismissUndo();
      });
    },
    [trashNote, restoreNote, showUndo, dismissUndo, t]
  );

  const handleCardColor = React.useCallback((note: Note) => {
    setColorTarget(note.id);
  }, []);

  // Reminder and attach both route into the editor, where the full picker /
  // reminder flow lives (a quick inline picker on the card is out of scope).
  const handleCardOpenEditor = React.useCallback(
    (note: Note) => {
      router.push(`/n/${note.id}`);
    },
    [router]
  );

  // ── Bulk actions (selection mode) ──────────────────────────────────────────
  const selectedNotes = allNotes.filter((n) => selectedIds.has(n.id));

  const handleBulkPin = React.useCallback(() => {
    const shouldPin = selectedNotes.some((n) => !n.pinned);
    for (const note of selectedNotes) {
      updateNote.mutate({ id: note.id, patch: { pinned: shouldPin } });
    }
    clearSelection();
  }, [selectedNotes, updateNote, clearSelection]);

  const handleBulkArchive = React.useCallback(() => {
    const affected = selectedNotes.map((n) => n.id);
    for (const id of affected) {
      updateNote.mutate({ id, patch: { archived: true } });
    }
    clearSelection();
    showUndo(t("notes.archived"), () => {
      for (const id of affected) {
        updateNote.mutate({ id, patch: { archived: false } });
      }
      dismissUndo();
    });
  }, [selectedNotes, updateNote, clearSelection, showUndo, dismissUndo, t]);

  const handleBulkDelete = React.useCallback(() => {
    const affected = selectedNotes.map((n) => n.id);
    for (const id of affected) {
      trashNote.mutate(id);
    }
    clearSelection();
    showUndo(t("notes.trashed"), () => {
      for (const id of affected) {
        restoreNote.mutate(id);
      }
      dismissUndo();
    });
  }, [selectedNotes, trashNote, restoreNote, clearSelection, showUndo, dismissUndo, t]);

  // Color picker: applies to either the bulk selection or a single card.
  const handleColorSelect = React.useCallback(
    (color: NoteColor) => {
      if (colorTarget === "selection") {
        for (const note of selectedNotes) {
          updateNote.mutate({ id: note.id, patch: { color } });
        }
        clearSelection();
      } else if (colorTarget) {
        updateNote.mutate({ id: colorTarget, patch: { color } });
      }
      setColorTarget(null);
    },
    [colorTarget, selectedNotes, updateNote, clearSelection]
  );

  const colorSelected: NoteColor =
    colorTarget && colorTarget !== "selection"
      ? allNotes.find((n) => n.id === colorTarget)?.color ?? "default"
      : "default";

  return (
    <View className="flex-1 bg-background">
      <Head>
        <title>Noted</title>
        <meta name="description" content="Noted — capture notes, lists, and reminders." />
      </Head>

      {selectionMode ? (
        <BulkActionBar
          count={selectedIds.size}
          onClose={clearSelection}
          onPin={handleBulkPin}
          onColor={() => setColorTarget("selection")}
          onArchive={handleBulkArchive}
          onDelete={handleBulkDelete}
        />
      ) : (
        <NotesHeader title={t("notes.title")} searchable />
      )}

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-3 pb-24 pt-3"
        keyboardShouldPersistTaps="handled"
      >
        {!selectionMode && (
          <View className="mb-6">
            <QuickCapture
              onCreate={handleCreate}
              onCreateChecklist={handleCreateChecklist}
              onCreateAttachment={handleCreateNote}
            />
          </View>
        )}

        {isLoading ? (
          <View className="items-center justify-center py-16">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : !isAuthenticated ? (
          <EmptyState
            title={t("notes.signInTitle")}
            subtitle={t("notes.signInSubtitle")}
          />
        ) : allNotes.length === 0 ? (
          <EmptyState
            title={searchQuery ? t("notes.noResultsTitle") : t("notes.emptyTitle")}
            subtitle={searchQuery ? t("notes.noResultsSubtitle") : t("notes.emptySubtitle")}
          />
        ) : (
          <>
            {pinned.length > 0 && (
              <View className="mb-4">
                <SectionLabel>{t("notes.pinned")}</SectionLabel>
                <NoteGrid
                  notes={pinned}
                  allLabels={allLabels}
                  viewMode={viewMode}
                  onPressNote={handlePressNote}
                  onLongPressNote={handleLongPressNote}
                  onTogglePin={handleCardTogglePin}
                  onToggleSelect={handleCardToggleSelect}
                  onReminder={handleCardOpenEditor}
                  onColor={handleCardColor}
                  onArchive={handleCardArchive}
                  onAttach={handleCardOpenEditor}
                  onDelete={handleCardDelete}
                />
              </View>
            )}
            {others.length > 0 && (
              <View>
                {pinned.length > 0 && <SectionLabel>{t("notes.others")}</SectionLabel>}
                <NoteGrid
                  notes={others}
                  allLabels={allLabels}
                  viewMode={viewMode}
                  onPressNote={handlePressNote}
                  onLongPressNote={handleLongPressNote}
                  onTogglePin={handleCardTogglePin}
                  onToggleSelect={handleCardToggleSelect}
                  onReminder={handleCardOpenEditor}
                  onColor={handleCardColor}
                  onArchive={handleCardArchive}
                  onAttach={handleCardOpenEditor}
                  onDelete={handleCardDelete}
                />
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Mobile FAB */}
      {!isLargeScreen && !selectionMode && isAuthenticated && (
        <Pressable
          onPress={handleCreateNote}
          accessibilityLabel={t("notes.takeANote")}
          className="absolute bottom-6 right-6 h-14 w-14 items-center justify-center rounded-full bg-primary shadow-lg active:opacity-90"
        >
          <Plus size={26} color={colors.primaryForeground} />
        </Pressable>
      )}


      <Dialog
        open={colorTarget !== null}
        onOpenChange={(open) => !open && setColorTarget(null)}
      >
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>{t("notes.pickColor")}</DialogTitle>
          </DialogHeader>
          <NoteColorPicker
            selected={colorSelected}
            onSelect={handleColorSelect}
            scroll={false}
          />
        </DialogContent>
      </Dialog>
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="mb-2 ml-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </Text>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  const { colors } = useColorScheme();
  return (
    <View className="items-center justify-center py-20">
      <Lightbulb size={64} color={colors.mutedForeground} strokeWidth={1.5} />
      <Text className="mt-4 text-base font-semibold text-foreground">{title}</Text>
      <Text className="mt-1 text-center text-sm text-muted-foreground">{subtitle}</Text>
    </View>
  );
}
