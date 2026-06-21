import React from "react";
import { View, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { Trash2, RotateCcw, X } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { NotesHeader } from "@/components/notes/notes-header";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
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

  const [confirmTarget, setConfirmTarget] = React.useState<string | null>(null);
  const [emptyOpen, setEmptyOpen] = React.useState(false);

  const allNotes = notes ?? [];

  const handleEmptyTrash = React.useCallback(async () => {
    for (const note of allNotes) {
      deleteNote.mutate(note.id);
    }
    setEmptyOpen(false);
  }, [allNotes, deleteNote]);

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
              <Button variant="ghost" size="sm" onPress={() => setEmptyOpen(true)}>
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
                  onDelete={() => setConfirmTarget(note.id)}
                  restoreLabel={t("notes.restore")}
                  deleteLabel={t("notes.deleteForever")}
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <ConfirmationDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => !open && setConfirmTarget(null)}
        title={t("notes.deleteForever")}
        description={t("notes.deleteForeverConfirm")}
        confirmText={t("notes.deleteForever")}
        confirmVariant="destructive"
        onConfirm={() => {
          if (confirmTarget) deleteNote.mutate(confirmTarget);
          setConfirmTarget(null);
        }}
      />

      <ConfirmationDialog
        open={emptyOpen}
        onOpenChange={setEmptyOpen}
        title={t("notes.emptyTrash")}
        description={t("notes.emptyTrashConfirm")}
        confirmText={t("notes.emptyTrash")}
        confirmVariant="destructive"
        onConfirm={handleEmptyTrash}
      />
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
