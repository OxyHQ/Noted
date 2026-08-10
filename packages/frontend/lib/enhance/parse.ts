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

import type {
  Enhancement,
  EnhancementBlock,
  EnhancementListItem,
  EnhancementPerson,
  EnhancementSection,
} from '@/lib/enhance/contract';
import type { CaptureProfile } from '@/lib/artifact/types';
import { BLOCK_TYPES, FIELDS, SCHEMA_PROFILES } from '@/lib/enhance/schema';

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

  const wanted = subject.trim().toLowerCase();
  const match = authorised.find(
    (candidate) =>
      candidate === wanted || wanted.includes(candidate) || candidate.includes(wanted),
  );
  // The model helping itself. Not a formatting slip — the item is refused.
  if (!match || wanted === '') return 'unauthorised';
  return { subject: match, reason: cleanLine(reason) };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readText(value: unknown): string {
  const text = typeof value === 'string' ? cleanLine(value) : '';
  return text.length > MAX_ITEM_CHARS ? '' : text;
}

/**
 * Read a list of items.
 *
 * A bare string is accepted as an item, and a bare string in place of the whole
 * list as a one-item list: asked for a list, a small model with one thing to say
 * often just says it, and refusing that would throw away a correct answer over
 * its shape.
 */
function readItems(value: unknown, options: ParseOptions): EnhancementListItem[] {
  const raw = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  const items: EnhancementListItem[] = [];

  for (const entry of raw) {
    const fields = record(entry);
    const text = readText(typeof entry === 'string' ? entry : fields?.[FIELDS.text]);
    if (text === '') continue;
    // Repeats are the most common way a small model fills a list it has nothing
    // left to put in.
    if (items.some((existing) => existing.text.toLowerCase() === text.toLowerCase())) continue;

    const derived = readDerived(fields?.[FIELDS.derived], options.authorisedSubjects);
    if (derived === 'unauthorised') continue;

    items.push({
      text,
      sources: readSources(fields?.[FIELDS.sources], options.lineCount),
      ...(derived ? { derived } : {}),
    });
    if (items.length === MAX_ITEMS) break;
  }
  return items;
}

/**
 * Read one block, or refuse it.
 *
 * A block whose type is unknown is dropped rather than guessed at: rendering an
 * unrecognised type as a paragraph would silently turn a list the model meant
 * into prose, and a note that quietly restructures itself is worse than one
 * missing a piece.
 */
function readBlock(value: unknown, options: ParseOptions): EnhancementBlock | null {
  const fields = record(value);
  if (!fields) {
    // A bare string where a block was asked for is a paragraph. Small models do
    // this constantly and the meaning is not in doubt.
    const text = readText(value);
    return text === '' ? null : { type: 'paragraph', text, sources: [] };
  }

  const type = fields[FIELDS.type];
  if (typeof type !== 'string' || !(BLOCK_TYPES as readonly string[]).includes(type)) return null;
  const sources = readSources(fields[FIELDS.sources], options.lineCount);

  if (type === 'bullet-list' || type === 'numbered-list') {
    const items = readItems(fields[FIELDS.items], options);
    return items.length > 0 ? { type, items, sources } : null;
  }

  const text = readText(fields[FIELDS.text]);
  if (text === '') return null;
  const rawAttribution = fields[FIELDS.attribution];
  const attribution = typeof rawAttribution === 'string' ? cleanLine(rawAttribution) : '';
  return {
    type: type as 'paragraph' | 'quote',
    text,
    sources,
    ...(attribution === '' ? {} : { attribution }),
  };
}

function readSections(value: unknown, options: ParseOptions): EnhancementSection[] {
  if (!Array.isArray(value)) return [];
  const sections: EnhancementSection[] = [];
  for (const entry of value) {
    const fields = record(entry);
    if (!fields) continue;
    const blocks = Array.isArray(fields[FIELDS.blocks])
      ? (fields[FIELDS.blocks] as unknown[])
          .map((block) => readBlock(block, options))
          .filter((block): block is EnhancementBlock => block !== null)
      : [];
    if (blocks.length === 0) continue;
    const rawHeading = fields[FIELDS.heading];
    const heading = typeof rawHeading === 'string' ? cleanLine(rawHeading) : '';
    sections.push({ blocks, ...(heading === '' ? {} : { heading }) });
    if (sections.length === MAX_ITEMS) break;
  }
  return sections;
}

/**
 * Read the people the model named.
 *
 * An entry with no name, role or organisation is dropped: an empty person is not
 * information, and rendering one would put a bare "Speaker:" over a note.
 */
function readPeople(value: unknown, options: ParseOptions): EnhancementPerson[] {
  if (!Array.isArray(value)) return [];
  const people: EnhancementPerson[] = [];
  for (const entry of value) {
    const fields = record(entry);
    if (!fields) continue;
    const person: EnhancementPerson = {
      sources: readSources(fields[FIELDS.sources], options.lineCount),
    };
    for (const key of ['name', 'role', 'organization'] as const) {
      const text = readText(fields[key]);
      if (text !== '') person[key] = text;
    }
    if (person.name ?? person.role ?? person.organization) people.push(person);
  }
  return people;
}

function readProfile(value: unknown): CaptureProfile | undefined {
  return typeof value === 'string' && (SCHEMA_PROFILES as readonly string[]).includes(value)
    ? (value as CaptureProfile)
    : undefined;
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
  const fields = record(parsed);
  if (!fields) return null;

  const enhancement: Enhancement = {
    profile: readProfile(fields[FIELDS.profile]),
    title: readTitle(fields[FIELDS.title]),
    people: readPeople(fields[FIELDS.people], options),
    sections: readSections(fields[FIELDS.sections], options),
    actions: readItems(fields[FIELDS.actions], options),
    openQuestions: readItems(fields[FIELDS.openQuestions], options),
    listAdditions: readItems(fields[FIELDS.listAdditions], options),
  };

  // A reply with a title and nothing else is a model that had nothing to say
  // about the recording. The rule-based note is better than a heading over
  // emptiness, so this counts as no answer.
  const hasContent =
    enhancement.sections.length > 0 ||
    enhancement.actions.length > 0 ||
    enhancement.openQuestions.length > 0 ||
    enhancement.listAdditions.length > 0;

  return hasContent ? enhancement : null;
}
