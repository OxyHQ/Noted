/**
 * Handing the file to the user, in a browser.
 *
 * A download, driven by an anchor the page clicks for itself. There is no
 * dependency here on purpose: the platform already does this, and the file
 * never leaves the machine — which for a meeting transcript is the whole point.
 */

/** Told to save rather than to render. */
const MIME_TYPES = {
  markdown: 'text/markdown;charset=utf-8',
  json: 'application/json;charset=utf-8',
} as const;

export function saveTextFile(
  filename: string,
  contents: string,
  kind: 'markdown' | 'json' = 'markdown',
): Promise<void> {
  return download(filename, new Blob([contents], { type: MIME_TYPES[kind] }));
}

export function saveBinaryFile(
  filename: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<void> {
  return download(filename, new Blob([bytes as BlobPart], { type: mimeType }));
}

function download(filename: string, blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;

  // Appended before clicking: a detached anchor is ignored by Firefox, which is
  // the kind of difference that turns into "the button does nothing" on one
  // browser and works everywhere the developer tested.
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Revoking immediately can cancel the download in progress; a task later is
  // after the browser has taken what it needs.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return Promise.resolve();
}
