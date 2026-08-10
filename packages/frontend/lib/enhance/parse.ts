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
import type { CaptureProfile } from '@noted/shared-types';
import { BLOCK_TYPES, FIELDS, SCHEMA_PROFILES } from '@/lib/enhance/schema';

/** Longest reply worth parsing. Beyond this the model is not answering. */
const MAX_REPLY_CHARS = 20_000;

/**
 * How long each kind of document unit may be.
 *
 * One number used to cover all of them, and it was 400 — a limit written for
 * bullets, back when the reply was four arrays of short strings. `readText`
 * then started being used for paragraphs too, so a coherent explanatory
 * paragraph over 400 characters was silently replaced with the empty string and
 * dropped. If every paragraph in a reply crossed it, the whole model result
 * became `null`, and the user was told their DEVICE could not organise notes.
 *
 * A paragraph is not a long bullet. The units are listed separately because
 * they are different things, and because a single shared number cannot be
 * raised for one of them without loosening the rest.
 */
const LIMITS = {
  /** A title of paragraph length is the model answering the wrong question. */
  title: 120,
  heading: 200,
  /** Connected reasoning. The unit this whole limit family got wrong. */
  paragraph: 4_000,
  /** Somebody's exact words, which can run long in a talk. */
  quote: 2_000,
  /** A line of a list. Beyond this it is prose wearing a bullet. */
  listItem: 400,
  /** A person's name, role or organisation. */
  person: 200,
} as const;

/** More than this is a transcript, not a summary. */
const MAX_ITEMS = 20;

/** How many sections a document may have before it is just the transcript again. */
const MAX_SECTIONS = 20;

/** Blocks in one section. */
const MAX_BLOCKS_PER_SECTION = 40;

/**
 * Why a reply could not be used.
 *
 * `null` used to carry all of these, and the caller turned every one of them
 * into "this device cannot organize notes" — which is false for all but the
 * last and actively misleading for the first three, since they describe the
 * model's OUTPUT rather than the machine.
 */
export type ParseFailureReason =
  /** No `{` anywhere: the model answered in prose. */
  | 'no_json_object'
  /** A JSON object started and never closed — generation stopped mid-answer. */
  | 'truncated'
  /** Balanced braces that `JSON.parse` still refused. */
  | 'malformed_json'
  /** Parsed, but the top level was not an object. */
  | 'schema_rejected'
  /** Every block was refused: a document arrived and nothing in it survived. */
  | 'all_content_dropped'
  /** A title and nothing else — the model had nothing to say. */
  | 'nothing_useful'
  /** Longer than anything worth reading. */
  | 'reply_too_long';

/**
 * What the parse saw, in numbers rather than text.
 *
 * Deliberately contains no transcript and no model output: this is meant to be
 * loggable and attachable to a support report, and the one thing that must
 * never leave the device is what the user recorded.
 */
export interface ParseDiagnostics {
  replyChars: number;
  /** Whether a `{` appeared at all. */
  jsonObjectStarted: boolean;
  /** Whether that object ever closed. False here IS the truncation signal. */
  bracesBalanced: boolean;
  jsonParsed: boolean;
  sectionsAccepted: number;
  sectionsDropped: number;
  blocksAccepted: number;
  blocksDropped: number;
  /** Units refused for being longer than their kind allows. */
  oversizeDropped: number;
  /** References to transcript lines the model was never shown. */
  invalidSourceRefs: number;
  /** Set by the caller when the runtime reported hitting its token ceiling. */
  hitGenerationCap?: boolean;
}

export type ParseEnhancementResult =
  | { ok: true; value: Enhancement; diagnostics: ParseDiagnostics }
  | { ok: false; reason: ParseFailureReason; diagnostics: ParseDiagnostics };

/**
 * Counters filled in as one reply is read.
 *
 * Threaded through the readers rather than kept in a module-level variable: two
 * windows of one recording are parsed one after another, and a shared counter
 * would attribute the first window's drops to the second.
 */
interface Tally {
  sectionsAccepted: number;
  sectionsDropped: number;
  blocksAccepted: number;
  blocksDropped: number;
  oversizeDropped: number;
  invalidSourceRefs: number;
}

function emptyTally(): Tally {
  return {
    sectionsAccepted: 0,
    sectionsDropped: 0,
    blocksAccepted: 0,
    blocksDropped: 0,
    oversizeDropped: 0,
    invalidSourceRefs: 0,
  };
}

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
function readSources(value: unknown, lineCount: number, tally: Tally): number[] {
  const raw = Array.isArray(value) ? value : typeof value === 'number' ? [value] : [];
  const sources: number[] = [];
  for (const entry of raw) {
    const line = typeof entry === 'number' ? entry : Number(entry);
    if (!Number.isInteger(line) || line < 1 || line > lineCount) {
      // Counted, because a reply full of these is a model citing lines it was
      // never shown — worth seeing in a diagnostic even though each one alone is
      // dropped quietly.
      tally.invalidSourceRefs += 1;
      continue;
    }
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

/**
 * Read one piece of text, against the limit for the KIND of unit it is.
 *
 * A refusal is counted rather than silent. The whole reason this file now
 * carries a tally is that a dropped paragraph used to be indistinguishable from
 * a paragraph the model never wrote.
 */
function readText(value: unknown, unit: keyof typeof LIMITS, tally: Tally): string {
  const text = typeof value === 'string' ? cleanLine(value) : '';
  if (text.length <= LIMITS[unit]) return text;
  tally.oversizeDropped += 1;
  return '';
}

/**
 * Read a list of items.
 *
 * A bare string is accepted as an item, and a bare string in place of the whole
 * list as a one-item list: asked for a list, a small model with one thing to say
 * often just says it, and refusing that would throw away a correct answer over
 * its shape.
 */
function readItems(value: unknown, options: ParseOptions, tally: Tally): EnhancementListItem[] {
  const raw = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  const items: EnhancementListItem[] = [];

  for (const entry of raw) {
    const fields = record(entry);
    const text = readText(typeof entry === 'string' ? entry : fields?.[FIELDS.text], 'listItem', tally);
    if (text === '') continue;
    // Repeats are the most common way a small model fills a list it has nothing
    // left to put in.
    if (items.some((existing) => existing.text.toLowerCase() === text.toLowerCase())) continue;

    const derived = readDerived(fields?.[FIELDS.derived], options.authorisedSubjects);
    if (derived === 'unauthorised') continue;

    items.push({
      text,
      sources: readSources(fields?.[FIELDS.sources], options.lineCount, tally),
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
function readBlock(value: unknown, options: ParseOptions, tally: Tally): EnhancementBlock | null {
  const fields = record(value);
  if (!fields) {
    // A bare string where a block was asked for is a paragraph. Small models do
    // this constantly and the meaning is not in doubt.
    const text = readText(value, 'paragraph', tally);
    return text === '' ? null : { type: 'paragraph', text, sources: [] };
  }

  const type = fields[FIELDS.type];
  if (typeof type !== 'string' || !(BLOCK_TYPES as readonly string[]).includes(type)) return null;
  const sources = readSources(fields[FIELDS.sources], options.lineCount, tally);

  if (type === 'bullet-list' || type === 'numbered-list') {
    const items = readItems(fields[FIELDS.items], options, tally);
    return items.length > 0 ? { type, items, sources } : null;
  }

  const text = readText(fields[FIELDS.text], type === 'quote' ? 'quote' : 'paragraph', tally);
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

function readSections(value: unknown, options: ParseOptions, tally: Tally): EnhancementSection[] {
  if (!Array.isArray(value)) return [];
  const sections: EnhancementSection[] = [];
  for (const entry of value) {
    const fields = record(entry);
    if (!fields) continue;
    const raw = Array.isArray(fields[FIELDS.blocks])
      ? (fields[FIELDS.blocks] as unknown[]).slice(0, MAX_BLOCKS_PER_SECTION)
      : [];
    const blocks = raw
      .map((block) => readBlock(block, options, tally))
      .filter((block): block is EnhancementBlock => block !== null);
    tally.blocksAccepted += blocks.length;
    tally.blocksDropped += raw.length - blocks.length;
    // A section every one of whose blocks was refused is itself a drop, and the
    // count is what tells a reader "the model answered and we threw it away"
    // apart from "the model said nothing".
    if (blocks.length === 0) {
      tally.sectionsDropped += 1;
      continue;
    }
    const heading = readText(fields[FIELDS.heading], 'heading', tally);
    sections.push({ blocks, ...(heading === '' ? {} : { heading }) });
    tally.sectionsAccepted += 1;
    if (sections.length === MAX_SECTIONS) break;
  }
  return sections;
}

/**
 * Read the people the model named.
 *
 * An entry with no name, role or organisation is dropped: an empty person is not
 * information, and rendering one would put a bare "Speaker:" over a note.
 */
function readPeople(value: unknown, options: ParseOptions, tally: Tally): EnhancementPerson[] {
  if (!Array.isArray(value)) return [];
  const people: EnhancementPerson[] = [];
  for (const entry of value) {
    const fields = record(entry);
    if (!fields) continue;
    const person: EnhancementPerson = {
      sources: readSources(fields[FIELDS.sources], options.lineCount, tally),
    };
    for (const key of ['name', 'role', 'organization'] as const) {
      const text = readText(fields[key], 'person', tally);
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

function readTitle(value: unknown, tally: Tally): string {
  if (typeof value !== 'string') return '';
  const title = cleanLine(value).replace(/^#+\s*/, '');
  if (title.length <= LIMITS.title) return title;
  tally.oversizeDropped += 1;
  return '';
}

/**
 * Turn a model's reply into an enhancement, or say why not.
 *
 * It used to return `Enhancement | null`, and `null` meant seven different
 * things — no JSON at all, JSON that stopped mid-object, a document whose every
 * paragraph was dropped for being longer than a bullet, a title with nothing
 * under it. The caller turned all of them into "this device cannot organize
 * notes", which is a statement about the MACHINE and was false in every case
 * but the last.
 */
export function parseEnhancement(reply: string, options: ParseOptions): ParseEnhancementResult {
  const tally = emptyTally();
  const json = extractJsonObject(reply);
  const started = reply.includes('{');

  const diagnose = (over: Partial<ParseDiagnostics> = {}): ParseDiagnostics => ({
    replyChars: reply.length,
    jsonObjectStarted: started,
    bracesBalanced: json !== null,
    jsonParsed: false,
    sectionsAccepted: tally.sectionsAccepted,
    sectionsDropped: tally.sectionsDropped,
    blocksAccepted: tally.blocksAccepted,
    blocksDropped: tally.blocksDropped,
    oversizeDropped: tally.oversizeDropped,
    invalidSourceRefs: tally.invalidSourceRefs,
    ...over,
  });

  if (reply.length > MAX_REPLY_CHARS) {
    return { ok: false, reason: 'reply_too_long', diagnostics: diagnose() };
  }

  if (json === null) {
    // The discrimination this whole result type exists for. An object that
    // opened and never closed is generation stopping mid-answer — the model was
    // working, it ran out of room, and asking it again with more room is a real
    // remedy. No `{` at all is a model that answered in prose instead.
    return {
      ok: false,
      reason: started ? 'truncated' : 'no_json_object',
      diagnostics: diagnose(),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'malformed_json', diagnostics: diagnose() };
  }

  const fields = record(parsed);
  if (!fields) {
    return { ok: false, reason: 'schema_rejected', diagnostics: diagnose({ jsonParsed: true }) };
  }

  const enhancement: Enhancement = {
    profile: readProfile(fields[FIELDS.profile]),
    title: readTitle(fields[FIELDS.title], tally),
    people: readPeople(fields[FIELDS.people], options, tally),
    sections: readSections(fields[FIELDS.sections], options, tally),
    actions: readItems(fields[FIELDS.actions], options, tally),
    openQuestions: readItems(fields[FIELDS.openQuestions], options, tally),
    listAdditions: readItems(fields[FIELDS.listAdditions], options, tally),
  };

  const hasContent =
    enhancement.sections.length > 0 ||
    enhancement.actions.length > 0 ||
    enhancement.openQuestions.length > 0 ||
    enhancement.listAdditions.length > 0;

  if (hasContent) return { ok: true, value: enhancement, diagnostics: diagnose({ jsonParsed: true }) };

  // Two different failures, and only the second is the model's fault. Content
  // arrived and every piece of it was refused — an oversized paragraph, an
  // unauthorised derivation, an unknown block type — versus a model that sent a
  // heading over emptiness.
  const dropped = tally.blocksDropped > 0 || tally.sectionsDropped > 0 || tally.oversizeDropped > 0;
  return {
    ok: false,
    reason: dropped ? 'all_content_dropped' : 'nothing_useful',
    diagnostics: diagnose({ jsonParsed: true }),
  };
}
