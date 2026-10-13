import React from 'react';
import { Pressable, ScrollView } from 'react-native';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import { validParents } from '@/lib/folders/tree';
import { useFolders, useMoveFolder } from '@/lib/hooks/use-folders';
import type { Folder } from '@noted/shared-types';

interface MoveFolderDialogProps {
  /** The folder being moved; the dialog is open while this is set. */
  folder: Folder | null;
  onClose: () => void;
}

/** Choose where a folder goes: the top level, or inside one of the folders it can fit in. */
export function MoveFolderDialog({ folder, onClose }: MoveFolderDialogProps) {
  const { t } = useTranslation();
  const { data: folders } = useFolders();
  const move = useMoveFolder();

  const targets = React.useMemo(
    () => (folder ? validParents(folders, folder.id) : []),
    [folder, folders],
  );

  const choose = (parentId: string | null) => {
    if (!folder || move.isPending) return;
    if ((folder.parentId ?? null) === parentId) {
      onClose();
      return;
    }
    move.mutate({ id: folder.id, parentId }, { onSuccess: onClose });
  };

  return (
    <Dialog open={folder !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('folders.moveTo', { name: folder?.name ?? '' })}</DialogTitle>
        </DialogHeader>
        <ScrollView className="max-h-72">
          <Target
            label={t('folders.topLevel')}
            selected={folder !== null && (folder.parentId ?? null) === null}
            onPress={() => choose(null)}
          />
          {targets.map(({ folder: target, depth, path }) => (
            <Target
              key={target.id}
              label={target.name}
              accessibilityLabel={path}
              depth={depth}
              selected={folder?.parentId === target.id}
              onPress={() => choose(target.id)}
            />
          ))}
        </ScrollView>
      </DialogContent>
    </Dialog>
  );
}

function Target({
  label,
  accessibilityLabel,
  depth = 0,
  selected,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  depth?: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      className="border-b border-border py-3"
      style={{ paddingLeft: depth * 16 }}
    >
      <Text className={selected ? 'text-base text-primary' : 'text-base text-foreground'}>
        {label}
      </Text>
    </Pressable>
  );
}
