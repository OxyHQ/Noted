import { useCallback, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { toast } from '@oxy.so/bloom/toast';
import apiClient from '@/lib/api/client';
import { API_ROUTES } from '@/lib/api/routes';
import { getActiveViewerId } from '@/lib/db/client';
import { newNoteId } from '@/lib/db/ids';
import { saveLabel } from '@/lib/db/labels-repo';
import { createNote } from '@/lib/db/notes-repo';
import { requestSync } from '@/lib/db/use-local-store';
import { readPickedText } from '@/lib/import/read-file';
import { runImport, type ImportSummary } from '@/lib/import/run';
import { useLabels } from '@/lib/hooks/use-labels';
import { useTranslation } from '@/hooks/useTranslation';
import type { Label } from '@noted/shared-types';

/** Pick Markdown / Obsidian / Google Keep files and bring them in as notes. */
export function useImportNotes() {
  const { t } = useTranslation();
  const { data: labels } = useLabels();
  const [importing, setImporting] = useState(false);

  const pickAndImport = useCallback(async (): Promise<ImportSummary | null> => {
    const viewerId = getActiveViewerId();
    if (!viewerId) return null;

    const picked = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
      type: ['text/markdown', 'text/plain', 'application/json', '*/*'],
    });
    if (picked.canceled || picked.assets.length === 0) return null;

    setImporting(true);
    try {
      const files = await Promise.all(
        picked.assets.map(async (asset) => ({
          name: asset.name,
          text: await readPickedText(asset),
        })),
      );
      const summary = await runImport(files, {
        makeId: newNoteId,
        createNote: (id, input) => createNote(id, input, viewerId),
        labels,
        // Labels are server-first (see `useCreateLabel`): offline, the note is
        // still imported, just without that label.
        createLabel: async (name) => {
          try {
            const response = await apiClient.post<Label>(
              API_ROUTES.labels.create,
              { name },
              { expectedViewerId: viewerId },
            );
            await saveLabel(response.data, viewerId);
            return response.data;
          } catch {
            return null;
          }
        },
      });
      requestSync();
      if (summary.imported > 0) {
        toast.success(t('settings.import.done', { count: summary.imported }));
      }
      if (summary.skipped.length > 0) {
        toast.error(
          t('settings.import.skipped', {
            count: summary.skipped.length,
            first: `${summary.skipped[0].name}: ${summary.skipped[0].reason}`,
          }),
        );
      }
      return summary;
    } catch (error) {
      toast.error((error as Error).message || t('settings.import.failed'));
      return null;
    } finally {
      setImporting(false);
    }
  }, [labels, t]);

  return { pickAndImport, importing };
}
