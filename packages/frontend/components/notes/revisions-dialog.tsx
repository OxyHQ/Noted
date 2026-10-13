import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { toast } from '@oxy.so/bloom/toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Text } from '@/components/ui/text';
import { EmptyState } from '@/components/empty-state';
import { useTranslation } from '@/hooks/useTranslation';
import { fetchRevision, useNoteRevisions } from '@/lib/hooks/use-note-revisions';
import { revisionToPatch, type RevisionDetail } from '@/lib/notes/revisions';

interface RevisionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteId: string | undefined;
  /** Apply a version's text to the note, as an ordinary edit. */
  onRestore: (patch: ReturnType<typeof revisionToPatch>) => void;
}

/** Earlier versions of a note's text, with a restore for each. */
export function RevisionsDialog({ open, onOpenChange, noteId, onRestore }: RevisionsDialogProps) {
  const { t } = useTranslation();
  const revisions = useNoteRevisions(noteId, open);
  const [restoring, setRestoring] = React.useState<string | null>(null);

  const restore = async (revisionId: string) => {
    if (!noteId || restoring) return;
    setRestoring(revisionId);
    try {
      const revision: RevisionDetail = await fetchRevision(noteId, revisionId);
      onRestore(revisionToPatch(revision));
      toast.success(t('notes.historyRestored'));
      onOpenChange(false);
    } catch {
      toast.error(t('notes.historyFailed'));
    } finally {
      setRestoring(null);
    }
  };

  const items = revisions.data ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('notes.history')}</DialogTitle>
        </DialogHeader>
        <ScrollView className="max-h-80">
          {revisions.isError ? (
            <EmptyState sticker="loadError" title={t('notes.historyOffline')} />
          ) : items.length === 0 && !revisions.isLoading ? (
            <EmptyState sticker="notes" title={t('notes.historyEmpty')} />
          ) : (
            items.map((revision) => (
              <Pressable
                key={revision.id}
                accessibilityRole="button"
                accessibilityLabel={`${t('notes.historyRestore')} ${new Date(revision.createdAt).toLocaleString()}`}
                disabled={restoring !== null}
                onPress={() => void restore(revision.id)}
                className="gap-1 border-b border-border py-3"
              >
                <View className="flex-row items-center justify-between gap-2">
                  <Text className="text-sm font-medium text-foreground">
                    {new Date(revision.createdAt).toLocaleString()}
                  </Text>
                  <Text className="text-sm text-primary">{t('notes.historyRestore')}</Text>
                </View>
                <Text className="text-base text-foreground" numberOfLines={1}>
                  {revision.title || t('notes.untitledVersion')}
                </Text>
                {revision.preview ? (
                  <Text className="text-sm text-muted-foreground" numberOfLines={2}>
                    {revision.preview}
                  </Text>
                ) : null}
                {revision.checklistItems > 0 ? (
                  <Text className="text-xs text-muted-foreground">
                    {t('notes.historyItems', { count: revision.checklistItems })}
                  </Text>
                ) : null}
              </Pressable>
            ))
          )}
        </ScrollView>
      </DialogContent>
    </Dialog>
  );
}
