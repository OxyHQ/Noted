import React from "react";
import { EmptyState } from "@/components/empty-state";
import { LocalStoreError } from "@/components/local-store-boundary";
import { View, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { NotesHeader } from "@/components/notes/notes-header";
import { NoteGrid } from "@/components/notes/note-grid";
import { useNotes } from "@/lib/hooks/use-notes";
import { useLabels } from "@/lib/hooks/use-labels";
import { useNotesUIStore } from "@/lib/stores/notes-ui-store";
import { useTranslation } from "@/hooks/useTranslation";
import { useColorScheme } from "@/lib/useColorScheme";
import type { Note } from "@noted/shared-types";

export default function ArchiveScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const viewMode = useNotesUIStore((s) => s.viewMode);

  const { data: notes, isLoading, error } = useNotes({ view: "archived" });
  const { data: labels } = useLabels();

  const handlePressNote = React.useCallback(
    (note: Note) => router.push(`/n/${note.id}`),
    [router]
  );
  const noop = React.useCallback(() => {}, []);

  const allNotes = notes ?? [];

  return (
    <View className="flex-1 bg-background">
      <NotesHeader title={t("notes.archiveTitle")} />
      <ScrollView className="flex-1" contentContainerClassName="px-3 pb-24 pt-3">
        {error ? <LocalStoreError /> : isLoading ? (
          <View className="items-center justify-center py-16">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : allNotes.length === 0 ? (
          <EmptyState sticker="archive" title={t("notes.archiveEmptyTitle")}
            subtitle={t("notes.archiveEmptySubtitle")}
            action={{ label: t("emptyStates.backToNotes"), onPress: () => router.push("/(app)") }} />
        ) : (
          <NoteGrid
            notes={allNotes}
            allLabels={labels ?? []}
            viewMode={viewMode}
            onPressNote={handlePressNote}
            onLongPressNote={noop}
          />
        )}
      </ScrollView>
    </View>
  );
}
