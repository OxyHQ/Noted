import React from "react";
import { View, ScrollView, ActivityIndicator } from "react-native";
import Head from "expo-router/head";
import { useRouter } from "expo-router";
import { useOxy } from "@oxyhq/services";
import { NotebookPen } from "lucide-react-native";
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
import { useNotes, useCreateNote, useUpdateNote, useTrashNote } from "@/lib/hooks/use-notes";
import { useLabels } from "@/lib/hooks/use-labels";
import { useNotesUIStore } from "@/lib/stores/notes-ui-store";
import { useTranslation } from "@/hooks/useTranslation";
import { useColorScheme } from "@/lib/useColorScheme";
import type { Note, NoteColor, NoteListParams } from "@/lib/types/note";

export default function HomeScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const { isAuthenticated } = useOxy();

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

  const [colorDialogOpen, setColorDialogOpen] = React.useState(false);

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
      router.push(`/(app)/n/${note.id}`);
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
    (input: { title: string; body: string }) => {
      createNote.mutate(input);
    },
    [createNote]
  );

  const handleCreateChecklist = React.useCallback(() => {
    router.push("/(app)/n/new?mode=checklist");
  }, [router]);

  // Bulk actions operate on the selected ids.
  const selectedNotes = allNotes.filter((n) => selectedIds.has(n.id));

  const handleBulkPin = React.useCallback(() => {
    const shouldPin = selectedNotes.some((n) => !n.pinned);
    for (const note of selectedNotes) {
      updateNote.mutate({ id: note.id, patch: { pinned: shouldPin } });
    }
    clearSelection();
  }, [selectedNotes, updateNote, clearSelection]);

  const handleBulkColor = React.useCallback(
    (color: NoteColor) => {
      for (const note of selectedNotes) {
        updateNote.mutate({ id: note.id, patch: { color } });
      }
      setColorDialogOpen(false);
      clearSelection();
    },
    [selectedNotes, updateNote, clearSelection]
  );

  const handleBulkArchive = React.useCallback(() => {
    for (const note of selectedNotes) {
      updateNote.mutate({ id: note.id, patch: { archived: true } });
    }
    clearSelection();
  }, [selectedNotes, updateNote, clearSelection]);

  const handleBulkDelete = React.useCallback(() => {
    for (const note of selectedNotes) {
      trashNote.mutate(note.id);
    }
    clearSelection();
  }, [selectedNotes, trashNote, clearSelection]);

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
          onColor={() => setColorDialogOpen(true)}
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
          <View className="mb-4">
            <QuickCapture
              onCreate={handleCreate}
              onCreateChecklist={handleCreateChecklist}
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
                />
              </View>
            )}
          </>
        )}
      </ScrollView>

      <Dialog open={colorDialogOpen} onOpenChange={setColorDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("notes.pickColor")}</DialogTitle>
          </DialogHeader>
          <NoteColorPicker
            selected="default"
            onSelect={handleBulkColor}
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
      <NotebookPen size={48} color={colors.mutedForeground} strokeWidth={1.5} />
      <Text className="mt-4 text-base font-semibold text-foreground">{title}</Text>
      <Text className="mt-1 text-center text-sm text-muted-foreground">{subtitle}</Text>
    </View>
  );
}
