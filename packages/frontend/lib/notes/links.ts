/**
 * `[[Note title]]` links between notes.
 *
 * A link names a note by its title, the way Obsidian does, so a link typed by
 * hand works and the text stays readable anywhere Markdown is. The cost is that
 * a link breaks when its target is renamed; backlinks are therefore computed
 * from the text on demand rather than stored, so there is no second copy to
 * fall out of step.
 */

/** `[[Title]]` or `[[Title|label]]`; the title may not contain brackets, pipes or newlines. */
const LINK = /\[\[([^[\]|\n]+?)(?:\|[^[\]\n]*)?\]\]/g;

/** The distinct note titles a text links to, in order of first appearance. */
export function linkTitles(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(LINK)) {
    const title = match[1].trim();
    if (title) seen.add(title);
  }
  return [...seen];
}

/** The link that points at a note, or null when it has no title to point at. */
export function linkTo(title: string): string | null {
  const clean = title
    .replace(/[[\]|\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? `[[${clean}]]` : null;
}

/** Add a link to the end of a body, on its own line. */
export function appendLink(body: string, link: string): string {
  if (body.trim() === '') return link;
  return `${body.replace(/\s+$/, '')}\n${link}`;
}
