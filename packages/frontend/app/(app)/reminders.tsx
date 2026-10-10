import { Screen } from "@oxy.so/bloom/screen";
import { NotesContent } from "@/components/notes/notes-content";
import React from "react";
import { EmptyState } from "@/components/empty-state";
import { LocalStoreError } from "@/components/local-store-boundary";
import { View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { NotesHeader } from "@/components/notes/notes-header";
import { NoteGrid } from "@/components/notes/note-grid";
import { useNotes } from "@/lib/hooks/use-notes";
import { useLabels } from "@/lib/hooks/use-labels";
import { useNotesUIStore } from "@/lib/stores/notes-ui-store";
import { useTranslation } from "@/hooks/useTranslation";
import { useColorScheme } from "@/lib/useColorScheme";
import type { Note } from "@noted/shared-types";

export default function RemindersScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const viewMode = useNotesUIStore((s) => s.viewMode);

  const { data: notes, isLoading, error } = useNotes({ view: "active" });
  const { data: labels } = useLabels();

  // Reminders = active notes that have a reminder set.
  const withReminders = React.useMemo(
    () => (notes ?? []).filter((n) => Boolean(n.reminderAt)),
    [notes]
  );

  const handlePressNote = React.useCallback(
    (note: Note) => router.push(`/n/${note.id}`),
    [router]
  );
  const noop = React.useCallback(() => {}, []);

  return (
    <Screen documentScroll header={<NotesHeader title={t("notes.remindersTitle")} />}>
      <NotesContent ready={!isLoading}>
        {error ? <LocalStoreError /> : isLoading ? (
          <View className="items-center justify-center py-16">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : withReminders.length === 0 ? (
          <EmptyState sticker="reminders" title={t("notes.remindersEmptyTitle")}
            subtitle={t("notes.remindersEmptySubtitle")}
            action={{ label: t("emptyStates.backToNotes"), onPress: () => router.push("/(app)") }} />
        ) : (
          <NoteGrid
            notes={withReminders}
            allLabels={labels ?? []}
            viewMode={viewMode}
            onPressNote={handlePressNote}
            onLongPressNote={noop}
          />
        )}
      </NotesContent>
    </Screen>
  );
}
