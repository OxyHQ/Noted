import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useOxy } from "@oxyhq/services";
import { toast } from "@/components/sonner";
import apiClient from "@/lib/api/client";
import { API_ROUTES } from "@/lib/api/routes";
import { queryKeys } from "@/lib/hooks/query-keys";
import { generateUUID } from "@/lib/utils";
import { DEFAULT_NEW_NOTE_COLOR, type Note, type NoteListParams } from "@/lib/types/note";

/* ============================================================
   Fetchers
   ============================================================ */

function listParamsToQuery(params: NoteListParams): Record<string, string> {
  const q: Record<string, string> = {};
  if (params.view) q.view = params.view;
  if (params.label) q.label = params.label;
  if (typeof params.pinned === "boolean") q.pinned = String(params.pinned);
  if (params.q) q.q = params.q;
  return q;
}

async function fetchNotes(params: NoteListParams): Promise<Note[]> {
  const res = await apiClient.get<{ data: Note[] }>(API_ROUTES.notes.list, {
    params: listParamsToQuery(params),
  });
  return res.data.data;
}

async function fetchNote(id: string): Promise<Note> {
  const res = await apiClient.get<Note>(API_ROUTES.notes.get(id));
  return res.data;
}

/* ============================================================
   Queries
   ============================================================ */

/** A filtered list of notes (home / archive / trash / label / search). */
export function useNotes(params: NoteListParams) {
  const { isAuthenticated } = useOxy();
  return useQuery({
    queryKey: queryKeys.notes.list(params),
    queryFn: () => fetchNotes(params),
    enabled: isAuthenticated,
    staleTime: 1000 * 30,
  });
}

/** A single note's full detail. */
export function useNote(id: string | undefined) {
  const { isAuthenticated } = useOxy();
  return useQuery({
    queryKey: queryKeys.notes.detail(id ?? ""),
    queryFn: () => fetchNote(id ?? ""),
    enabled: isAuthenticated && !!id,
    staleTime: 1000 * 30,
  });
}

export function prefetchNote(queryClient: QueryClient, id: string) {
  queryClient.prefetchQuery({
    queryKey: queryKeys.notes.detail(id),
    queryFn: () => fetchNote(id),
    staleTime: 1000 * 30,
  });
}

/* ============================================================
   Cache helpers
   ============================================================ */

/**
 * Apply `patch` to every cached note list that currently holds `id`, plus the
 * detail cache. Returns a snapshot of the touched list entries so the caller
 * can roll back on error.
 */
function patchNoteInCaches(
  queryClient: QueryClient,
  id: string,
  patch: (note: Note) => Note
) {
  queryClient.setQueriesData<Note[]>(
    { queryKey: queryKeys.notes.all },
    (old) => {
      if (!Array.isArray(old)) return old;
      return old.map((n) => (n.id === id ? patch(n) : n));
    }
  );
  queryClient.setQueryData<Note>(queryKeys.notes.detail(id), (old) =>
    old ? patch(old) : old
  );
}

function removeNoteFromListCaches(queryClient: QueryClient, id: string) {
  queryClient.setQueriesData<Note[]>(
    { queryKey: queryKeys.notes.all },
    (old) => {
      if (!Array.isArray(old)) return old;
      return old.filter((n) => n.id !== id);
    }
  );
}

/* ============================================================
   Mutations
   ============================================================ */

/** Create a note. Used both for `n/new` first-edit and quick-capture. */
export function useCreateNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<Note>): Promise<Note> => {
      const res = await apiClient.post<Note>(API_ROUTES.notes.create, input);
      return res.data;
    },
    onSuccess: (note) => {
      queryClient.setQueryData(queryKeys.notes.detail(note.id), note);
      queryClient.invalidateQueries({ queryKey: queryKeys.notes.all });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create note");
    },
  });
}

/**
 * Patch a note (body/title/color/pin/labels/checklist/etc). Optimistic: the
 * change is applied to every cache immediately and rolled back on failure.
 */
export function useUpdateNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<Note>;
    }): Promise<Note> => {
      const res = await apiClient.patch<Note>(API_ROUTES.notes.update(id), patch);
      return res.data;
    },
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notes.all });
      const previousLists = queryClient.getQueriesData<Note[]>({
        queryKey: queryKeys.notes.all,
      });
      const previousDetail = queryClient.getQueryData<Note>(
        queryKeys.notes.detail(id)
      );
      patchNoteInCaches(queryClient, id, (n) => ({
        ...n,
        ...patch,
        updatedAt: new Date().toISOString(),
      }));
      return { previousLists, previousDetail, id };
    },
    onError: (error: Error, _vars, context) => {
      if (context?.previousLists) {
        for (const [key, data] of context.previousLists) {
          queryClient.setQueryData(key, data);
        }
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(
          queryKeys.notes.detail(context.id),
          context.previousDetail
        );
      }
      toast.error(error.message || "Failed to save note");
    },
    onSuccess: (note) => {
      queryClient.setQueryData(queryKeys.notes.detail(note.id), note);
    },
    onSettled: (_data, _err, vars) => {
      // Re-derive list membership (color/pin/label/archive can move the note).
      queryClient.invalidateQueries({ queryKey: queryKeys.notes.all });
      void vars;
    },
  });
}

/** Send a note to the trash. Optimistic removal from active lists. */
export function useTrashNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<Note> => {
      const res = await apiClient.post<Note>(API_ROUTES.notes.trash(id));
      return res.data;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notes.all });
      const previousLists = queryClient.getQueriesData<Note[]>({
        queryKey: queryKeys.notes.all,
      });
      removeNoteFromListCaches(queryClient, id);
      return { previousLists };
    },
    onError: (error: Error, _id, context) => {
      if (context?.previousLists) {
        for (const [key, data] of context.previousLists) {
          queryClient.setQueryData(key, data);
        }
      }
      toast.error(error.message || "Failed to delete note");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notes.all });
    },
  });
}

/** Restore a note from the trash. */
export function useRestoreNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<Note> => {
      const res = await apiClient.post<Note>(API_ROUTES.notes.restore(id));
      return res.data;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notes.all });
      const previousLists = queryClient.getQueriesData<Note[]>({
        queryKey: queryKeys.notes.all,
      });
      removeNoteFromListCaches(queryClient, id);
      return { previousLists };
    },
    onError: (error: Error, _id, context) => {
      if (context?.previousLists) {
        for (const [key, data] of context.previousLists) {
          queryClient.setQueryData(key, data);
        }
      }
      toast.error(error.message || "Failed to restore note");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notes.all });
    },
  });
}

/** Permanently delete a note (delete forever). */
export function useDeleteNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<string> => {
      await apiClient.delete(API_ROUTES.notes.delete(id));
      return id;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notes.all });
      const previousLists = queryClient.getQueriesData<Note[]>({
        queryKey: queryKeys.notes.all,
      });
      removeNoteFromListCaches(queryClient, id);
      return { previousLists };
    },
    onError: (error: Error, _id, context) => {
      if (context?.previousLists) {
        for (const [key, data] of context.previousLists) {
          queryClient.setQueryData(key, data);
        }
      }
      toast.error(error.message || "Failed to delete note");
    },
    onSuccess: (id) => {
      queryClient.removeQueries({ queryKey: queryKeys.notes.detail(id) });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notes.all });
    },
  });
}

/** Persist a new ordering of note ids (drag-reorder). */
export function useReorderNotes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]): Promise<void> => {
      await apiClient.post(API_ROUTES.notes.reorder, { ids });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to reorder notes");
      queryClient.invalidateQueries({ queryKey: queryKeys.notes.all });
    },
  });
}

/* ============================================================
   Optimistic-create helper for `n/new`
   ============================================================ */

/** Build a blank, client-side note for the editor before the first POST. */
export function makeDraftNote(): Note {
  const now = new Date().toISOString();
  return {
    id: generateUUID(),
    title: "",
    body: "",
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
