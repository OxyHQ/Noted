import React from "react";
import { View, Pressable, TextInput, ScrollView } from "react-native";
import { Check, Plus, Tag } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useColorScheme } from "@/lib/useColorScheme";
import { useTranslation } from "@/hooks/useTranslation";
import { useLabels, useCreateLabel } from "@/lib/hooks/use-labels";

interface LabelAssignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Currently assigned label ids. */
  assigned: string[];
  /** Toggle a label on/off for the note. */
  onToggle: (labelId: string) => void;
}

/** Assign existing labels to a note and create new labels inline. */
export function LabelAssignDialog({
  open,
  onOpenChange,
  assigned,
  onToggle,
}: LabelAssignDialogProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const { data: labels } = useLabels();
  const createLabel = useCreateLabel();
  const [draft, setDraft] = React.useState("");

  const assignedSet = new Set(assigned);
  const allLabels = labels ?? [];

  const handleCreate = async () => {
    const name = draft.trim();
    if (!name) return;
    const created = await createLabel.mutateAsync({ name });
    setDraft("");
    onToggle(created.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("notes.labelNote")}</DialogTitle>
        </DialogHeader>

        <View className="flex-row items-center gap-2 rounded-lg border border-border px-3">
          <Tag size={16} color={colors.mutedForeground} />
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={handleCreate}
            placeholder={t("notes.createLabelPlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            className="h-10 flex-1 text-base text-foreground"
            returnKeyType="done"
          />
          {draft.trim().length > 0 && (
            <Pressable onPress={handleCreate} hitSlop={6} accessibilityLabel={t("common.create")}>
              <Plus size={18} color={colors.primary} />
            </Pressable>
          )}
        </View>

        <ScrollView className="max-h-72">
          {allLabels.length === 0 ? (
            <Text className="py-4 text-center text-sm text-muted-foreground">
              {t("notes.noLabels")}
            </Text>
          ) : (
            allLabels.map((label) => {
              const isAssigned = assignedSet.has(label.id);
              return (
                <Pressable
                  key={label.id}
                  onPress={() => onToggle(label.id)}
                  className="flex-row items-center gap-3 rounded-lg px-2 py-2.5 active:bg-muted"
                >
                  <Tag size={16} color={colors.mutedForeground} />
                  <Text className="flex-1 text-base text-foreground">{label.name}</Text>
                  {isAssigned && <Check size={18} color={colors.primary} />}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </DialogContent>
    </Dialog>
  );
}
