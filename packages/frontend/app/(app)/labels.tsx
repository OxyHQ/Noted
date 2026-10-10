import { LabelChip, LabelColorPicker } from "@/components/notes/label-color";
import { Text } from "@oxy.so/bloom/typography";
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
import type { Label, NoteColor } from "@noted/shared-types";

export default function LabelsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const setActiveLabel = useNotesUIStore((s) => s.setActiveLabel);

  const { data: labels, isLoading, error } = useLabels();
  const createLabel = useCreateLabel();
  const deleteLabel = useDeleteLabel();

  const inputRef = React.useRef<TextInput>(null);
  const [draft, setDraft] = React.useState("");
  const [draftColor, setDraftColor] = React.useState<NoteColor | null>(null);
  const [showColors, setShowColors] = React.useState(false);

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
    createLabel.mutate({ name, color: draftColor }, { onSuccess: () => {
      setDraft(""); setDraftColor(null); setShowColors(false);
    } });
  }, [draft, draftColor, createLabel]);

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
        <View className="gap-3">
        <View className="flex-row items-center gap-2">
          <TextField style={{ flex: 1 }} disabled={createLabel.isPending}>
            <TextFieldIcon icon={RiAddLine} />
            <TextFieldInput
              inputRef={inputRef}
              value={draft}
              onChangeText={value => { setDraft(value); createLabel.reset(); }}
              onSubmitEditing={handleCreate}
              label={t("notes.createLabelPlaceholder")}
              placeholder={t("notes.createLabelPlaceholder")}
              returnKeyType="done"
            />
          </TextField>
          <Button appearance="subtle" tone="neutral" pressed={showColors}
            disabled={createLabel.isPending} onPress={() => setShowColors(current => !current)}
            accessibilityLabel={t("notes.labelColor")} icon={RiPriceTag3Line} iconOnly />
          <Button iconOnly icon={RiCheckLine} disabled={!draft.trim() || createLabel.isPending}
            loading={createLabel.isPending} onPress={handleCreate} accessibilityLabel={t("common.create")} />
        </View>
        {showColors && <LabelColorPicker value={draftColor} disabled={createLabel.isPending}
          onChange={color => { setDraftColor(color); createLabel.reset(); }} />}
        {Boolean(draft.trim() && draftColor) && <LabelChip label={{ name: draft.trim(), color: draftColor }} />}
        {createLabel.isError && <View className="flex-row items-center gap-2" accessibilityRole="alert">
          <Text style={{ flex: 1 }}>{t("notes.labelSaveFailed")}</Text>
          <Button appearance="plain" onPress={handleCreate}>{t("common.retry")}</Button>
        </View>}
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
                onDelete={() => askDeleteLabel(label)}
              />
            ))}
          </View>
        )}
      </NotesContent>
    </Screen>
  );
}

function LabelRow({ label, onOpen, onDelete }: {
  label: Label;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const updateLabel = useUpdateLabel();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(label.name);
  const [color, setColor] = React.useState<NoteColor | null>(label.color);
  const base = React.useRef(label);

  const startEditing = () => {
    base.current = label;
    setValue(label.name); setColor(label.color); updateLabel.reset(); setEditing(true);
  };
  const commit = () => {
    const name = value.trim();
    if (!name || updateLabel.isPending) return;
    // Send only fields edited from the starting snapshot. A color-only edit
    // must not overwrite another device's rename while this form was open.
    const patch: { name?: string; color?: NoteColor | null } = {};
    if (name !== base.current.name) patch.name = name;
    const selected = color === 'default' ? null : color;
    const original = base.current.color === 'default' ? null : base.current.color;
    if (selected !== original) patch.color = selected;
    if (!Object.keys(patch).length) { setEditing(false); return; }
    updateLabel.mutate({ id: label.id, patch }, { onSuccess: () => setEditing(false) });
  };

  if (editing) return <View className="gap-3 py-3" testID={`label-editor-${label.id}`}>
    <View className="flex-row items-center gap-2">
      <TextField style={{ flex: 1 }} disabled={updateLabel.isPending}>
        <TextFieldIcon icon={RiPriceTag3Line} />
        <TextFieldInput value={value} onChangeText={name => { setValue(name); updateLabel.reset(); }} onSubmitEditing={commit}
          autoFocus label={t("common.name")} returnKeyType="done" />
      </TextField>
      <ButtonGroup>
        <Button iconOnly icon={RiCheckLine} onPress={commit} disabled={!value.trim() || updateLabel.isPending}
          loading={updateLabel.isPending} accessibilityLabel={t("common.save")} />
        <Button iconOnly icon={RiCloseLine} disabled={updateLabel.isPending} onPress={() => setEditing(false)}
          accessibilityLabel={t("common.cancel")} />
      </ButtonGroup>
    </View>
    <LabelColorPicker value={color} disabled={updateLabel.isPending}
      onChange={next => { setColor(next); updateLabel.reset(); }} />
    {updateLabel.isError && <View className="flex-row items-center gap-2" accessibilityRole="alert">
      <Text style={{ flex: 1 }}>{t("notes.labelSaveFailed")}</Text>
      <Button appearance="plain" onPress={commit}>{t("common.retry")}</Button>
    </View>}
  </View>;

  return <View className="flex-row items-center gap-2 py-1" testID={`label-row-${label.id}`}>
    <View style={{ flex: 1, alignItems: 'flex-start' }}><LabelChip label={label} onPress={onOpen} /></View>
    <ButtonGroup>
      <Button onPress={startEditing} accessibilityLabel={`${t("common.edit")} ${label.name}`}>{t("common.edit")}</Button>
      <Button iconOnly icon={RiDeleteBinLine} tone="danger" onPress={onDelete}
        accessibilityLabel={`${t("common.delete")} ${label.name}`} />
    </ButtonGroup>
  </View>;
}
