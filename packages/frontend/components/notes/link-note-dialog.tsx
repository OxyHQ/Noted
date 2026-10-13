import React from 'react';
import { Pressable, ScrollView } from 'react-native';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Text } from '@/components/ui/text';
import { EmptyState } from '@/components/empty-state';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import { useNotes } from '@/lib/hooks/use-notes';

interface LinkNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The note being edited; it cannot link to itself. */
  currentId: string;
  /** Called with the chosen note's title. */
  onPick: (title: string) => void;
}

/** Search the user's notes and pick one to link to. */
export function LinkNoteDialog({ open, onOpenChange, currentId, onPick }: LinkNoteDialogProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const [query, setQuery] = React.useState('');
  const { data } = useNotes({ view: 'active', q: query });
  // A link names its target by title, so an untitled note cannot be linked.
  const candidates = data.filter((note) => note.id !== currentId && note.title.trim() !== '');

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery('');
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('notes.linkNote')}</DialogTitle>
        </DialogHeader>
        <TextFieldInput
          label={t('notes.linkSearchPlaceholder')}
          value={query}
          onChangeText={setQuery}
          placeholder={t('notes.linkSearchPlaceholder')}
          placeholderTextColor={colors.mutedForeground}
          className="h-10 text-base text-foreground"
          autoFocus
        />
        <ScrollView className="max-h-72">
          {candidates.length === 0 ? (
            <EmptyState sticker="search" title={t('notes.linkNoResults')} />
          ) : (
            candidates.map((note) => (
              <Pressable
                key={note.id}
                accessibilityRole="button"
                accessibilityLabel={note.title}
                onPress={() => {
                  onPick(note.title);
                  setQuery('');
                  onOpenChange(false);
                }}
                className="border-b border-border py-3"
              >
                <Text className="text-base text-foreground" numberOfLines={1}>
                  {note.title}
                </Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      </DialogContent>
    </Dialog>
  );
}
