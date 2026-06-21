/**
 * Attachment helpers — map an Oxy file's `contentType` (MIME) to a coarse
 * category used to pick an icon / decide image-vs-chip rendering, plus a small
 * human-readable byte formatter for file-size labels.
 *
 * The stored note `attachments` array is just file IDs; the contentType is
 * resolved per-file at render time (see `use-file-metadata`).
 */

export type AttachmentCategory =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "doc"
  | "file";

/** Word/Excel/PowerPoint/plain-text MIME types that render as a "document" chip. */
const DOC_MIME_TYPES = new Set<string>([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

/**
 * Classify a MIME type into a coarse attachment category. Unknown / missing
 * types fall back to the generic `"file"` bucket.
 */
export function categorizeContentType(
  contentType: string | undefined
): AttachmentCategory {
  if (!contentType) return "file";
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  if (contentType === "application/pdf") return "pdf";
  if (
    contentType.startsWith("text/") ||
    contentType.includes("wordprocessingml") ||
    contentType.includes("spreadsheetml") ||
    contentType.includes("presentationml") ||
    DOC_MIME_TYPES.has(contentType)
  ) {
    return "doc";
  }
  return "file";
}

/** Format a byte count as a compact human-readable size (e.g. `12 KB`, `3.4 MB`). */
export function humanizeSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
}
