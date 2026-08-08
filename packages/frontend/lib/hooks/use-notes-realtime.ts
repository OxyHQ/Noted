/**
 * Real-time notes/labels sync via Socket.IO.
 *
 * Mount once in the authenticated app layout. The handshake carries the Oxy
 * access token (verified server-side by io.use(authSocket())), and the server
 * auto-joins the authenticated user's room on connect — the client never sends
 * a userId. The server emits:
 *   note:created  { note }
 *   note:updated  { note }
 *   note:deleted  { id }
 *   label:created { label }
 *   label:updated { label }
 *   label:deleted { id }
 *
 * Every one of them means the same thing here: "the server has changed, come and
 * look". The payload is deliberately NOT applied directly. The local store may
 * hold edits the server has not seen, and only the pull path knows how to
 * reconcile the two — writing a pushed note straight into the database would
 * silently overwrite whatever the user typed while offline.
 */

import { useEffect } from "react";
import { useOxy } from "@oxyhq/services";
import { io as socketIO, type Socket } from "socket.io-client";
import config from "@/lib/config";
import { requestSync } from "@/lib/db/use-local-store";

export function useNotesRealtime() {
  const { oxyServices, isAuthenticated } = useOxy();
  // Re-establish the socket when the access token changes (sign-in/out, refresh)
  // so the handshake always carries a valid token.
  const accessToken = oxyServices.getAccessToken();

  useEffect(() => {
    if (!isAuthenticated || !accessToken) return;

    const socket: Socket = socketIO(config.apiUrl, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      // Callback form so each (re)connect reads a FRESH token; the server
      // verifies it (io.use(authSocket())) and auto-joins the user's room.
      auth: (cb) => cb({ token: oxyServices.getAccessToken() ?? "" }),
    });

    const onServerChange = () => requestSync();

    // A reconnect means this client was out of touch for a while, so whatever
    // happened during the gap arrives through the same pull.
    socket.on("connect", onServerChange);
    socket.on("note:created", onServerChange);
    socket.on("note:updated", onServerChange);
    socket.on("note:deleted", onServerChange);
    socket.on("label:created", onServerChange);
    socket.on("label:updated", onServerChange);
    socket.on("label:deleted", onServerChange);

    return () => {
      socket.off("connect", onServerChange);
      socket.off("note:created", onServerChange);
      socket.off("note:updated", onServerChange);
      socket.off("note:deleted", onServerChange);
      socket.off("label:created", onServerChange);
      socket.off("label:updated", onServerChange);
      socket.off("label:deleted", onServerChange);
      socket.disconnect();
    };
  }, [isAuthenticated, accessToken, oxyServices]);
}
