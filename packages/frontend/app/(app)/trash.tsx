import React from "react";
import { View, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { Trash2, RotateCcw, X } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { NotesHeader } from "@/components/notes/notes-header";
import { alert } from "@oxyhq/bloom/dialog";
import { getNoteColorTint } from "@/lib/note-colors";
import { useNotes, useRestoreNote, useDeleteNote } from "@/lib/hooks/use-notes";
import { useTranslation } from "@/hooks/useTranslation";
import { useColorScheme } from "@/lib/useColorScheme";
import type { Note } from "@noted/shared-types";

export default function TrashScreen() {
  const { t } = useTranslation();
  const { colors, colorScheme } = useColorScheme();

  const { data: notes, isLoading } = useNotes({ view: "trashed" });
  const restoreNote = useRestoreNote();
  const deleteNote = useDeleteNote();

  const allNotes = notes ?? [];

  // Both confirmations are Bloom's: the dialog is drawn by the
  // `BloomDialogProvider` the Oxy SDK already mounts at the root, so a screen
  // asks the question and holds no dialog state of its own.
  const askEmptyTrash = React.useCallback(() => {
    alert(t("notes.emptyTrash"), t("notes.emptyTrashConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("notes.emptyTrash"),
        style: "destructive",
        onPress: () => {
          for (const note of allNotes) {
            deleteNote.mutate(note.id);
          }
        },
      },
    ]);
  }, [allNotes, deleteNote, t]);

  const askDeleteForever = React.useCallback(
    (id: string) => {
      alert(t("notes.deleteForever"), t("notes.deleteForeverConfirm"), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("notes.deleteForever"),
          style: "destructive",
          onPress: () => deleteNote.mutate(id),
        },
      ]);
    },
    [deleteNote, t]
  );

  return (
    <View className="flex-1 bg-background">
      <NotesHeader title={t("notes.trashTitle")} />

      <ScrollView className="flex-1" contentContainerClassName="px-3 pb-24 pt-3">
        {isLoading ? (
          <View className="items-center justify-center py-16">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : allNotes.length === 0 ? (
          <View className="items-center justify-center py-20">
            <Trash2 size={48} color={colors.mutedForeground} strokeWidth={1.5} />
            <Text className="mt-4 text-base font-semibold text-foreground">
              {t("notes.trashEmptyTitle")}
            </Text>
            <Text className="mt-1 text-center text-sm text-muted-foreground">
              {t("notes.trashEmptySubtitle")}
            </Text>
          </View>
        ) : (
          <>
            <View className="mb-2 flex-row items-center justify-between px-1">
              <Text className="text-xs text-muted-foreground">
                {t("notes.trashHint")}
              </Text>
              <Button variant="ghost" size="sm" onPress={askEmptyTrash}>
                <Text className="text-sm font-semibold text-destructive">
                  {t("notes.emptyTrash")}
                </Text>
              </Button>
            </View>

            <View className="gap-3">
              {allNotes.map((note) => (
                <TrashCard
                  key={note.id}
                  note={note}
                  scheme={colorScheme}
                  cardColor={colors.card}
                  borderColor={colors.border}
                  onRestore={() => restoreNote.mutate(note.id)}
                  onDelete={() => askDeleteForever(note.id)}
                  restoreLabel={t("notes.restore")}
                  deleteLabel={t("notes.deleteForever")}
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function TrashCard({
  note,
  scheme,
  cardColor,
  borderColor,
  onRestore,
  onDelete,
  restoreLabel,
  deleteLabel,
}: {
  note: Note;
  scheme: "light" | "dark";
  cardColor: string;
  borderColor: string;
  onRestore: () => void;
  onDelete: () => void;
  restoreLabel: string;
  deleteLabel: string;
}) {
  const tint = getNoteColorTint(note.color, scheme);
  const preview =
    note.body ||
    note.checklist.map((c) => c.text).join(", ") ||
    "";

  return (
    <View
      className="overflow-hidden rounded-2xl border p-3"
      style={{
        backgroundColor: tint ? tint.background : cardColor,
        borderColor: tint ? tint.border : borderColor,
      }}
    >
      {note.title ? (
        <Text className="text-sm font-semibold text-foreground" numberOfLines={2}>
          {note.title}
        </Text>
      ) : null}
      {preview ? (
        <Text className="mt-0.5 text-sm text-foreground/80" numberOfLines={3}>
          {preview}
        </Text>
      ) : null}
      <View className="mt-2 flex-row justify-end gap-1">
        <Pressable
          onPress={onRestore}
          accessibilityLabel={restoreLabel}
          className="h-9 flex-row items-center gap-1.5 rounded-full px-3 active:bg-foreground/10"
        >
          <RotateCcw size={16} className="text-muted-foreground" />
          <Text className="text-sm text-muted-foreground">{restoreLabel}</Text>
        </Pressable>
        <Pressable
          onPress={onDelete}
          accessibilityLabel={deleteLabel}
          className="h-9 flex-row items-center gap-1.5 rounded-full px-3 active:bg-foreground/10"
        >
          <X size={16} className="text-destructive" />
          <Text className="text-sm text-destructive">{deleteLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}
