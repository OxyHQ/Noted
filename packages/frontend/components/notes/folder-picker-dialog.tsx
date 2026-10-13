import { Check, Folder as FolderGlyph, Plus } from 'lucide-react-native';
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { GlyphButton } from '@oxy.so/bloom/button';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import { useCreateFolder, useFolders } from '@/lib/hooks/use-folders';
import { useColorScheme } from '@/lib/useColorScheme';

interface FolderPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The folder the note is in now, or null. */
  current: string | null;
  /** Called with the chosen folder id, or null to take the note out of its folder. */
  onPick: (folderId: string | null) => void;
}

/** File a note in a folder, or create one on the spot. */
export function FolderPickerDialog({
  open,
  onOpenChange,
  current,
  onPick,
}: FolderPickerDialogProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const { data: folders } = useFolders();
  const createFolder = useCreateFolder();
  const [draft, setDraft] = React.useState('');

  const choose = (folderId: string | null) => {
    onPick(folderId);
    onOpenChange(false);
  };

  const create = async () => {
    const name = draft.trim();
    if (!name || createFolder.isPending) return;
    try {
      const folder = await createFolder.mutateAsync({ name });
      setDraft('');
      choose(folder.id);
    } catch {
      // The mutation reports the error; the name stays so it can be retried.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('folders.pick')}</DialogTitle>
        </DialogHeader>

        <View className="flex-row items-center gap-2">
          <View className="flex-1">
            <TextFieldInput
              label={t('folders.createPlaceholder')}
              editable={!createFolder.isPending}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={create}
              placeholder={t('folders.createPlaceholder')}
              placeholderTextColor={colors.mutedForeground}
              className="h-10 text-base text-foreground"
              returnKeyType="done"
            />
          </View>
          {draft.trim().length > 0 && (
            <GlyphButton
              disabled={createFolder.isPending}
              onPress={create}
              accessibilityLabel={t('common.create')}
              color={colors.primary}
              size={36}
            >
              {(foreground) => <Plus size={20} color={foreground} />}
            </GlyphButton>
          )}
        </View>

        <ScrollView className="max-h-72">
          <FolderOption
            label={t('folders.none')}
            selected={current === null}
            onPress={() => choose(null)}
          />
          {folders.map((folder) => (
            <FolderOption
              key={folder.id}
              label={folder.name}
              selected={current === folder.id}
              onPress={() => choose(folder.id)}
              icon
            />
          ))}
        </ScrollView>
      </DialogContent>
    </Dialog>
  );
}

function FolderOption({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: boolean;
}) {
  const { colors } = useColorScheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      className="flex-row items-center gap-2 border-b border-border py-3"
    >
      {icon ? <FolderGlyph size={18} color={colors.mutedForeground} /> : null}
      <Text className="flex-1 text-base text-foreground" numberOfLines={1}>
        {label}
      </Text>
      {selected ? <Check size={18} color={colors.primary} /> : null}
    </Pressable>
  );
}
