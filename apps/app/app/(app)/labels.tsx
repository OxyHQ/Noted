import React from "react";
import { View, ScrollView, Pressable, TextInput, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Tag, Plus, Trash2, Check, X } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { NotesHeader } from "@/components/notes/notes-header";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  useLabels,
  useCreateLabel,
  useUpdateLabel,
  useDeleteLabel,
} from "@/lib/hooks/use-labels";
import { useNotesUIStore } from "@/lib/stores/notes-ui-store";
import { useTranslation } from "@/hooks/useTranslation";
import { useColorScheme } from "@/lib/useColorScheme";
import type { Label } from "@/lib/types/note";

export default function LabelsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const setActiveLabel = useNotesUIStore((s) => s.setActiveLabel);

  const { data: labels, isLoading } = useLabels();
  const createLabel = useCreateLabel();
  const updateLabel = useUpdateLabel();
  const deleteLabel = useDeleteLabel();

  const [draft, setDraft] = React.useState("");
  const [confirmTarget, setConfirmTarget] = React.useState<Label | null>(null);

  const handleCreate = React.useCallback(() => {
    const name = draft.trim();
    if (!name) return;
    createLabel.mutate({ name });
    setDraft("");
  }, [draft, createLabel]);

  const handleOpenLabel = React.useCallback(
    (label: Label) => {
      setActiveLabel(label.id);
      router.push("/(app)");
    },
    [setActiveLabel, router]
  );

  const allLabels = labels ?? [];

  return (
    <View className="flex-1 bg-background">
      <NotesHeader title={t("notes.labelsTitle")} />

      <ScrollView className="flex-1" contentContainerClassName="px-4 pb-24 pt-3">
        {/* Create row */}
        <View className="mb-3 flex-row items-center gap-2 rounded-xl border border-border px-3">
          <Plus size={18} color={colors.mutedForeground} />
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={handleCreate}
            placeholder={t("notes.createLabelPlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            className="h-11 flex-1 text-base text-foreground"
            returnKeyType="done"
          />
          {draft.trim().length > 0 && (
            <Pressable onPress={handleCreate} hitSlop={6} accessibilityLabel={t("common.create")}>
              <Check size={18} color={colors.primary} />
            </Pressable>
          )}
        </View>

        {isLoading ? (
          <View className="items-center justify-center py-16">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : allLabels.length === 0 ? (
          <View className="items-center justify-center py-16">
            <Tag size={40} color={colors.mutedForeground} strokeWidth={1.5} />
            <Text className="mt-3 text-sm text-muted-foreground">
              {t("notes.noLabels")}
            </Text>
          </View>
        ) : (
          <View className="gap-1">
            {allLabels.map((label) => (
              <LabelRow
                key={label.id}
                label={label}
                onOpen={() => handleOpenLabel(label)}
                onRename={(name) => updateLabel.mutate({ id: label.id, patch: { name } })}
                onDelete={() => setConfirmTarget(label)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <ConfirmationDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => !open && setConfirmTarget(null)}
        title={t("notes.deleteLabel")}
        description={t("notes.deleteLabelConfirm")}
        confirmText={t("common.delete")}
        confirmVariant="destructive"
        onConfirm={() => {
          if (confirmTarget) deleteLabel.mutate(confirmTarget.id);
          setConfirmTarget(null);
        }}
      />
    </View>
  );
}

function LabelRow({
  label,
  onOpen,
  onRename,
  onDelete,
}: {
  label: Label;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(label.name);

  const commit = () => {
    const name = value.trim();
    if (name && name !== label.name) onRename(name);
    else setValue(label.name);
    setEditing(false);
  };

  if (editing) {
    return (
      <View className="flex-row items-center gap-2 rounded-lg px-2 py-1">
        <Tag size={18} color={colors.mutedForeground} />
        <TextInput
          value={value}
          onChangeText={setValue}
          onSubmitEditing={commit}
          autoFocus
          className="h-10 flex-1 text-base text-foreground"
          placeholderTextColor={colors.mutedForeground}
          returnKeyType="done"
        />
        <Pressable onPress={commit} hitSlop={6} accessibilityLabel={t("common.save")}>
          <Check size={18} color={colors.primary} />
        </Pressable>
        <Pressable
          onPress={() => {
            setValue(label.name);
            setEditing(false);
          }}
          hitSlop={6}
          accessibilityLabel={t("common.cancel")}
        >
          <X size={18} color={colors.mutedForeground} />
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-row items-center gap-2 rounded-lg px-2 py-1">
      <Pressable
        onPress={onOpen}
        className="h-10 flex-1 flex-row items-center gap-3 active:opacity-70"
      >
        <Tag size={18} color={colors.mutedForeground} />
        <Text className="flex-1 text-base text-foreground">{label.name}</Text>
      </Pressable>
      <Pressable onPress={() => setEditing(true)} hitSlop={6} accessibilityLabel={t("common.edit")}>
        <Text className="text-sm text-muted-foreground">{t("common.edit")}</Text>
      </Pressable>
      <Pressable onPress={onDelete} hitSlop={6} accessibilityLabel={t("common.delete")}>
        <Trash2 size={16} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}
