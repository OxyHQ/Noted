import { Screen } from '@oxy.so/bloom/screen';
import { NotesContent } from '@/components/notes/notes-content';
import React from 'react';
import { EmptyState } from '@/components/empty-state';
import { LocalStoreError } from '@/components/local-store-boundary';
import { useRouter } from 'expo-router';
import { NotesHeader } from '@/components/notes/notes-header';
import { NotesSkeleton } from '@/components/notes/notes-skeleton';
import { NoteGrid } from '@/components/notes/note-grid';
import { useNotes } from '@/lib/hooks/use-notes';
import { useLabels } from '@/lib/hooks/use-labels';
import { useNotesUIStore } from '@/lib/stores/notes-ui-store';
import { useTranslation } from '@/hooks/useTranslation';
import type { LocalNote as Note } from '@/lib/db/notes-repo';

export default function ArchiveScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const viewMode = useNotesUIStore((s) => s.viewMode);

  const { data: notes, isLoading, error } = useNotes({ view: 'archived' });
  const { data: labels } = useLabels();

  const handlePressNote = React.useCallback((note: Note) => router.push(`/n/${note.id}`), [router]);
  const noop = React.useCallback(() => {}, []);

  const allNotes = notes ?? [];

  return (
    <Screen documentScroll header={<NotesHeader title={t('notes.archiveTitle')} />}>
      <NotesContent ready={!isLoading}>
        {error ? (
          <LocalStoreError />
        ) : isLoading ? (
          <NotesSkeleton />
        ) : allNotes.length === 0 ? (
          <EmptyState
            sticker="archive"
            title={t('notes.archiveEmptyTitle')}
            subtitle={t('notes.archiveEmptySubtitle')}
            action={{ label: t('emptyStates.backToNotes'), onPress: () => router.push('/(app)') }}
          />
        ) : (
          <NoteGrid
            notes={allNotes}
            allLabels={labels ?? []}
            viewMode={viewMode}
            onPressNote={handlePressNote}
            onLongPressNote={noop}
          />
        )}
      </NotesContent>
    </Screen>
  );
}
