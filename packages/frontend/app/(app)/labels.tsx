import { Screen } from "@oxy.so/bloom/screen";
import { NotesContent } from "@/components/notes/notes-content";
import React from "react";
import { EmptyState } from "@/components/empty-state";
import { LocalStoreError } from "@/components/local-store-boundary";
import { View, TextInput, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { TextField, TextFieldInput, TextFieldIcon } from "@oxy.so/bloom/text-field";
import { Button } from "@oxy.so/bloom/button";
import { ButtonGroup } from "@oxy.so/bloom/button-group";
import { RiPriceTag3Line } from "@oxy.so/bloom/icons/RiPriceTag3Line";
import { RiAddLine } from "@oxy.so/bloom/icons/RiAddLine";
import { RiCheckLine } from "@oxy.so/bloom/icons/RiCheckLine";
import { RiCloseLine } from "@oxy.so/bloom/icons/RiCloseLine";
import { RiDeleteBinLine } from "@oxy.so/bloom/icons/RiDeleteBinLine";
import { NotesHeader } from "@/components/notes/notes-header";
import { alert } from "@oxy.so/bloom/surfaces";
import {
  useLabels,
  useCreateLabel,
  useUpdateLabel,
  useDeleteLabel,
} from "@/lib/hooks/use-labels";
import { useNotesUIStore } from "@/lib/stores/notes-ui-store";
import { useTranslation } from "@/hooks/useTranslation";
import { useColorScheme } from "@/lib/useColorScheme";
import type { Label } from "@noted/shared-types";

export default function LabelsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const setActiveLabel = useNotesUIStore((s) => s.setActiveLabel);

  const { data: labels, isLoading, error } = useLabels();
  const createLabel = useCreateLabel();
  const updateLabel = useUpdateLabel();
  const deleteLabel = useDeleteLabel();

  const inputRef = React.useRef<TextInput>(null);
  const [draft, setDraft] = React.useState("");

  // Bloom draws the confirmation, so the screen keeps no dialog state.
  const askDeleteLabel = React.useCallback(
    (label: Label) => {
      alert(t("notes.deleteLabel"), t("notes.deleteLabelConfirm"), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: () => deleteLabel.mutate(label.id),
        },
      ]);
    },
    [deleteLabel, t]
  );

  const handleCreate = React.useCallback(() => {
    const name = draft.trim();
    if (!name || createLabel.isPending) return;
    createLabel.mutate({ name }, { onSuccess: () => setDraft(current => current.trim() === name ? "" : current) });
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
    <Screen documentScroll header={<NotesHeader title={t("notes.labelsTitle")} />}>

      <NotesContent ready={!isLoading}>
        <View className="flex-row items-center gap-2">
          <TextField style={{ flex: 1 }} disabled={createLabel.isPending}>
            <TextFieldIcon icon={RiAddLine} />
            <TextFieldInput
              inputRef={inputRef}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={handleCreate}
              label={t("notes.createLabelPlaceholder")}
              placeholder={t("notes.createLabelPlaceholder")}
              returnKeyType="done"
            />
          </TextField>
          <Button iconOnly icon={RiCheckLine} disabled={!draft.trim() || createLabel.isPending}
            loading={createLabel.isPending} onPress={handleCreate} accessibilityLabel={t("common.create")} />
        </View>

        {error ? <LocalStoreError /> : isLoading ? (
          <View className="items-center justify-center py-16">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : allLabels.length === 0 ? (
          <EmptyState sticker="labels" title={t("notes.noLabels")}
            subtitle={t("emptyStates.labelsSubtitle")}
            action={{ label: t("common.create"), onPress: () => inputRef.current?.focus() }} />
        ) : (
          <View className="gap-1">
            {allLabels.map((label) => (
              <LabelRow
                key={label.id}
                label={label}
                onOpen={() => handleOpenLabel(label)}
                onRename={(name) => updateLabel.mutate({ id: label.id, patch: { name } })}
                onDelete={() => askDeleteLabel(label)}
              />
            ))}
          </View>
        )}
      </NotesContent>
    </Screen>
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
      <View className="flex-row items-center gap-2 py-1">
        <TextField style={{ flex: 1 }}>
          <TextFieldIcon icon={RiPriceTag3Line} />
          <TextFieldInput value={value} onChangeText={setValue} onSubmitEditing={commit}
            autoFocus label={t("notes.labelsTitle")} returnKeyType="done" />
        </TextField>
        <ButtonGroup>
          <Button iconOnly icon={RiCheckLine} onPress={commit} accessibilityLabel={t("common.save")} />
          <Button iconOnly icon={RiCloseLine} onPress={() => { setValue(label.name); setEditing(false); }}
            accessibilityLabel={t("common.cancel")} />
        </ButtonGroup>
      </View>
    );
  }

  return (
    <View className="flex-row items-center gap-2 py-1">
      <Button appearance="plain" tone="neutral" icon={RiPriceTag3Line} onPress={onOpen}
        style={{ flex: 1, justifyContent: "flex-start" }}>{label.name}</Button>
      <ButtonGroup>
        <Button onPress={() => setEditing(true)}>{t("common.edit")}</Button>
        <Button iconOnly icon={RiDeleteBinLine} tone="danger" onPress={onDelete}
          accessibilityLabel={t("common.delete")} />
      </ButtonGroup>
    </View>
  );
}
