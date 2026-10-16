import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api/client';
import { API_ROUTES } from '@/lib/api/routes';
import { getActiveViewerId } from '@/lib/db/client';
import type { RevisionDetail, RevisionSummary } from '@/lib/notes/revisions';

/**
 * A note's earlier versions. Server-side history, so it needs a connection and
 * is only fetched while the history dialog is open.
 */
export function useNoteRevisions(noteId: string | undefined, enabled: boolean) {
  const viewerId = getActiveViewerId();
  return useQuery({
    queryKey: ['note-revisions', viewerId, noteId],
    enabled: enabled && !!noteId && !!viewerId,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: async (): Promise<RevisionSummary[]> => {
      const response = await apiClient.get<{ versions: RevisionSummary[] }>(
        API_ROUTES.notes.revisions(noteId as string),
        { expectedViewerId: viewerId as string },
      );
      return response.data.versions;
    },
  });
}

export async function fetchRevision(noteId: string, revisionId: string): Promise<RevisionDetail> {
  const viewerId = getActiveViewerId();
  if (!viewerId) throw new Error('No active account');
  const response = await apiClient.get<{
    version: { id: string; createdAt: string };
    blocks: RevisionDetail['blocks'];
  }>(API_ROUTES.notes.revision(noteId, revisionId), { expectedViewerId: viewerId });
  return { ...response.data.version, blocks: response.data.blocks };
}
