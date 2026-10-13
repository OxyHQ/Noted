import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@oxy.so/bloom/toast';
import apiClient from '@/lib/api/client';
import { API_ROUTES } from '@/lib/api/routes';
import { getActiveViewerId } from '@/lib/db/client';
import { eraseLocalAccountData } from '@/lib/db/erase-local';
import { useNotesUIStore } from '@/lib/stores/notes-ui-store';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * Erase everything Noted holds for this account: the server first, then this
 * device.
 *
 * In that order on purpose. If the server call fails nothing has changed and the
 * person can try again; if it succeeded and clearing the device then failed, the
 * data is already gone from the only copy that mattered, and the message says so
 * rather than reporting a failure that did not happen. The reverse order could
 * wipe the phone and leave the account untouched.
 */
export function useEraseAccountData() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async (): Promise<void> => {
      const viewerId = getActiveViewerId();
      if (!viewerId) throw new Error('No active account');
      await apiClient.post(
        API_ROUTES.account.erase,
        { confirm: 'DELETE' },
        { expectedViewerId: viewerId },
      );
      try {
        await eraseLocalAccountData(viewerId);
      } catch {
        throw new Error(t('settings.eraseData.deviceFailed'));
      }
    },
    onSuccess: () => {
      const ui = useNotesUIStore.getState();
      ui.setActiveLabel(null);
      ui.setActiveFolder(null);
      ui.setSearchQuery('');
      ui.clearSelection();
      queryClient.clear();
      toast.success(t('settings.eraseData.done'));
    },
    onError: (error: Error) => {
      toast.error(error.message || t('settings.eraseData.failed'));
    },
  });
}
