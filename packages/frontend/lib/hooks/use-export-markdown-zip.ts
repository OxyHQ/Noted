import { useCallback } from 'react';
import { execute } from '@/lib/db/client';
import { noteListQuery, rowsToNotes, type NoteRow } from '@/lib/db/notes-repo';
import { notesToArchive } from '@/lib/export/archive';
import { saveBinaryFile } from '@/lib/export/save';
import { useOwnedExport } from '@/lib/hooks/use-owned-export';

/**
 * Every live note as a zip of Markdown files.
 *
 * From the local store, unlike `useExportAll`: this is the file you open in any
 * editor, and the store is the screens' read source of truth, so it works
 * offline. Trashed notes are left out; archived ones are kept.
 */
export function useExportMarkdownZip() {
  const { run, pending: exportingZip } = useOwnedExport();

  const exportZip = useCallback(
    () =>
      run(async (viewerId, isCurrent) => {
        const notes = [];
        for (const view of ['active', 'archived'] as const) {
          const { sql, params } = noteListQuery({ view });
          const rows = await execute<NoteRow>(sql, params, viewerId);
          if (!isCurrent()) return;
          notes.push(...rowsToNotes(rows));
        }
        const day = new Date().toISOString().slice(0, 10);
        const bytes = notesToArchive(notes);
        if (!isCurrent()) return;
        await saveBinaryFile(`noted-markdown-${day}.zip`, bytes, 'application/zip', isCurrent);
      }),
    [run],
  );

  return { exportZip, exportingZip };
}
