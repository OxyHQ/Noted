/**
 * Where a capture's native audio lives: `captures/<captureId>` under the app's
 * documents, one directory per capture.
 *
 * Writers and the eraser both derive the path here, so the directory that is
 * written is the directory that is deleted. Ids are minted locally as UUIDs and
 * are never reused, so a directory named for a capture holds only that capture's
 * files. The id is still validated: it becomes a path segment, and a `..` or a
 * slash there would turn a delete into somebody else's directory.
 */

export const CAPTURES_ROOT = 'captures';

const SAFE_CAPTURE_ID = /^[0-9A-Za-z_-]{1,128}$/;

/** The path segments of a capture's own directory, relative to the documents root. */
export function captureDirectorySegments(captureId: string): [string, string] {
  if (!SAFE_CAPTURE_ID.test(captureId)) {
    throw new Error('Refusing to use an unsafe capture id');
  }
  return [CAPTURES_ROOT, captureId];
}

/**
 * The capture a stored audio reference names, or null when it is not in a form
 * this app wrote (a legacy or foreign path, which the caller must not touch).
 *
 * Recognises `audio:<id>` (browser-held chunks) and `captures/<id>/audio.<ext>`
 * (native files, as the recorders write them).
 */
export function captureIdOfAudioReference(reference: string): string | null {
  if (reference.startsWith('audio:')) return reference.slice('audio:'.length);
  const native = /^captures\/([^/]+)\/audio\.[a-z0-9]+$/.exec(reference);
  return native ? native[1] : null;
}
