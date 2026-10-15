import { useCallback, useState } from 'react';
import { toast } from '@oxy.so/bloom/toast';
import { execute, getActiveViewerId } from '@/lib/db/client';
import { noteListQuery, rowsToNotes, type NoteRow } from '@/lib/db/notes-repo';
import { notesToArchive } from '@/lib/export/archive';
import { saveBinaryFile } from '@/lib/export/save';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * Every live note as a zip of Markdown files.
 *
 * From the local store, unlike `useExportAll`: this is the file you open in any
 * editor, and the store is the screens' read source of truth, so it works
 * offline. Trashed notes are left out; archived ones are kept.
 */
export function useExportMarkdownZip() {
  const { t } = useTranslation();
  const [exportingZip, setExporting] = useState(false);

  const exportZip = useCallback(async () => {
    const viewerId = getActiveViewerId();
    if (!viewerId) return;
    setExporting(true);
    try {
      const notes = [];
      for (const view of ['active', 'archived'] as const) {
        const { sql, params } = noteListQuery({ view });
        notes.push(...rowsToNotes(await execute<NoteRow>(sql, params, viewerId)));
      }
      const day = new Date().toISOString().slice(0, 10);
      await saveBinaryFile(`noted-markdown-${day}.zip`, notesToArchive(notes), 'application/zip');
    } catch (error) {
      toast.error((error as Error).message || t('settings.export.failed'));
    } finally {
      setExporting(false);
    }
  }, [t]);

  return { exportZip, exportingZip };
}
