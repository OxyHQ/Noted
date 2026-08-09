/**
 * Reading the Markdown this app writes.
 *
 * Deliberately not a Markdown engine. The structurer and the language model
 * produce a tiny, known subset — `## heading`, `- bullet`, and paragraphs — and
 * a general parser would be several hundred kilobytes to handle syntax nothing
 * here emits. Anything outside the subset is left as text rather than
 * mis-rendered, which is the behaviour that matters for whatever a user types
 * themselves.
 *
 * Pure, so the parsing is testable without a screen.
 */

export type MarkdownBlock =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'paragraph'; text: string };

const HEADING = /^(#{2,3})\s+(.*)$/;
const BULLET = /^[-*]\s+(.+)$/;

/**
 * Split Markdown into blocks.
 *
 * Consecutive non-empty lines that are neither headings nor bullets become one
 * paragraph, because that is how someone typing a note expects a wrapped
 * sentence to behave — a line break mid-sentence is not a new paragraph.
 */
export function parseBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flush = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };

  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim();

    if (line === '') {
      flush();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({
        kind: 'heading',
        level: heading[1].length === 2 ? 2 : 3,
        text: heading[2].trim(),
      });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      flush();
      blocks.push({ kind: 'bullet', text: bullet[1].trim() });
      continue;
    }

    paragraph.push(line);
  }

  flush();
  return blocks;
}

/**
 * Flatten Markdown into the one-or-two lines a note card shows.
 *
 * A card is a glance, and `## Summary` in a preview is syntax where prose
 * should be: it tells the reader nothing about the note and costs a line. So the
 * markers go and the text stays, in the order it appears.
 */
export function toPreviewText(markdown: string): string {
  return parseBlocks(markdown)
    .map((block) => block.text)
    .filter((text) => text !== '')
    .join(' · ');
}
