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
 * On receipt we patch the React Query caches directly (so the change is instant
 * and does not depend on a refetch) and then invalidate the affected list keys
 * so any active list query re-derives membership (a color/pin/label change can
 * move a note in or out of a filtered list).
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOxy } from "@oxyhq/services";
import { io as socketIO, type Socket } from "socket.io-client";
import config from "@/lib/config";
import { queryKeys } from "@/lib/hooks/query-keys";
import { normalizeNote } from "@/lib/hooks/use-notes";
import type { Label, Note } from "@/lib/types/note";

export function useNotesRealtime() {
  const { oxyServices, isAuthenticated } = useOxy();
  const queryClient = useQueryClient();
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

    const onNoteUpsert = (payload: { note?: Note }) => {
      const raw = payload?.note;
      if (!raw?.id) return;
      // The socket payload is the most likely source of an unnormalized note
      // (legacy docs without `attachments`), so normalize before writing it to
      // any cache the renderers read from.
      const note = normalizeNote(raw);
      queryClient.setQueryData(queryKeys.notes.detail(note.id), note);
      queryClient.invalidateQueries({ queryKey: queryKeys.notes.all });
    };

    const onNoteDeleted = (payload: { id?: string }) => {
      const id = payload?.id;
      if (!id) return;
      queryClient.removeQueries({ queryKey: queryKeys.notes.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.notes.all });
    };

    const onLabelChange = (_payload: { label?: Label; id?: string }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.labels.all });
      // Notes embed label ids; a renamed/recolored/deleted label affects chips.
      queryClient.invalidateQueries({ queryKey: queryKeys.notes.all });
    };

    socket.on("note:created", onNoteUpsert);
    socket.on("note:updated", onNoteUpsert);
    socket.on("note:deleted", onNoteDeleted);
    socket.on("label:created", onLabelChange);
    socket.on("label:updated", onLabelChange);
    socket.on("label:deleted", onLabelChange);

    return () => {
      socket.off("note:created", onNoteUpsert);
      socket.off("note:updated", onNoteUpsert);
      socket.off("note:deleted", onNoteDeleted);
      socket.off("label:created", onLabelChange);
      socket.off("label:updated", onLabelChange);
      socket.off("label:deleted", onLabelChange);
      socket.disconnect();
    };
  }, [isAuthenticated, accessToken, oxyServices, queryClient]);
}
