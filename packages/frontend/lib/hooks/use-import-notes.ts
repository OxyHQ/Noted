import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { toast } from '@oxy.so/bloom/toast';
import { useOxy } from '@oxy.so/services/ui/client';
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
import { oxyServices as apiOwner } from '@/lib/oxy';

/** Pick Markdown / Obsidian / Google Keep files and bring them in as notes. */
export function useImportNotes() {
  const { t } = useTranslation();
  const { oxyServices, isAuthenticated, user, activeSessionId } = useOxy();
  const subscribe = useCallback(
    (listener: () => void) => oxyServices.http.addTokenChangeListener(listener),
    [oxyServices],
  );
  const getEpoch = useCallback(() => oxyServices.http.getSessionEpoch(), [oxyServices]);
  const epoch = useSyncExternalStore(subscribe, getEpoch, getEpoch);
  const viewerId = isAuthenticated ? user?.id : undefined;
  const owner = useMemo(
    () => ({ viewerId, sessionId: activeSessionId ?? null, epoch, services: oxyServices }),
    [viewerId, activeSessionId, epoch, oxyServices],
  );
  const committed = useRef<typeof owner | null>(null);
  useLayoutEffect(() => {
    committed.current = owner;
    return () => {
      if (committed.current === owner) committed.current = null;
    };
  }, [owner]);
  const { data: labels } = useLabels();
  const [importing, setImporting] = useState(false);

  const pickAndImport = useCallback(async (): Promise<ImportSummary | null> => {
    const viewerId = owner.viewerId;
    if (
      committed.current !== owner ||
      owner.services !== apiOwner ||
      !viewerId ||
      viewerId !== getActiveViewerId() ||
      owner.services.http.getSessionEpoch() !== owner.epoch
    )
      return null;
    const token = owner.services.session.accessToken;
    const subject = owner.services.session.userId;
    if (token !== null ? subject !== viewerId : !owner.sessionId || subject !== null) return null;

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
            const response = await apiClient.post<{ label: Label }>(
              API_ROUTES.labels.create,
              { name },
              { expectedViewerId: viewerId },
            );
            await saveLabel(response.data.label, viewerId);
            return response.data.label;
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
  }, [labels, owner, t]);

  return { pickAndImport, importing };
}
