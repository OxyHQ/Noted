import React from "react";
import { View, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Archive as ArchiveIcon } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { NotesHeader } from "@/components/notes/notes-header";
import { NoteGrid } from "@/components/notes/note-grid";
import { useNotes } from "@/lib/hooks/use-notes";
import { useLabels } from "@/lib/hooks/use-labels";
import { useNotesUIStore } from "@/lib/stores/notes-ui-store";
import { useTranslation } from "@/hooks/useTranslation";
import { useColorScheme } from "@/lib/useColorScheme";
import type { Note } from "@/lib/types/note";

export default function ArchiveScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const viewMode = useNotesUIStore((s) => s.viewMode);

  const { data: notes, isLoading } = useNotes({ view: "archived" });
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
        {isLoading ? (
          <View className="items-center justify-center py-16">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : allNotes.length === 0 ? (
          <View className="items-center justify-center py-20">
            <ArchiveIcon size={48} color={colors.mutedForeground} strokeWidth={1.5} />
            <Text className="mt-4 text-base font-semibold text-foreground">
              {t("notes.archiveEmptyTitle")}
            </Text>
            <Text className="mt-1 text-center text-sm text-muted-foreground">
              {t("notes.archiveEmptySubtitle")}
            </Text>
          </View>
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
