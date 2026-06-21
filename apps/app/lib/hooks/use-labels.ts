import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOxy } from "@oxyhq/services";
import { toast } from "@/components/sonner";
import apiClient from "@/lib/api/client";
import { API_ROUTES } from "@/lib/api/routes";
import { queryKeys } from "@/lib/hooks/query-keys";
import type { Label, NoteColor } from "@/lib/types/note";

async function fetchLabels(): Promise<Label[]> {
  const res = await apiClient.get<{ data: Label[] }>(API_ROUTES.labels.list);
  return res.data.data;
}

export function useLabels() {
  const { isAuthenticated } = useOxy();
  return useQuery({
    queryKey: queryKeys.labels.all,
    queryFn: fetchLabels,
    enabled: isAuthenticated,
    staleTime: 1000 * 60,
  });
}

export function useCreateLabel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      color?: NoteColor | null;
    }): Promise<Label> => {
      const res = await apiClient.post<Label>(API_ROUTES.labels.create, input);
      return res.data;
    },
    onSuccess: (label) => {
      queryClient.setQueryData<Label[]>(queryKeys.labels.all, (old) =>
        old ? [...old, label] : [label]
      );
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create label");
    },
  });
}

export function useUpdateLabel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: { name?: string; color?: NoteColor | null };
    }): Promise<Label> => {
      const res = await apiClient.patch<Label>(
        API_ROUTES.labels.update(id),
        patch
      );
      return res.data;
    },
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.labels.all });
      const previous = queryClient.getQueryData<Label[]>(queryKeys.labels.all);
      queryClient.setQueryData<Label[]>(queryKeys.labels.all, (old) =>
        old?.map((l) => (l.id === id ? { ...l, ...patch } : l))
      );
      return { previous };
    },
    onError: (error: Error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.labels.all, context.previous);
      }
      toast.error(error.message || "Failed to update label");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.labels.all });
    },
  });
}

export function useDeleteLabel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<string> => {
      await apiClient.delete(API_ROUTES.labels.delete(id));
      return id;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.labels.all });
      const previous = queryClient.getQueryData<Label[]>(queryKeys.labels.all);
      queryClient.setQueryData<Label[]>(queryKeys.labels.all, (old) =>
        old?.filter((l) => l.id !== id)
      );
      return { previous };
    },
    onError: (error: Error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.labels.all, context.previous);
      }
      toast.error(error.message || "Failed to delete label");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.labels.all });
      // Deleting a label removes its chips from notes.
      queryClient.invalidateQueries({ queryKey: queryKeys.notes.all });
    },
  });
}
