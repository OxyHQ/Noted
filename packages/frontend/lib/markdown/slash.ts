/**
 * The "/" menu: type `/` at the start of a line (or after a space) to insert a
 * block — heading, list, quote, code, divider — without leaving the keyboard.
 *
 * Pure: finding the slash, narrowing the list as the person types, and turning
 * the choice into an edit are all functions of (text, caret), so they are tested
 * without a browser. The web editor renders the list and forwards the keys.
 */

import { BLOCK_PREFIX, type Edit, toggleCodeBlock } from './commands';

export interface SlashContext {
  /** Offset of the `/` itself. */
  start: number;
  /** What was typed after it. */
  query: string;
}

/**
 * The slash command the caret is inside, or null.
 *
 * Only a `/` that begins a word counts — at the start of a line or after
 * whitespace — and only while no space has been typed after it. A `/` inside a
 * path or a URL (`and/or`, `https://x`) is just text, and a menu that opened on
 * every one of them would be one nobody could type around.
 */
export function slashContext(text: string, caret: number): SlashContext | null {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
  const beforeCaret = text.slice(lineStart, caret);
  const match = /(^|\s)\/([^\s/]*)$/.exec(beforeCaret);
  if (!match) return null;
  const slashAt = lineStart + match.index + match[1].length;
  return { start: slashAt, query: match[2] };
}

export interface SlashCommand {
  id: SlashCommandId;
  /** Extra words that find it: "todo" finds the task list. */
  keywords: readonly string[];
  apply: (text: string, caret: number) => Edit;
}

export const SLASH_COMMAND_IDS = [
  'h1',
  'h2',
  'h3',
  'bullets',
  'numbers',
  'tasks',
  'quote',
  'code',
  'divider',
] as const;
export type SlashCommandId = (typeof SLASH_COMMAND_IDS)[number];

const at = (caret: number) => ({ start: caret, end: caret });

/**
 * Give the caret's line a block prefix, replacing any it already has.
 *
 * Not `toggleLinePrefix`: that skips blank lines on purpose (a selection over
 * three bullets should not bullet the gaps), but the line a slash command runs
 * on IS blank — the `/query` was just removed from it.
 */
function setLinePrefix(prefix: string) {
  return (text: string, caret: number): Edit => {
    const from = text.lastIndexOf('\n', caret - 1) + 1;
    const nextBreak = text.indexOf('\n', caret);
    const to = nextBreak === -1 ? text.length : nextBreak;
    const line = text.slice(from, to);
    const body = line.replace(BLOCK_PREFIX, '');
    const dropped = line.length - body.length;
    const offset = Math.max(0, caret - from - dropped);
    return {
      text: text.slice(0, from) + prefix + body + text.slice(to),
      selection: at(from + prefix.length + Math.min(offset, body.length)),
    };
  };
}

/** A fenced block on an empty line, with the caret inside it. */
function emptyCodeBlock(text: string, caret: number): Edit {
  const from = text.lastIndexOf('\n', caret - 1) + 1;
  const nextBreak = text.indexOf('\n', caret);
  const to = nextBreak === -1 ? text.length : nextBreak;
  if (text.slice(from, to).trim() !== '') return toggleCodeBlock(text, at(caret));
  const fence = '```\n\n```';
  return { text: text.slice(0, from) + fence + text.slice(to), selection: at(from + 4) };
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { id: 'h1', keywords: ['heading', 'title', 'h1'], apply: setLinePrefix('# ') },
  {
    id: 'h2',
    keywords: ['heading', 'subtitle', 'h2'],
    apply: setLinePrefix('## '),
  },
  { id: 'h3', keywords: ['heading', 'h3'], apply: setLinePrefix('### ') },
  {
    id: 'bullets',
    keywords: ['list', 'bullet', 'unordered'],
    apply: setLinePrefix('- '),
  },
  {
    id: 'numbers',
    keywords: ['list', 'ordered', 'numbered'],
    apply: setLinePrefix('1. '),
  },
  {
    id: 'tasks',
    keywords: ['todo', 'checkbox', 'checklist', 'task'],
    apply: setLinePrefix('- [ ] '),
  },
  {
    id: 'quote',
    keywords: ['blockquote', 'cite'],
    apply: setLinePrefix('> '),
  },
  {
    id: 'code',
    keywords: ['snippet', 'fence', 'block'],
    apply: emptyCodeBlock,
  },
  {
    id: 'divider',
    keywords: ['rule', 'line', 'separator', 'hr'],
    apply: (text, caret) => {
      const rule = '---\n';
      return {
        text: text.slice(0, caret) + rule + text.slice(caret),
        selection: at(caret + rule.length),
      };
    },
  },
];

/**
 * The commands that fit what was typed, best first.
 *
 * `labels` is the translated name of each command: the person types what they
 * see, so the label is matched along with the id and the English keywords.
 * A name that STARTS with the query ranks above one that merely contains it.
 */
export function filterSlashCommands(
  query: string,
  labels: Readonly<Record<SlashCommandId, string>>,
): SlashCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...SLASH_COMMANDS];

  const scored: { command: SlashCommand; score: number }[] = [];
  for (const command of SLASH_COMMANDS) {
    const label = labels[command.id].toLowerCase();
    const words = [command.id, label, ...command.keywords];
    if (label.startsWith(needle) || command.id.startsWith(needle)) {
      scored.push({ command, score: 0 });
    } else if (words.some((word) => word.includes(needle))) {
      scored.push({ command, score: 1 });
    }
  }
  // Stable within a score, so the list keeps the order the menu was written in.
  return scored.sort((a, b) => a.score - b.score).map((entry) => entry.command);
}

/**
 * Remove the `/query` the person typed and apply `command` where it was.
 * The caret is the end of what was typed, i.e. where the query stops.
 */
export function applySlashCommand(
  text: string,
  context: SlashContext,
  caret: number,
  command: SlashCommand,
): Edit {
  const without = text.slice(0, context.start) + text.slice(caret);
  return command.apply(without, context.start);
}
