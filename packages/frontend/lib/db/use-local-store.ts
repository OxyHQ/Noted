/**
 * The local store's lifecycle: which account it belongs to, and when it talks to
 * the server.
 *
 * Mounted once above the root navigator. Everything below is a side effect on
 * an external system (a database file, a network) rather than rendered state, so
 * it lives in effects rather than being derived.
 */

import { useCallback, useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useOxy } from '@oxy.so/services';
import { createLogger } from '@oxy.so/core/logger';

import { recoverInterruptedCaptures } from '@/lib/capture/captures-repo';
import { clearActiveViewer, setActiveViewer } from '@/lib/db/client';
import { newNoteId } from '@/lib/db/ids';
import { syncNotes } from '@/lib/db/sync';

import { reloadWebStore } from '@/lib/db/web-store-recovery';
import type { LocalStoreState } from '@/lib/db/local-store-context';
import { useNotesUIStore } from '@/lib/stores/notes-ui-store';
import { useUndoStore } from '@/lib/stores/undo-store';
import { useCaptureStore } from '@/lib/stores/capture-store';

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
export function useLocalStore(): LocalStoreState {
  const { user, isAuthenticated } = useOxy();
  const viewerId = isAuthenticated ? user?.id : undefined;
  const [openedViewer, setOpenedViewer] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ viewerId: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    // The web worker caches a partially initialized VFS after an OPFS error.
    // Reopening that worker cannot recover it; reloading preserves its files.
    if (reloadWebStore()) return;
    setOpenedViewer(null);
    setAttempt(n => n + 1);
  }, []);
  // Hide outgoing rows during render, before the account-switch effect runs.
  const isReady = Boolean(viewerId && openedViewer === viewerId);
  const error = failure && failure.viewerId === viewerId ? failure.message : null;

  useEffect(() => {
    if (sharedSyncTimer !== null) { clearTimeout(sharedSyncTimer); sharedSyncTimer = null; }
    useNotesUIStore.getState().clearSelection();
    useNotesUIStore.getState().setActiveLabel(null);
    useNotesUIStore.getState().setSearchQuery('');
    useUndoStore.getState().dismissUndo();
    useCaptureStore.getState().clearCapture();
    setFailure(null);
    if (!viewerId) {
      setOpenedViewer(null);
      // Queue the clear even when an outgoing open has not yet set its ID.
      // The client preserves an unsettled viewer gate on a cold start.
      void clearActiveViewer().catch(error => {
        logger.error('Could not close the local store', { error: String(error) });
      });
      return;
    }

    let active = true;
    setOpenedViewer(null);
    void (async () => {
      if (attempt > 0) await clearActiveViewer();
      if (active) await setActiveViewer(viewerId);
    })()
      .then(async () => {
        // A capture still marked `recording` belongs to a process that no longer
        // exists — nothing else will ever move it forward, so it would sit there
        // claiming to be recording. Its audio is untouched on disk, which is what
        // makes transcribing it after the fact possible.
        if (!active) return;
        const recovered = await recoverInterruptedCaptures();
        if (recovered > 0) logger.info('Recovered interrupted captures', { recovered });
        if (active) setOpenedViewer(viewerId);
      })
      .catch((error: unknown) => {
        logger.error('Could not open the local store', { error: String(error) });
        if (active) setFailure({ viewerId, message: String(error) });
      });

    return () => {
      active = false;
    };
  }, [viewerId, attempt]);

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
      if (sharedSyncTimer !== null) { clearTimeout(sharedSyncTimer); sharedSyncTimer = null; }
      appStateSubscription.remove();
      netInfoUnsubscribe();
    };
  }, [isReady]);

  return { isReady, viewerId: viewerId ?? null, error, retry };
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
