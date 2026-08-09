/**
 * The local store's lifecycle: which account it belongs to, and when it talks to
 * the server.
 *
 * Mounted once in the authenticated layout. Everything below is a side effect on
 * an external system (a database file, a network) rather than rendered state, so
 * it lives in effects rather than being derived.
 */

import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useOxy } from '@oxyhq/services';
import { createLogger } from '@oxyhq/core/logger';

import { recoverInterruptedCaptures } from '@/lib/capture/captures-repo';
import { clearActiveViewer, getActiveViewerId, setActiveViewer } from '@/lib/db/client';
import { newNoteId } from '@/lib/db/ids';
import { syncNotes } from '@/lib/db/sync';

const logger = createLogger('NotedStore');

/**
 * Collapse bursts of sync triggers — regaining connectivity typically fires the
 * network listener and the foreground listener within the same moment.
 */
const SYNC_DEBOUNCE_MS = 750;

/**
 * Open this account's database and keep it in sync.
 *
 * @returns whether the store is ready to be read. Screens must not query before
 *   it is: a query with no active account has no database file to open.
 */
export function useLocalStore(): { isReady: boolean } {
  const { user, isAuthenticated } = useOxy();
  const viewerId = isAuthenticated ? user?.id : undefined;
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!viewerId) {
      setIsReady(false);
      // Only a real sign-out closes the store. This effect also runs once on
      // every cold start, before the session has restored, and clearing there
      // would install a fresh gate over the one the restore is about to open —
      // leaving every query waiting on a promise nobody resolves.
      if (getActiveViewerId() !== null) void clearActiveViewer();
      return;
    }

    let active = true;
    setIsReady(false);
    void setActiveViewer(viewerId)
      .then(async () => {
        // A capture still marked `recording` belongs to a process that no longer
        // exists — nothing else will ever move it forward, so it would sit there
        // claiming to be recording. Its audio is untouched on disk, which is what
        // makes transcribing it after the fact possible.
        const recovered = await recoverInterruptedCaptures();
        if (recovered > 0) logger.info('Recovered interrupted captures', { recovered });
        if (active) setIsReady(true);
      })
      .catch((error: unknown) => {
        logger.error('Could not open the local store', { error: String(error) });
      });

    return () => {
      active = false;
    };
  }, [viewerId]);

  useEffect(() => {
    if (!isReady) return;

    // Every trigger goes through the one shared debounce below. A second timer
    // here would not collapse against it: mounting, foregrounding, reconnecting
    // and a socket event all land within the same moment, and two timers means
    // two cycles firing together.
    requestSync();

    // Coming back to the app is the moment its data is most likely stale, and
    // the moment the user is about to look at it.
    const appStateSubscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'active') requestSync();
    });

    // Regaining a connection is the moment the outbox can finally drain.
    const netInfoUnsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected === true) requestSync();
    });

    return () => {
      appStateSubscription.remove();
      netInfoUnsubscribe();
    };
  }, [isReady]);

  return { isReady };
}

/**
 * Ask for a sync now.
 *
 * Used by the socket listener: a server-side change is a reason to pull, and
 * pulling is what reconciles it — applying the pushed payload directly would
 * bypass the conflict rules that protect unsynced local edits.
 */
export function requestSync(): void {
  // Debounced for the same reason the hook debounces, and more urgently: this is
  // called from socket events and mutation callbacks, which arrive in bursts —
  // one per changed note, plus a reconnect. Firing a round trip at each of them
  // turns a burst into a storm, and any write a pull performs can bring the next
  // burst with it.
  if (sharedSyncTimer !== null) clearTimeout(sharedSyncTimer);
  sharedSyncTimer = setTimeout(() => {
    sharedSyncTimer = null;
    void syncNotes(newNoteId);
  }, SYNC_DEBOUNCE_MS);
}

let sharedSyncTimer: ReturnType<typeof setTimeout> | null = null;
