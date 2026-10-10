import React from 'react';
import { LabelChip } from './label-color';
import { GlyphButton } from '@oxy.so/bloom/button';
import { Checkbox } from '@oxy.so/bloom/checkbox';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { EmptyState } from '@/components/empty-state';
import { View, ScrollView } from 'react-native';
import { Plus } from 'lucide-react-native';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useLabels, useCreateLabel } from '@/lib/hooks/use-labels';

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
  const [draft, setDraft] = React.useState('');

  const assignedSet = new Set(assigned);
  const allLabels = labels ?? [];

  const handleCreate = async () => {
    const name = draft.trim();
    if (!name || createLabel.isPending) return;
    try {
      const created = await createLabel.mutateAsync({ name });
      setDraft('');
      onToggle(created.id);
    } catch {
      // The mutation reports the error; preserve the name so it can be retried.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('notes.labelNote')}</DialogTitle>
        </DialogHeader>

        <View className="gap-2">
          <TextFieldInput
            label={t('notes.createLabelPlaceholder')}
            editable={!createLabel.isPending}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={handleCreate}
            placeholder={t('notes.createLabelPlaceholder')}
            placeholderTextColor={colors.mutedForeground}
            className="h-10 flex-1 text-base text-foreground"
            returnKeyType="done"
          />
          {draft.trim().length > 0 && (
            <GlyphButton
              disabled={createLabel.isPending}
              onPress={handleCreate}
              accessibilityLabel={t('common.create')}
              color={colors.primary}
              size={36}
            >
              {(foreground) => <Plus size={20} color={foreground} />}
            </GlyphButton>
          )}
        </View>

        <ScrollView className="max-h-72">
          {allLabels.length === 0 ? (
            <EmptyState sticker="labels" title={t('notes.noLabels')} />
          ) : (
            allLabels.map((label) => {
              const isAssigned = assignedSet.has(label.id);
              return (
                <Checkbox
                  key={label.id}
                  checked={isAssigned}
                  label={label.name}
                  labelContent={<LabelChip label={label} />}
                  onCheckedChange={() => onToggle(label.id)}
                  style={{ paddingVertical: 10 }}
                />
              );
            })
          )}
        </ScrollView>
      </DialogContent>
    </Dialog>
  );
}
