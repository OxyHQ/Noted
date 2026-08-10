/**
 * Where a click on the rendered note lands in the Markdown behind it.
 *
 * A note is read as a document and edited as text, and those are two different
 * strings: `## Decisions` renders as "Decisions", `- uno` as "uno", `[Oxy](url)`
 * as "Oxy". So the browser can tell us the caret fell after 42 rendered
 * characters, and 42 is meaningless to the field the user is about to type in.
 *
 * This aligns the two. Rendered text is very nearly a subsequence of the
 * Markdown it came from — the renderer removes syntax and keeps content — so
 * walking the rendered prefix and advancing through the Markdown to match it
 * gives the offset the field needs.
 *
 * ## What this is not
 *
 * It is an alignment, not a parse. It does not know a heading from a link; it
 * knows the characters the reader can see are in there somewhere, in order. Two
 * consequences worth stating rather than discovering:
 *
 * - A character the RENDERER added, which is in no Markdown at all, is skipped
 *   rather than hunted for. Otherwise one invented bullet glyph would drag the
 *   whole alignment to wherever that glyph next appeared.
 * - A run of syntax longer than `MAX_SYNTAX_RUN` — a URL longer than a
 *   paragraph, say — ends the alignment where it stands.
 *
 * The failure mode is therefore a caret a few characters off, in a field the
 * user can immediately move it in. That is the right trade against the
 * alternative this replaced, which was every click jumping to the end of the
 * note.
 */

/**
 * How far the alignment will scan for the next visible character.
 *
 * It has to clear the longest run of invisible Markdown between two visible
 * characters, which in practice is a link's URL. It must NOT clear a paragraph,
 * or a character the renderer invented could match something a screen away.
 */
const MAX_SYNTAX_RUN = 256;

const isWhitespace = (char: string): boolean => /\s/.test(char);

/**
 * The offset in `markdown` corresponding to the end of `rendered`.
 *
 * `rendered` is the visible text from the start of the note up to the caret —
 * what `Range.toString()` returns for a range ending where the user clicked.
 */
export function markdownOffsetForRenderedPrefix(markdown: string, rendered: string): number {
  let cursor = 0;

  for (let index = 0; index < rendered.length; index += 1) {
    const char = rendered[index];

    // Whitespace survives rendering but not its exact shape: a blank line
    // between paragraphs is one newline here and two there. Any run matches any
    // run, which keeps blocks aligned without pretending to know their layout.
    if (isWhitespace(char)) {
      while (index + 1 < rendered.length && isWhitespace(rendered[index + 1])) index += 1;
      while (cursor < markdown.length && isWhitespace(markdown[cursor])) cursor += 1;
      continue;
    }

    const found = markdown.indexOf(char, cursor);
    if (found === -1 || found - cursor > MAX_SYNTAX_RUN) continue;
    cursor = found + 1;
  }

  return cursor;
}
