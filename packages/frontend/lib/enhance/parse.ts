/**
 * Reading what the model sent back.
 *
 * This is the boundary between a model's sloppiness and the user's note, and it
 * is the one place in the enhancement path where being permissive is dangerous:
 * whatever comes out of here is what replaces the deterministic note. So the
 * rule is that a field is used only when it is unmistakably what it claims to
 * be, and anything else is dropped rather than guessed at.
 *
 * Small models on a phone are the ones being parsed here, and they routinely
 * wrap JSON in code fences, add a sentence before it, emit a single string where
 * a list was asked for, or leave a field out. None of that is a failure worth
 * showing a user — the note already exists — so each of those is recovered from
 * where the meaning is not in doubt, and the whole reply is refused where it is.
 */

import type { Enhancement } from '@/lib/enhance/contract';

/** Longest reply worth parsing. Beyond this the model is not answering. */
const MAX_REPLY_CHARS = 20_000;

/** Beyond this a "bullet" is a paragraph, and the model has ignored the brief. */
const MAX_ITEM_CHARS = 400;

/** More than this is a transcript, not a summary. */
const MAX_ITEMS = 20;

/**
 * Pull the JSON object out of a reply that may be wrapped in prose or fences.
 *
 * Scans for the first balanced `{…}` rather than taking the first and last
 * brace: a model that adds a sentence containing a brace after valid JSON would
 * otherwise turn a good reply into an unparseable one.
 */
function extractJsonObject(reply: string): string | null {
  const start = reply.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < reply.length; index += 1) {
    const character = reply[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    // Braces inside a string are text, not structure — a summary line reading
    // `use {id} here` would otherwise close the object early.
    if (inString) continue;

    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return reply.slice(start, index + 1);
    }
  }
  return null;
}

function cleanLine(value: string): string {
  return (
    value
      .trim()
      // Models mirror the bullet style of the prompt back into the strings.
      .replace(/^[-*•]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .trim()
  );
}

/**
 * Read a field that should be a list of short lines.
 *
 * A bare string is accepted as a one-item list: asked for a list, a small model
 * that has one thing to say often just says it, and refusing that would throw
 * away a correct answer over its shape.
 */
function readLines(value: unknown): string[] {
  const raw = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  const lines: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const line = cleanLine(entry);
    if (line === '' || line.length > MAX_ITEM_CHARS) continue;
    // Repeats are the most common way a small model fills a list it has nothing
    // left to put in.
    if (lines.some((existing) => existing.toLowerCase() === line.toLowerCase())) continue;
    lines.push(line);
    if (lines.length === MAX_ITEMS) break;
  }
  return lines;
}

function readTitle(value: unknown): string {
  if (typeof value !== 'string') return '';
  const title = cleanLine(value).replace(/^#+\s*/, '');
  // A "title" of paragraph length is the model answering the wrong question.
  return title.length <= 120 ? title : '';
}

/**
 * Turn a model's reply into an enhancement, or refuse it.
 *
 * @returns null when nothing usable came back. The caller keeps the
 *   deterministic note, so null costs the user nothing.
 */
export function parseEnhancement(reply: string): Enhancement | null {
  if (reply.length > MAX_REPLY_CHARS) return null;

  const json = extractJsonObject(reply);
  if (json === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const enhancement: Enhancement = {
    title: readTitle(record.title),
    notes: readLines(record.notes),
    actions: readLines(record.actions),
    openQuestions: readLines(record.openQuestions),
  };

  // A reply with a title and nothing else is a model that had nothing to say
  // about the meeting. The rule-based note is better than a heading over
  // emptiness, so this counts as no answer.
  const hasContent =
    enhancement.notes.length > 0 ||
    enhancement.actions.length > 0 ||
    enhancement.openQuestions.length > 0;

  return hasContent ? enhancement : null;
}
