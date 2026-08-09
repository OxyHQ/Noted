/**
 * Notes, read from and written to the device's own store.
 *
 * Reads are live SQL subscriptions, so a write anywhere in the app re-renders
 * every screen showing the affected note without a refetch or a cache patch.
 * Writes land locally and enqueue an outbox entry; `lib/db/sync.ts` sends them
 * whenever there is a connection. Nothing on this path awaits the network.
 *
 * The mutations stay `useMutation` even though they never make a request: the
 * screens use `mutate`, `mutateAsync`, `isPending` and the `onSuccess` callback,
 * and TanStack Query provides all of that around any async function.
 */

import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "@oxyhq/bloom/toast";
import { useLiveQuery } from "@/lib/db/live-query";
import { newNoteId } from "@/lib/db/ids";
import {
  createNote as createNoteLocally,
  deleteNote as deleteNoteLocally,
  firstRowToNote,
  NOTE_DETAIL_SQL,
  noteListQuery,
  reorderNotes as reorderNotesLocally,
  restoreNote as restoreNoteLocally,
  rowsToNotes,
  trashNote as trashNoteLocally,
  updateNote as updateNoteLocally,
  type LocalNote,
  type NoteInput,
  type NoteRow,
} from "@/lib/db/notes-repo";
import { DEFAULT_NEW_NOTE_COLOR, type Note, type NoteListParams } from "@noted/shared-types";

/* ============================================================
   Normalization
   ============================================================ */

/**
 * Guarantee a note's array fields are always populated arrays.
 *
 * The local store already writes them as arrays, so this only has to defend the
 * one boundary that can still deliver something else: a note arriving from the
 * server over the socket.
 */
export function normalizeNote(note: Note): Note {
  return {
    ...note,
    attachments: Array.isArray(note.attachments) ? note.attachments : [],
    checklist: Array.isArray(note.checklist) ? note.checklist : [],
    labels: Array.isArray(note.labels) ? note.labels : [],
  };
}

/* ============================================================
   Queries
   ============================================================ */

const EMPTY_NOTES: LocalNote[] = [];

/** A filtered list of notes (home / archive / trash / label / search). */
export function useNotes(params: NoteListParams) {
  // The SQL text and its parameters are derived from the filters, so a changed
  // filter resubscribes rather than filtering an already-fetched list.
  const query = useMemo(
    () => noteListQuery(params),
    [params.view, params.label, params.pinned, params.q],
  );
  const { data, isLoading, error } = useLiveQuery<NoteRow, LocalNote[]>({
    sql: query.sql,
    params: query.params,
    mapRows: rowsToNotes,
  });
  return { data: data ?? EMPTY_NOTES, isLoading, error };
}

/** A single note's full detail. */
export function useNote(id: string | undefined) {
  const { data, isLoading, error } = useLiveQuery<NoteRow, LocalNote | null>({
    sql: NOTE_DETAIL_SQL,
    params: [id ?? ""],
    mapRows: firstRowToNote,
  });
  return { data: id ? data : null, isLoading: id ? isLoading : false, error };
}

/* ============================================================
   Mutations
   ============================================================ */

/** Create a note. Used both for `n/new` first-edit and quick-capture. */
export function useCreateNote() {
  return useMutation({
    mutationFn: (input: NoteInput): Promise<LocalNote> => createNoteLocally(newNoteId(), input),
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create note");
    },
  });
}

/** Patch a note (body/title/color/pin/labels/checklist/etc). */
export function useUpdateNote() {
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: NoteInput }) =>
      updateNoteLocally(id, patch),
    onError: (error: Error) => {
      toast.error(error.message || "Failed to save note");
    },
  });
}

/** Send a note to the trash. */
export function useTrashNote() {
  return useMutation({
    mutationFn: (id: string) => trashNoteLocally(id),
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete note");
    },
  });
}

/** Restore a note from the trash. */
export function useRestoreNote() {
  return useMutation({
    mutationFn: (id: string) => restoreNoteLocally(id),
    onError: (error: Error) => {
      toast.error(error.message || "Failed to restore note");
    },
  });
}

/** Permanently delete a note (delete forever). */
export function useDeleteNote() {
  return useMutation({
    mutationFn: (id: string) => deleteNoteLocally(id),
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete note");
    },
  });
}

/** Persist a new ordering of note ids (drag-reorder). */
export function useReorderNotes() {
  return useMutation({
    mutationFn: (ids: string[]) => reorderNotesLocally(ids),
    onError: (error: Error) => {
      toast.error(error.message || "Failed to reorder notes");
    },
  });
}

/* ============================================================
   Optimistic-create helper for `n/new`
   ============================================================ */

/** Build a blank, client-side note for the editor before the first save. */
export function makeDraftNote(): LocalNote {
  const now = new Date().toISOString();
  return {
    id: newNoteId(),
    kind: "note",
    title: "",
    body: "",
    generatedBody: "",
    checklist: [],
    color: DEFAULT_NEW_NOTE_COLOR,
    labels: [],
    pinned: false,
    archived: false,
    trashed: false,
    attachments: [],
    reminderAt: null,
    order: 0,
    createdAt: now,
    updatedAt: now,
  };
}
