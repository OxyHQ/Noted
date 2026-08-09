/**
 * Handing the file to the user, in a browser.
 *
 * A download, driven by an anchor the page clicks for itself. There is no
 * dependency here on purpose: the platform already does this, and the file
 * never leaves the machine — which for a meeting transcript is the whole point.
 */

/** Markdown, told to save rather than to render. */
const MIME_TYPE = 'text/markdown;charset=utf-8';

export function saveTextFile(filename: string, contents: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([contents], { type: MIME_TYPE }));
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
