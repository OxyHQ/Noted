import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { toast } from '@oxy.so/bloom/toast';
import { useOxy } from '@oxy.so/services/ui/client';
import { getActiveViewerId } from '@/lib/db/client';
import { oxyServices as apiOwner } from '@/lib/oxy';
import { useTranslation } from '@/hooks/useTranslation';

type Owner = {
  viewerId: string | undefined;
  sessionId: string | null;
  epoch: number;
  services: typeof apiOwner;
};
type Pending = { owner: Owner; count: number };
type ExportAction = (viewerId: string, isCurrent: () => boolean) => Promise<void>;

/** Bind exports to the session that committed their callback. */
export function useOwnedExport() {
  const { t } = useTranslation();
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
  const [pending, setPending] = useState<Pending | null>(null);
  useLayoutEffect(() => {
    committed.current = owner;
    return () => {
      if (committed.current === owner) committed.current = null;
    };
  }, [owner]);

  const run = useCallback(
    async (action: ExportAction) => {
      const sameSession = () =>
        owner.services === apiOwner &&
        !!owner.viewerId &&
        owner.viewerId === getActiveViewerId() &&
        owner.services.session.userId === owner.viewerId &&
        owner.services.http.getSessionEpoch() === owner.epoch;
      const owns = () => committed.current === owner && sameSession();
      if (!owns() || !owner.viewerId) return;
      setPending((previous) =>
        previous?.owner === owner ? { owner, count: previous.count + 1 } : { owner, count: 1 },
      );
      try {
        await action(owner.viewerId, owns);
      } catch (error) {
        if (owns()) toast.error((error as Error).message || t('settings.export.failed'));
      } finally {
        setPending((previous) => {
          if (previous?.owner !== owner) return previous;
          return previous.count > 1 ? { owner, count: previous.count - 1 } : null;
        });
      }
    },
    [owner, t],
  );
  return { run, pending: pending?.owner === owner };
}
