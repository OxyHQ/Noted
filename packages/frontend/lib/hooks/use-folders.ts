import { useMutation } from '@tanstack/react-query';
import { toast } from '@oxy.so/bloom/toast';
import apiClient from '@/lib/api/client';
import { API_ROUTES } from '@/lib/api/routes';
import { getActiveViewerId } from '@/lib/db/client';
import { FOLDER_LIST_SQL, rowsToFolders, saveFolder, type FolderRow } from '@/lib/db/folders-repo';
import { useLiveQuery } from '@/lib/db/live-query';
import { requestSync } from '@/lib/db/use-local-store';
import type { Folder } from '@noted/shared-types';

const EMPTY_FOLDERS: Folder[] = [];

/** The user's folders, read from the local store so a note can name its folder offline. */
export function useFolders() {
  const { data, isLoading, error } = useLiveQuery<FolderRow, Folder[]>({
    sql: FOLDER_LIST_SQL,
    mapRows: rowsToFolders,
  });
  return { data: data ?? EMPTY_FOLDERS, isLoading, error };
}

function requireViewer(): string {
  const viewerId = getActiveViewerId();
  if (!viewerId) throw new Error('No active account');
  return viewerId;
}

/**
 * Creating, renaming and deleting a folder go straight to the server and the
 * local copy follows the response — the same trade as labels (see
 * `useCreateLabel`): rare, user-initiated, and visibly failing.
 */
export function useCreateFolder() {
  return useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async (input: { name: string; parentId?: string | null }): Promise<Folder> => {
      const viewerId = requireViewer();
      const response = await apiClient.post<Folder>(API_ROUTES.folders.create, input, {
        expectedViewerId: viewerId,
      });
      await saveFolder(response.data, viewerId);
      return response.data;
    },
    onSuccess: () => requestSync(),
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create folder');
    },
  });
}

export function useRenameFolder() {
  return useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async ({ id, name }: { id: string; name: string }): Promise<Folder> => {
      const viewerId = requireViewer();
      const response = await apiClient.patch<Folder>(
        API_ROUTES.folders.update(id),
        { name },
        { expectedViewerId: viewerId },
      );
      await saveFolder(response.data, viewerId);
      return response.data;
    },
    onSuccess: () => requestSync(),
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to rename folder');
    },
  });
}

/** Move a folder under another, or to the top level with `parentId: null`. */
export function useMoveFolder() {
  return useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async ({
      id,
      parentId,
    }: {
      id: string;
      parentId: string | null;
    }): Promise<Folder> => {
      const viewerId = requireViewer();
      const response = await apiClient.patch<Folder>(
        API_ROUTES.folders.update(id),
        { parentId },
        { expectedViewerId: viewerId },
      );
      await saveFolder(response.data, viewerId);
      return response.data;
    },
    onSuccess: () => requestSync(),
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to move folder');
    },
  });
}

export function useDeleteFolder() {
  return useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async (id: string): Promise<string> => {
      await apiClient.delete(API_ROUTES.folders.delete(id), { expectedViewerId: requireViewer() });
      return id;
    },
    // Deleting a folder unfiles its notes on the server, so a full sync follows
    // to bring those notes (and the shorter folder list) back.
    onSuccess: () => requestSync(),
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete folder');
    },
  });
}
