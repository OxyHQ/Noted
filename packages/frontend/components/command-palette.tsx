import { useRouter } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';
import { Command } from '@oxy.so/bloom/command';
import { useNotedSettings } from '@/components/settings/settings-provider';
import { useTranslation } from '@/hooks/useTranslation';
import { buildPaletteEntries, type PaletteCommand } from '@/lib/command-palette';
import { useNotes } from '@/lib/hooks/use-notes';
import { useNotesUIStore } from '@/lib/stores/notes-ui-store';

/**
 * Search notes and run commands from the keyboard (⌘K / Ctrl+K).
 *
 * Opened by a keyboard shortcut, so it matters on the web and with a hardware
 * keyboard; a phone has no way to summon it and does not need one, since its
 * screens are a tap away.
 */
export function CommandPalette() {
  const { t } = useTranslation();
  const router = useRouter();
  const settings = useNotedSettings();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const toggleViewMode = useNotesUIStore((state) => state.toggleViewMode);

  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const close = React.useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  // The database does the matching for notes; nothing is read until typing starts.
  const search = query.trim();
  const { data: found } = useNotes(search ? { view: 'active', q: search } : { view: 'active' });

  const go = React.useCallback((href: string) => () => router.navigate(href as never), [router]);

  const commands = React.useMemo<PaletteCommand[]>(
    () => [
      {
        id: 'new-note',
        label: t('notes.takeANote'),
        group: t('palette.groupActions'),
        keywords: ['create', 'write', 'add'],
        run: go('/n/new'),
      },
      {
        id: 'new-checklist',
        label: t('notes.newChecklist'),
        group: t('palette.groupActions'),
        keywords: ['todo', 'tasks', 'list'],
        run: go('/n/new?mode=checklist'),
      },
      {
        id: 'toggle-view',
        label: t('palette.toggleView'),
        group: t('palette.groupActions'),
        keywords: ['grid', 'list', 'layout'],
        run: toggleViewMode,
      },
      { id: 'go-notes', label: t('notes.title'), group: t('palette.groupGo'), run: go('/(app)') },
      {
        id: 'go-reminders',
        label: t('notes.remindersTitle'),
        group: t('palette.groupGo'),
        keywords: ['alarms', 'due'],
        run: go('/(app)/reminders'),
      },
      {
        id: 'go-archive',
        label: t('notes.archiveTitle'),
        group: t('palette.groupGo'),
        run: go('/(app)/archive'),
      },
      {
        id: 'go-trash',
        label: t('notes.trashTitle'),
        group: t('palette.groupGo'),
        keywords: ['deleted', 'bin'],
        run: go('/(app)/trash'),
      },
      {
        id: 'go-labels',
        label: t('notes.editLabels'),
        group: t('palette.groupGo'),
        keywords: ['tags'],
        run: go('/(app)/labels'),
      },
      {
        id: 'go-folders',
        label: t('folders.manage'),
        group: t('palette.groupGo'),
        run: go('/(app)/folders'),
      },
      {
        id: 'go-notifications',
        label: t('notifications.title'),
        group: t('palette.groupGo'),
        run: go('/(app)/notifications'),
      },
      {
        id: 'settings',
        label: t('nav.settings'),
        group: t('palette.groupGo'),
        keywords: ['preferences', 'account', 'appearance', 'dark mode', 'import', 'export'],
        run: () => settings.open(),
      },
    ],
    [t, go, toggleViewMode, settings],
  );

  const entries = React.useMemo(
    () =>
      buildPaletteEntries({
        query,
        commands,
        notes: search ? found : [],
        untitled: t('notes.linkUntitled'),
        notesGroup: t('palette.groupNotes'),
        openNote: (id) => router.push(`/n/${id}`),
      }),
    [query, commands, search, found, t, router],
  );

  return (
    <Command
      visible={open}
      onClose={close}
      query={query}
      onQueryChange={setQuery}
      // Already matched above; the palette's own substring filter would hide the
      // notes the database found by words that are not in their titles.
      filter={() => true}
      placeholder={t('palette.placeholder')}
      emptyText={t('palette.empty')}
      items={entries.map((entry) => ({
        id: entry.id,
        label: entry.label,
        group: entry.group,
        shortcut: entry.shortcut,
        onSelect: entry.run,
      }))}
    />
  );
}
