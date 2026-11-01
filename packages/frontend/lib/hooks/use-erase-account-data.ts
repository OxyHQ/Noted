import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { toast } from '@oxy.so/bloom/toast';
import { useOxy } from '@oxy.so/services/ui/client';
import apiClient from '@/lib/api/client';
import { API_ROUTES } from '@/lib/api/routes';
import { getActiveViewerId } from '@/lib/db/client';
import { eraseLocalAccountData } from '@/lib/db/erase-local';
import { useNotesUIStore } from '@/lib/stores/notes-ui-store';
import { useTranslation } from '@/hooks/useTranslation';
import { oxyServices as apiOwner } from '@/lib/oxy';

type Owner = {
  viewerId: string | undefined;
  sessionId: string | null;
  epoch: number;
  services: typeof apiOwner;
};

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
  const { oxyServices, isAuthenticated, user, activeSessionId } = useOxy();
  const subscribe = useCallback(
    (listener: () => void) => oxyServices.http.addTokenChangeListener(listener),
    [oxyServices],
  );
  const getEpoch = useCallback(() => oxyServices.http.getSessionEpoch(), [oxyServices]);
  const epoch = useSyncExternalStore(subscribe, getEpoch, getEpoch);
  const viewerId = isAuthenticated ? user?.id : undefined;
  const owner = useMemo<Owner>(
    () => ({ viewerId, sessionId: activeSessionId ?? null, epoch, services: oxyServices }),
    [viewerId, activeSessionId, epoch, oxyServices],
  );
  const committed = useRef<Owner | null>(null);
  useLayoutEffect(() => {
    committed.current = owner;
    return () => {
      if (committed.current === owner) committed.current = null;
    };
  }, [owner]);
  const sameSession = (candidate: Owner) =>
    candidate.services === apiOwner &&
    !!candidate.viewerId &&
    candidate.viewerId === getActiveViewerId() &&
    candidate.services.session.userId === candidate.viewerId &&
    candidate.services.http.getSessionEpoch() === candidate.epoch;
  const owns = (candidate: Owner) => committed.current === candidate && sameSession(candidate);

  const mutation = useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async ({
      requestOwner,
      accepted,
    }: {
      requestOwner: Owner;
      accepted: boolean;
    }): Promise<void> => {
      if (
        !accepted ||
        !sameSession(requestOwner) ||
        !requestOwner.viewerId ||
        (committed.current !== requestOwner && committed.current !== null)
      ) {
        throw new Error('The active account changed');
      }
      const viewerId = requestOwner.viewerId;
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
    onSuccess: (_data, { requestOwner }) => {
      if (!owns(requestOwner)) return;
      const ui = useNotesUIStore.getState();
      ui.setActiveLabel(null);
      ui.setActiveFolder(null);
      ui.setSearchQuery('');
      ui.clearSelection();
      queryClient.clear();
      toast.success(t('settings.eraseData.done'));
    },
    onError: (error: Error, { requestOwner }) => {
      if (!owns(requestOwner)) return;
      toast.error(error.message || t('settings.eraseData.failed'));
    },
  });
  return {
    ...mutation,
    mutate: () => mutation.mutate({ requestOwner: owner, accepted: owns(owner) }),
    mutateAsync: () => mutation.mutateAsync({ requestOwner: owner, accepted: owns(owner) }),
  };
}
