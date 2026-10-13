import React from 'react';
import { ActivityIndicator, View, type TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { Folder as FolderGlyph } from 'lucide-react-native';
import { Button } from '@oxy.so/bloom/button';
import { Screen } from '@oxy.so/bloom/screen';
import { alert } from '@oxy.so/bloom/surfaces';
import { TextField, TextFieldIcon, TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiCheckLine } from '@oxy.so/bloom/icons/RiCheckLine';
import { RiCloseLine } from '@oxy.so/bloom/icons/RiCloseLine';
import { RiDeleteBinLine } from '@oxy.so/bloom/icons/RiDeleteBinLine';
import { EmptyState } from '@/components/empty-state';
import { LocalStoreError } from '@/components/local-store-boundary';
import { NotesContent } from '@/components/notes/notes-content';
import { NotesHeader } from '@/components/notes/notes-header';
import { useTranslation } from '@/hooks/useTranslation';
import { canHaveSubfolder, folderEntries, type FolderEntry } from '@/lib/folders/tree';
import {
  useCreateFolder,
  useDeleteFolder,
  useFolders,
  useRenameFolder,
} from '@/lib/hooks/use-folders';
import { useNotesUIStore } from '@/lib/stores/notes-ui-store';
import { useColorScheme } from '@/lib/useColorScheme';
import type { Folder } from '@noted/shared-types';

export default function FoldersScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const setActiveFolder = useNotesUIStore((s) => s.setActiveFolder);
  const setActiveLabel = useNotesUIStore((s) => s.setActiveLabel);

  const { data: folders, isLoading, error } = useFolders();
  const createFolder = useCreateFolder();
  const deleteFolder = useDeleteFolder();

  const inputRef = React.useRef<TextInput>(null);
  const [draft, setDraft] = React.useState('');
  // Where the next folder goes: inside this one, or at the top when null.
  const [parent, setParent] = React.useState<FolderEntry | null>(null);
  const entries = React.useMemo(() => folderEntries(folders), [folders]);

  const handleCreate = React.useCallback(() => {
    const name = draft.trim();
    if (!name || createFolder.isPending) return;
    createFolder.mutate(
      { name, parentId: parent?.folder.id ?? null },
      { onSuccess: () => setDraft('') },
    );
  }, [draft, parent, createFolder]);

  const askDelete = React.useCallback(
    (folder: Folder) => {
      alert(t('folders.delete'), t('folders.deleteConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => deleteFolder.mutate(folder.id),
        },
      ]);
    },
    [deleteFolder, t],
  );

  const open = React.useCallback(
    (folder: Folder) => {
      setActiveFolder(folder.id);
      setActiveLabel(null);
      router.push('/(app)');
    },
    [router, setActiveFolder, setActiveLabel],
  );

  return (
    <Screen documentScroll header={<NotesHeader title={t('folders.title')} />}>
      <NotesContent ready={!isLoading}>
        <View className="flex-row items-center gap-2">
          <TextField style={{ flex: 1 }} disabled={createFolder.isPending}>
            <TextFieldIcon icon={RiAddLine} />
            <TextFieldInput
              inputRef={inputRef}
              value={draft}
              onChangeText={(value) => {
                setDraft(value);
                createFolder.reset();
              }}
              onSubmitEditing={handleCreate}
              label={
                parent
                  ? t('folders.newIn', { parent: parent.path })
                  : t('folders.createPlaceholder')
              }
              placeholder={
                parent
                  ? t('folders.newIn', { parent: parent.path })
                  : t('folders.createPlaceholder')
              }
              returnKeyType="done"
            />
          </TextField>
          {parent && (
            <Button
              iconOnly
              appearance="plain"
              icon={RiCloseLine}
              onPress={() => setParent(null)}
              accessibilityLabel={t('folders.clearParent')}
            />
          )}
          <Button
            iconOnly
            icon={RiCheckLine}
            disabled={!draft.trim() || createFolder.isPending}
            loading={createFolder.isPending}
            onPress={handleCreate}
            accessibilityLabel={t('common.create')}
          />
        </View>

        {error ? (
          <LocalStoreError />
        ) : isLoading ? (
          <View className="items-center justify-center py-16">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : entries.length === 0 ? (
          <EmptyState
            sticker="archive"
            title={t('folders.empty')}
            action={{ label: t('common.create'), onPress: () => inputRef.current?.focus() }}
          />
        ) : (
          <View className="gap-1">
            {entries.map((entry) => (
              <FolderRow
                key={entry.folder.id}
                folder={entry.folder}
                depth={entry.depth}
                onOpen={() => open(entry.folder)}
                onDelete={() => askDelete(entry.folder)}
                onAddSubfolder={
                  canHaveSubfolder(entry)
                    ? () => {
                        setParent(entry);
                        inputRef.current?.focus();
                      }
                    : undefined
                }
              />
            ))}
          </View>
        )}
      </NotesContent>
    </Screen>
  );
}

function FolderRow({
  folder,
  depth,
  onOpen,
  onDelete,
  onAddSubfolder,
}: {
  folder: Folder;
  depth: number;
  onOpen: () => void;
  onDelete: () => void;
  /** Absent at the deepest level, where a folder cannot hold another. */
  onAddSubfolder?: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const rename = useRenameFolder();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(folder.name);

  const commit = () => {
    const name = value.trim();
    if (!name || rename.isPending) return;
    if (name === folder.name) {
      setEditing(false);
      return;
    }
    rename.mutate({ id: folder.id, name }, { onSuccess: () => setEditing(false) });
  };

  if (editing) {
    return (
      <View className="flex-row items-center gap-2 py-1" style={{ paddingLeft: depth * 16 }}>
        <TextField style={{ flex: 1 }} disabled={rename.isPending}>
          <TextFieldInput
            value={value}
            onChangeText={setValue}
            onSubmitEditing={commit}
            label={t('folders.rename')}
            placeholder={t('folders.rename')}
            returnKeyType="done"
            autoFocus
          />
        </TextField>
        <Button
          iconOnly
          icon={RiCheckLine}
          disabled={!value.trim() || rename.isPending}
          loading={rename.isPending}
          onPress={commit}
          accessibilityLabel={t('common.save')}
        />
        <Button
          iconOnly
          appearance="plain"
          icon={RiCloseLine}
          onPress={() => {
            setValue(folder.name);
            setEditing(false);
          }}
          accessibilityLabel={t('common.cancel')}
        />
      </View>
    );
  }

  return (
    <View className="flex-row items-center gap-2 py-1" style={{ paddingLeft: depth * 16 }}>
      <Button
        appearance="plain"
        tone="neutral"
        onPress={onOpen}
        style={{ flex: 1, justifyContent: 'flex-start' }}
      >
        <View className="flex-row items-center gap-2">
          <FolderGlyph size={18} color={colors.mutedForeground} />
          <Text>{folder.name}</Text>
        </View>
      </Button>
      {onAddSubfolder && (
        <Button appearance="plain" tone="neutral" onPress={onAddSubfolder}>
          {t('folders.addSubfolder')}
        </Button>
      )}
      <Button appearance="plain" tone="neutral" onPress={() => setEditing(true)}>
        {t('folders.rename')}
      </Button>
      <Button
        iconOnly
        appearance="plain"
        tone="neutral"
        icon={RiDeleteBinLine}
        onPress={onDelete}
        accessibilityLabel={t('common.delete')}
      />
    </View>
  );
}
