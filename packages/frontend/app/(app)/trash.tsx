import { Screen } from "@oxy.so/bloom/screen";
import { NotesContent } from "@/components/notes/notes-content";
import React from "react";
import { useRouter } from "expo-router";
import { EmptyState } from "@/components/empty-state";
import { LocalStoreError } from "@/components/local-store-boundary";
import { View, ActivityIndicator } from "react-native";
import { RiArrowGoBackLine } from "@oxy.so/bloom/icons/RiArrowGoBackLine";
import { RiDeleteBinLine } from "@oxy.so/bloom/icons/RiDeleteBinLine";
import { Card } from "@oxy.so/bloom/card";
import { Text } from "@/components/ui/text";
import { Button } from "@oxy.so/bloom/button";
import { NotesHeader } from "@/components/notes/notes-header";
import { alert } from "@oxy.so/bloom/surfaces";
import { getNoteColorTint } from "@/lib/note-colors";
import { useNotes, useRestoreNote, useDeleteNote } from "@/lib/hooks/use-notes";
import { useTranslation } from "@/hooks/useTranslation";
import { useColorScheme } from "@/lib/useColorScheme";
import type { Note } from "@noted/shared-types";

export default function TrashScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, colorScheme } = useColorScheme();

  const { data: notes, isLoading, error } = useNotes({ view: "trashed" });
  const restoreNote = useRestoreNote();
  const deleteNote = useDeleteNote();

  const allNotes = notes ?? [];

  // Both confirmations are Bloom's: the dialog is drawn by the surface stack
  // the Oxy SDK already mounts at the root, so a screen asks the question and
  // holds no dialog state of its own.
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
    <Screen documentScroll header={<NotesHeader title={t("notes.trashTitle")} />}>

      <NotesContent ready={!isLoading}>
        {error ? <LocalStoreError /> : isLoading ? (
          <View className="items-center justify-center py-16">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : allNotes.length === 0 ? (
          <EmptyState sticker="trash" title={t("notes.trashEmptyTitle")}
            subtitle={t("notes.trashEmptySubtitle")}
            action={{ label: t("emptyStates.backToNotes"), onPress: () => router.push("/(app)") }} />
        ) : (
          <>
            <View className="mb-2 flex-row items-center justify-between px-1">
              <Text className="text-xs text-muted-foreground">
                {t("notes.trashHint")}
              </Text>
              <Button appearance="plain" tone="danger" size="sm" onPress={askEmptyTrash}>
                {t("notes.emptyTrash")}
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
      </NotesContent>
    </Screen>
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
    <Card
      style={{
        padding: 16,
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
        <Button appearance="plain" tone="neutral" icon={RiArrowGoBackLine}
          onPress={onRestore} accessibilityLabel={restoreLabel}>{restoreLabel}</Button>
        <Button appearance="plain" tone="danger" icon={RiDeleteBinLine}
          onPress={onDelete} accessibilityLabel={deleteLabel}>{deleteLabel}</Button>
      </View>
    </Card>
  );
}
