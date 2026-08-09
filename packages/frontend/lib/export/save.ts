/**
 * Handing the file to the user — the neutral build.
 *
 * Metro resolves `save.native.ts` on a phone and `save.web.ts` in a browser,
 * because "give someone a file" is a different act on each: a share sheet there,
 * a download here. This file is what a non-Metro resolver gets, and it refuses
 * rather than pretending, since a silent no-op looks exactly like a save that
 * worked.
 */

export function saveTextFile(_filename: string, _contents: string): Promise<void> {
  return Promise.reject(new Error('saving a file is not supported on this platform'));
}
