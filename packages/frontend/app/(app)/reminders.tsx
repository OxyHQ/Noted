import React from "react";
import { View, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Bell } from "lucide-react-native";
import { Text } from "@/components/ui/text";
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

  const { data: notes, isLoading } = useNotes({ view: "active" });
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
    <View className="flex-1 bg-background">
      <NotesHeader title={t("notes.remindersTitle")} />
      <ScrollView className="flex-1" contentContainerClassName="px-3 pb-24 pt-3">
        {isLoading ? (
          <View className="items-center justify-center py-16">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : withReminders.length === 0 ? (
          <View className="items-center justify-center py-20">
            <Bell size={48} color={colors.mutedForeground} strokeWidth={1.5} />
            <Text className="mt-4 text-base font-semibold text-foreground">
              {t("notes.remindersEmptyTitle")}
            </Text>
            <Text className="mt-1 text-center text-sm text-muted-foreground">
              {t("notes.remindersEmptySubtitle")}
            </Text>
          </View>
        ) : (
          <NoteGrid
            notes={withReminders}
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
