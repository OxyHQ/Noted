import { useCallback, useState } from 'react';
import { toast } from '@oxy.so/bloom/toast';
import apiClient from '@/lib/api/client';
import { API_ROUTES } from '@/lib/api/routes';
import { getActiveViewerId } from '@/lib/db/client';
import { saveTextFile } from '@/lib/export/save';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * Download everything the server holds for the account (`GET /account/export`).
 *
 * From the server rather than the local store on purpose: it is the one copy
 * that includes what other devices wrote, and a user asking for "everything"
 * means the account, not this phone. It therefore needs a connection.
 */
export function useExportAll() {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);

  const exportAll = useCallback(async () => {
    const viewerId = getActiveViewerId();
    if (!viewerId) return;
    setExporting(true);
    try {
      const response = await apiClient.get<unknown>(API_ROUTES.account.export, {
        expectedViewerId: viewerId,
      });
      const day = new Date().toISOString().slice(0, 10);
      await saveTextFile(
        `noted-export-${day}.json`,
        JSON.stringify(response.data, null, 2),
        'json',
      );
    } catch (error) {
      toast.error((error as Error).message || t('settings.export.failed'));
    } finally {
      setExporting(false);
    }
  }, [t]);

  return { exportAll, exporting };
}
