import { useMutation } from "@tanstack/react-query";
import { toast } from "@oxyhq/bloom/toast";
import apiClient from "@/lib/api/client";
import { API_ROUTES } from "@/lib/api/routes";
import { useLiveQuery } from "@/lib/db/live-query";
import { LABEL_LIST_SQL, rowsToLabels, type LabelRow } from "@/lib/db/labels-repo";
import { requestSync } from "@/lib/db/use-local-store";
import type { Label, NoteColor } from "@noted/shared-types";

const EMPTY_LABELS: Label[] = [];

/**
 * The user's labels, read from the local store.
 *
 * Local rather than fetched because a note's chips resolve their names and
 * colours here: served from the network, every note would lose its labels the
 * moment there is no connection.
 */
export function useLabels() {
  const { data, isLoading, error } = useLiveQuery<LabelRow, Label[]>({
    sql: LABEL_LIST_SQL,
    mapRows: rowsToLabels,
  });
  return { data: data ?? EMPTY_LABELS, isLoading, error };
}

/**
 * Creating, renaming and deleting a label go straight to the server, and the
 * local copy is refreshed from the response.
 *
 * No outbox: unlike a note, a label change is rare, always user-initiated, and
 * its failure is immediately visible to the person who asked for it. Queueing it
 * offline would mean reconciling two sides that can both rename the same label,
 * for an operation nobody performs while disconnected.
 */
export function useCreateLabel() {
  return useMutation({
    mutationFn: async (input: { name: string; color?: NoteColor | null }): Promise<Label> => {
      const res = await apiClient.post<Label>(API_ROUTES.labels.create, input);
      return res.data;
    },
    onSuccess: () => requestSync(),
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create label");
    },
  });
}

export function useUpdateLabel() {
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: { name?: string; color?: NoteColor | null };
    }): Promise<Label> => {
      const res = await apiClient.patch<Label>(API_ROUTES.labels.update(id), patch);
      return res.data;
    },
    onSuccess: () => requestSync(),
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update label");
    },
  });
}

export function useDeleteLabel() {
  return useMutation({
    mutationFn: async (id: string): Promise<string> => {
      await apiClient.delete(API_ROUTES.labels.delete(id));
      return id;
    },
    // Deleting a label also strips its id from every note that carried it, so
    // the notes have to be pulled again too — which the full sync does.
    onSuccess: () => requestSync(),
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete label");
    },
  });
}
