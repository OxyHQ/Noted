/**
 * Formatting a Markdown note by editing its text.
 *
 * Pure functions from (text, selection) to (text, selection), so what a toolbar
 * button does is testable without a browser. The editor on the web is a plain
 * field holding Markdown; these are the only place that knows what "bold" or "a
 * bullet list" means to it. (The phone's editor formats through the native
 * library's own menu.)
 *
 * Every command returns where the selection should be afterwards, because
 * applying a format that leaves the caret somewhere unexpected is the difference
 * between a toolbar and a nuisance.
 */

export interface Selection {
  start: number;
  end: number;
}

export interface Edit {
  text: string;
  selection: Selection;
}

function clamp(text: string, selection: Selection): Selection {
  const start = Math.max(0, Math.min(selection.start, text.length));
  const end = Math.max(start, Math.min(selection.end, text.length));
  return { start, end };
}

/* ── Inline marks ──────────────────────────────────────────────── */

/**
 * Wrap the selection in `marker` (`**`, `*`, `~~`, `` ` ``), or take it off when
 * it is already wrapped.
 *
 * "Already wrapped" is checked both ways a person gets there: the marker sits
 * just OUTSIDE the selection (they selected the word inside `**word**`) or just
 * INSIDE it (they selected the whole `**word**`). An empty selection inserts the
 * pair and leaves the caret between, ready to type.
 */
export function toggleWrap(text: string, rawSelection: Selection, marker: string): Edit {
  const { start, end } = clamp(text, rawSelection);
  const width = marker.length;
  const selected = text.slice(start, end);

  const outside =
    start >= width &&
    text.slice(start - width, start) === marker &&
    text.slice(end, end + width) === marker &&
    isActive(marker, runBefore(text, start, '*'), runAfter(text, end, '*'));
  if (outside) {
    return {
      text: text.slice(0, start - width) + selected + text.slice(end + width),
      selection: { start: start - width, end: end - width },
    };
  }

  const inside =
    selected.length >= width * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker) &&
    isActive(marker, leadingRun(selected, '*'), trailingRun(selected, '*'));
  if (inside) {
    const unwrapped = selected.slice(width, selected.length - width);
    return {
      text: text.slice(0, start) + unwrapped + text.slice(end),
      selection: { start, end: start + unwrapped.length },
    };
  }

  return {
    text: text.slice(0, start) + marker + selected + marker + text.slice(end),
    selection: { start: start + width, end: end + width },
  };
}

/* `*` is shared by two marks, so "is this mark on?" cannot be answered by looking
 * at the characters next to the text, only at how many of them there are in a
 * row: `*x*` is italic, `**x**` is bold, `***x***` is both. Italic is on when the
 * run is odd and bold when it is two or more; wrapping italic around `**x**`
 * therefore makes `***x***` instead of stripping the bold. Other markers
 * (`~~`, `` ` ``) have no such overlap. */

function runBefore(text: string, index: number, char: string): number {
  let count = 0;
  while (index - count - 1 >= 0 && text[index - count - 1] === char) count += 1;
  return count;
}

function runAfter(text: string, index: number, char: string): number {
  let count = 0;
  while (index + count < text.length && text[index + count] === char) count += 1;
  return count;
}

function leadingRun(text: string, char: string): number {
  return runAfter(text, 0, char);
}

function trailingRun(text: string, char: string): number {
  return runBefore(text, text.length, char);
}

function isActive(marker: string, before: number, after: number): boolean {
  if (marker !== '*' && marker !== '**') return true;
  const run = Math.min(before, after);
  return marker === '*' ? run % 2 === 1 : run >= 2;
}

/** Turn the selection (or an empty one) into `[text](url)`, selecting the text. */
export function insertLink(text: string, rawSelection: Selection, url: string): Edit {
  const { start, end } = clamp(text, rawSelection);
  const label = text.slice(start, end) || url;
  const link = `[${label}](${url})`;
  return {
    text: text.slice(0, start) + link + text.slice(end),
    selection: { start: start + 1, end: start + 1 + label.length },
  };
}

/* ── Line-level blocks ─────────────────────────────────────────── */

/** The start and end offsets of every line the selection touches. */
function selectedLines(text: string, { start, end }: Selection): { from: number; to: number } {
  const from = text.lastIndexOf('\n', start - 1) + 1;
  // A selection that ends at the very start of a line did not select that line.
  const probe = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const nextBreak = text.indexOf('\n', probe);
  return { from, to: nextBreak === -1 ? text.length : nextBreak };
}

const BLOCK_PREFIX = /^(#{1,6} |> |- \[[ xX]\] |- |\* |\+ |\d+\. )/;

/** Apply `change` to each selected line and keep the selection on the same text. */
function mapLines(
  text: string,
  rawSelection: Selection,
  change: (line: string, index: number) => string,
): Edit {
  const selection = clamp(text, rawSelection);
  const { from, to } = selectedLines(text, selection);
  const lines = text.slice(from, to).split('\n');
  const changed = lines.map(change);
  const next = text.slice(0, from) + changed.join('\n') + text.slice(to);

  // The first line's growth moves the start; the total growth moves the end.
  const startShift = changed[0].length - lines[0].length;
  const totalShift = changed.join('\n').length - lines.join('\n').length;
  return {
    text: next,
    selection: {
      start: Math.max(from, selection.start + startShift),
      end: Math.max(from, selection.end + totalShift),
    },
  };
}

/**
 * Put `prefix` (`- `, `> `, `- [ ] `) on each selected line, or take it off when
 * every non-blank line already has it. A different block marker on the line is
 * replaced rather than stacked: `> ` on a bullet makes a quote, not a quoted bullet.
 */
export function toggleLinePrefix(text: string, selection: Selection, prefix: string): Edit {
  const { from, to } = selectedLines(text, clamp(text, selection));
  const lines = text
    .slice(from, to)
    .split('\n')
    .filter((line) => line.trim() !== '');
  const allHave = lines.length > 0 && lines.every((line) => line.startsWith(prefix));

  return mapLines(text, selection, (line) => {
    if (line.trim() === '') return line;
    if (allHave) return line.slice(prefix.length);
    return prefix + line.replace(BLOCK_PREFIX, '');
  });
}

/** Number the selected lines `1.`, `2.`…, or remove the numbers if they all have one. */
export function toggleNumberedList(text: string, selection: Selection): Edit {
  const { from, to } = selectedLines(text, clamp(text, selection));
  const lines = text
    .slice(from, to)
    .split('\n')
    .filter((line) => line.trim() !== '');
  const allHave = lines.length > 0 && lines.every((line) => /^\d+\. /.test(line));

  let number = 0;
  return mapLines(text, selection, (line) => {
    if (line.trim() === '') return line;
    if (allHave) return line.replace(/^\d+\. /, '');
    number += 1;
    return `${number}. ${line.replace(BLOCK_PREFIX, '')}`;
  });
}

/** Make the selected lines a heading of `level` (1–6), or plain text if already that level. */
export function toggleHeading(text: string, selection: Selection, level: number): Edit {
  const hashes = '#'.repeat(Math.max(1, Math.min(6, level)));
  return toggleLinePrefix(text, selection, `${hashes} `);
}

/** Wrap the selection in a fenced code block, or unwrap one that already surrounds it. */
export function toggleCodeBlock(text: string, rawSelection: Selection): Edit {
  const { start, end } = clamp(text, rawSelection);
  const { from, to } = selectedLines(text, { start, end });
  const block = text.slice(from, to);

  const fenced = /^```[^\n]*\n([\s\S]*)\n```$/.exec(block);
  if (fenced) {
    return {
      text: text.slice(0, from) + fenced[1] + text.slice(to),
      selection: { start: from, end: from + fenced[1].length },
    };
  }
  const wrapped = `\`\`\`\n${block}\n\`\`\``;
  return {
    text: text.slice(0, from) + wrapped + text.slice(to),
    selection: { start: from + 4, end: from + 4 + block.length },
  };
}
