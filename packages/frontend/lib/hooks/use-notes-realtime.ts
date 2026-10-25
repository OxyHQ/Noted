/**
 * Real-time notes sync via Socket.IO, on Nilo's socket.
 *
 * Mount once in the authenticated app layout. The handshake carries the Oxy
 * access token (verified server-side). The notes live in the user's personal
 * workspace, so on every connect this joins that workspace's room, and the
 * server tells it:
 *   workspace:changed { workspaceId }  a page or database of it changed
 *   database:changed  { databaseId }   a database's rows changed (a note edited in Nilo)
 *   workspace:reset   { workspaceId }  the workspace was emptied
 *
 * Every one of them means the same thing here: "the server has changed, come and
 * look". The events carry ids only, never content, and nothing is applied from
 * them: the local store may hold edits the server has not seen, and only the
 * pull path knows how to reconcile the two.
 */

import { useEffect } from 'react';
import { useOxy } from '@oxy.so/services/ui/client';
import { io as socketIO, type Socket } from 'socket.io-client';
import apiClient from '@/lib/api/client';
import config from '@/lib/config';
import { requestSync } from '@/lib/db/use-local-store';

export function useNotesRealtime() {
  const { oxyServices, isAuthenticated, user, activeSessionId } = useOxy();

  useEffect(() => {
    if (!isAuthenticated || !user?.id || !activeSessionId) return;
    const linked = oxyServices.createLinkedClient({ baseURL: config.apiUrl });
    const handshake = new AbortController();
    const epoch = oxyServices.http.getSessionEpoch();
    const current = () => !handshake.signal.aborted && oxyServices.http.getSessionEpoch() === epoch;

    const socket: Socket = socketIO(config.apiUrl, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      auth: (callback) => {
        void linked.getAccessToken(config.apiUrl, { signal: handshake.signal }).then(
          (token) => {
            if (current()) callback({ token });
          },
          () => {
            // Surface an authentication failure without sending a stale bearer.
            if (current()) callback({});
          },
        );
      },
    });

    const unsubscribe = oxyServices.http.addTokenChangeListener(() => {
      if (oxyServices.http.getSessionEpoch() === epoch) return;
      handshake.abort();
      socket.disconnect();
    });

    const onServerChange = () => {
      if (current()) requestSync();
    };

    // A reconnect means this client was out of touch for a while, so whatever
    // happened during the gap arrives through the same pull — and the room has
    // to be joined again, because a new connection is in none.
    const onConnect = () => {
      onServerChange();
      void apiClient
        .get<{ workspace: { id: string } }>('/workspaces/personal')
        .then(({ data }) => {
          if (current() && socket.connected) socket.emit('workspace:join', data.workspace.id);
        })
        .catch(() => undefined);
    };
    socket.on('connect', onConnect);
    socket.on('workspace:changed', onServerChange);
    socket.on('database:changed', onServerChange);
    socket.on('workspace:reset', onServerChange);

    return () => {
      handshake.abort();
      unsubscribe();
      linked.dispose();
      socket.off('connect', onConnect);
      socket.off('workspace:changed', onServerChange);
      socket.off('database:changed', onServerChange);
      socket.off('workspace:reset', onServerChange);
      socket.disconnect();
    };
  }, [isAuthenticated, user?.id, activeSessionId, oxyServices]);
}
