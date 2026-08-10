/**
 * Reading what the model sent back.
 *
 * This is the boundary between a model's sloppiness and the user's note, and it
 * is the one place in the enhancement path where being permissive is dangerous:
 * whatever comes out of here is what replaces the deterministic note. So the rule
 * is that a field is used only when it is unmistakably what it claims to be, and
 * anything else is dropped rather than guessed at.
 *
 * Small models on a phone are what is being parsed here, and they routinely wrap
 * JSON in code fences, add a sentence before it, emit a single string where a
 * list was asked for, or leave a field out. None of that is a failure worth
 * showing a user — the note already exists — so each is recovered from where the
 * meaning is not in doubt, and the whole reply is refused where it is.
 *
 * ## Two things are checked rather than believed
 *
 * A source reference to a line the model was never shown is dropped. It is a
 * fabricated citation, and a citation a reader can follow to the wrong moment is
 * worse than no citation — it costs them their trust in every other one.
 *
 * A `derived` item claiming a subject nobody authorised is dropped entirely,
 * item and all. That field is the only route by which knowledge the recording
 * does not contain may enter a note; an unauthorised one is the model helping
 * itself, which is exactly what the whole origin mechanism exists to prevent.
 */

import type { Enhancement, EnhancementItem } from '@/lib/enhance/contract';

/** Longest reply worth parsing. Beyond this the model is not answering. */
const MAX_REPLY_CHARS = 20_000;

/** Beyond this a "bullet" is a paragraph, and the model has ignored the brief. */
const MAX_ITEM_CHARS = 400;

/** More than this is a transcript, not a summary. */
const MAX_ITEMS = 20;

/**
 * Pull the JSON object out of a reply that may be wrapped in prose or fences.
 *
 * Scans for the first balanced `{…}` rather than taking the first and last brace:
 * a model that adds a sentence containing a brace after valid JSON would
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

export interface ParseOptions {
  /** How many transcript lines the model was shown, so a citation can be checked. */
  lineCount: number;
  /** The subjects it was authorised to expand, lower-cased for comparison. */
  authorisedSubjects: readonly string[];
}

/**
 * The line numbers an item cites, minus the ones that do not exist.
 *
 * Dropped silently rather than refused: an item with a hallucinated citation is
 * usually still a real note about the recording, and throwing it away costs the
 * user more than showing it ungrounded does. What must never happen is the
 * citation being believed.
 */
function readSources(value: unknown, lineCount: number): number[] {
  const raw = Array.isArray(value) ? value : typeof value === 'number' ? [value] : [];
  const sources: number[] = [];
  for (const entry of raw) {
    const line = typeof entry === 'number' ? entry : Number(entry);
    if (!Number.isInteger(line) || line < 1 || line > lineCount) continue;
    if (!sources.includes(line)) sources.push(line);
  }
  return sources;
}

function readDerived(
  value: unknown,
  authorised: readonly string[],
): { subject: string; reason: string } | null | 'unauthorised' {
  if (value === undefined || value === null) return null;

  const subject =
    typeof value === 'string'
      ? value
      : typeof value === 'object' && 'subject' in value
        ? String((value as { subject: unknown }).subject)
        : '';
  const reason =
    typeof value === 'object' && value !== null && 'reason' in value
      ? String((value as { reason: unknown }).reason)
      : '';

  const match = authorised.find(
    (candidate) =>
      candidate === subject.trim().toLowerCase() ||
      subject.trim().toLowerCase().includes(candidate) ||
      candidate.includes(subject.trim().toLowerCase()),
  );
  // The model helping itself. Not a formatting slip — the item is refused.
  if (!match || subject.trim() === '') return 'unauthorised';
  return { subject: match, reason: cleanLine(reason) };
}

/**
 * Read a field that should be a list of items.
 *
 * A bare string is accepted as an item with no sources, and a bare string in
 * place of the whole list as a one-item list: asked for a list, a small model
 * with one thing to say often just says it, and refusing that would throw away a
 * correct answer over its shape.
 */
function readItems(value: unknown, options: ParseOptions): EnhancementItem[] {
  const raw = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  const items: EnhancementItem[] = [];

  for (const entry of raw) {
    const record = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : null;
    const rawText = typeof entry === 'string' ? entry : typeof record?.text === 'string' ? record.text : '';
    const text = cleanLine(rawText);
    if (text === '' || text.length > MAX_ITEM_CHARS) continue;

    // Repeats are the most common way a small model fills a list it has nothing
    // left to put in.
    if (items.some((existing) => existing.text.toLowerCase() === text.toLowerCase())) continue;

    const derived = readDerived(record?.derived, options.authorisedSubjects);
    if (derived === 'unauthorised') continue;

    items.push({
      text,
      sources: readSources(record?.s ?? record?.sources, options.lineCount),
      ...(derived ? { derived } : {}),
    });
    if (items.length === MAX_ITEMS) break;
  }
  return items;
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
 * @returns null when nothing usable came back. The caller keeps the deterministic
 *   note, so null costs the user nothing.
 */
export function parseEnhancement(reply: string, options: ParseOptions): Enhancement | null {
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
    notes: readItems(record.notes, options),
    actions: readItems(record.actions, options),
    openQuestions: readItems(record.openQuestions, options),
    listAdditions: readItems(record.listAdditions, options),
  };

  // A reply with a title and nothing else is a model that had nothing to say
  // about the recording. The rule-based note is better than a heading over
  // emptiness, so this counts as no answer.
  const hasContent =
    enhancement.notes.length > 0 ||
    enhancement.actions.length > 0 ||
    enhancement.openQuestions.length > 0 ||
    enhancement.listAdditions.length > 0;

  return hasContent ? enhancement : null;
}
