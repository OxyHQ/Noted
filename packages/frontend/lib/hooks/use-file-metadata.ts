import React from 'react';
import { getErrorStatus } from '@oxy.so/core';
import { attachmentMetadataKey, readScopedStorage } from '@/lib/shared-storage';
import { useQuery } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services/ui/client';

/**
 * Whether Oxy still serves an attachment's file. Only `active` is served
 * (Oxy ADR 0043 D5): a file in its owner's trash, taken down (`blocked`) or
 * deleted is not, whatever note still names it.
 */
export type AttachmentAvailability = 'available' | 'trash' | 'unavailable';

/**
 * The subset of Oxy asset metadata the attachment UI needs, from
 * `GET /assets/:id` (`{ file: { id, originalName, mime, size, status, … } }`).
 */
export interface OxyFileMeta {
  id: string;
  filename?: string;
  contentType?: string;
  length?: number;
  availability: AttachmentAvailability;
}

function availabilityOf(status: unknown): AttachmentAvailability {
  if (status === undefined || status === 'active') return 'available';
  return status === 'trash' ? 'trash' : 'unavailable';
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

/**
 * Narrow an unknown asset response into `OxyFileMeta` with runtime guards. The
 * API's names are `originalName`, `mime` and `size`; the older
 * `filename`/`contentType`/`length` spelling is still read.
 */
export function parseFileMeta(response: unknown, fileId: string): OxyFileMeta {
  // The asset endpoint returns `{ file: {...} }`; tolerate a flat object too.
  const root =
    response && typeof response === 'object' ? (response as Record<string, unknown>) : {};
  const fileNode = root.file;
  const source =
    fileNode && typeof fileNode === 'object' ? (fileNode as Record<string, unknown>) : root;

  const size = typeof source.size === 'number' ? source.size : source.length;
  return {
    id: text(source.id) ?? fileId,
    filename: text(source.originalName) ?? text(source.filename),
    contentType: text(source.mime) ?? text(source.contentType),
    length: typeof size === 'number' ? size : undefined,
    availability: availabilityOf(source.status),
  };
}

/**
 * Fetch Oxy file metadata (filename / contentType / size / availability) for a
 * stored file ID. Used to render attachment chips, to detect whether an
 * attachment is an image, and to show one whose file is gone as unavailable
 * instead of a broken image. Cached within the current account/session only.
 */
export function useFileMetadata(fileId: string) {
  const { oxyServices, isAuthenticated, user, activeSessionId } = useOxy();
  const identity = { accountId: user?.id ?? null, sessionId: activeSessionId ?? null };
  const current = React.useRef(identity);
  current.current = identity;
  return useQuery<OxyFileMeta>({
    queryKey: attachmentMetadataKey(identity, fileId),
    queryFn: () =>
      readScopedStorage(
        identity,
        () => current.current,
        async () => {
          try {
            return parseFileMeta(await oxyServices.assets.get(fileId), fileId);
          } catch (error) {
            // Deleted (or never this account's to see): an answer, not a failure
            // to retry.
            if (getErrorStatus(error) === 404) return { id: fileId, availability: 'unavailable' };
            throw error;
          }
        },
      ),
    enabled: !!fileId && isAuthenticated && !!identity.accountId && !!identity.sessionId,
    // A file can move to the trash or be taken down while the note is open.
    staleTime: 1000 * 60 * 5,
    gcTime: 0,
    retry: 1,
  });
}
