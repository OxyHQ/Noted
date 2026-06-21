import { useQuery } from "@tanstack/react-query";
import { useOxy } from "@oxyhq/services";

/**
 * The subset of Oxy asset metadata the attachment UI needs. `assetGet` is typed
 * `any` in the SDK and returns the metadata nested under a `file` key
 * (`{ file: { id, filename, contentType, length, ... } }`), so we parse it into
 * this typed shape with runtime guards rather than casting.
 */
export interface OxyFileMeta {
  id: string;
  filename?: string;
  contentType?: string;
  length?: number;
}

/** Narrow an unknown asset response into `OxyFileMeta` using typeof guards. */
function parseFileMeta(response: unknown, fileId: string): OxyFileMeta {
  // The asset endpoint returns `{ file: {...} }`; tolerate a flat object too.
  const root =
    response && typeof response === "object"
      ? (response as Record<string, unknown>)
      : {};
  const fileNode = root.file;
  const source =
    fileNode && typeof fileNode === "object"
      ? (fileNode as Record<string, unknown>)
      : root;

  const id = typeof source.id === "string" ? source.id : fileId;
  const filename =
    typeof source.filename === "string" ? source.filename : undefined;
  const contentType =
    typeof source.contentType === "string" ? source.contentType : undefined;
  const length = typeof source.length === "number" ? source.length : undefined;

  return { id, filename, contentType, length };
}

/**
 * Fetch immutable Oxy file metadata (filename / contentType / size) for a stored
 * file ID. Used to render non-image attachment chips and to detect whether an
 * attachment is an image. Metadata never changes for a given ID, so it is cached
 * aggressively.
 */
export function useFileMetadata(fileId: string) {
  const { oxyServices, isAuthenticated } = useOxy();
  return useQuery<OxyFileMeta>({
    queryKey: ["file-metadata", fileId],
    queryFn: async () => parseFileMeta(await oxyServices.assetGet(fileId), fileId),
    enabled: !!fileId && isAuthenticated,
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 1,
  });
}
