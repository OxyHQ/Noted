import { useCallback } from 'react';
import apiClient from '@/lib/api/client';
import { API_ROUTES } from '@/lib/api/routes';
import { saveTextFile } from '@/lib/export/save';
import { useOwnedExport } from '@/lib/hooks/use-owned-export';

/**
 * Download everything the server holds for the account (`GET /account/export`).
 *
 * From the server rather than the local store on purpose: it is the one copy
 * that includes what other devices wrote, and a user asking for "everything"
 * means the account, not this phone. It therefore needs a connection.
 */
export function useExportAll() {
  const { run, pending: exporting } = useOwnedExport();

  const exportAll = useCallback(
    () =>
      run(async (viewerId, isCurrent) => {
        const response = await apiClient.get<unknown>(API_ROUTES.account.export, {
          expectedViewerId: viewerId,
        });
        if (!isCurrent()) return;
        const day = new Date().toISOString().slice(0, 10);
        await saveTextFile(
          `noted-export-${day}.json`,
          JSON.stringify(response.data, null, 2),
          'json',
          isCurrent,
        );
      }),
    [run],
  );

  return { exportAll, exporting };
}
