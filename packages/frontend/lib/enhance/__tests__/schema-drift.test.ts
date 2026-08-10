/**
 * That the prompt, the schema, the parser and both backends describe one thing.
 *
 * They did not. The prompt asked for four arrays of strings; the native backend
 * constrained generation against its own copy of a schema requiring arrays of
 * strings; the browser constrained nothing at all; and the parser had been taught
 * to accept objects with source references. Three of those disagreed with the
 * TypeScript contract, and nothing anywhere could tell — a constrained grammar
 * guarantees the SHAPE and says nothing about whether anybody else expects that
 * shape. The symptom is a model that answers perfectly and a note that comes out
 * empty.
 *
 * So drift stops being something to notice and becomes something that fails.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseEnhancement } from '@/lib/enhance/parse';
import { buildPrompt } from '@/lib/enhance/prompt';
import { BLOCK_TYPES, DOCUMENT_SCHEMA, FIELDS, SCHEMA_PROFILES } from '@/lib/enhance/schema';
import { CAPTURE_PROFILES } from '@noted/shared-types';
import type { EnhanceLine } from '@/lib/enhance/contract';

/**
 * The parsed document, or null when the reply was refused.
 *
 * The parser now returns a REASON with every refusal. These cases predate that
 * and only care whether a document came out, so they read through this rather
 * than being rewritten to assert reasons they were never about — the reasons
 * get their own file.
 */
function parseOrNull(reply: string, options: Parameters<typeof parseEnhancement>[1]) {
  const result = parseEnhancement(reply, options);
  return result.ok ? result.value : null;
}


const HERE = import.meta.dirname;
const read = (path: string): string => readFileSync(join(HERE, '..', '..', path), 'utf8');

const NATIVE = read('enhance/summarizer.native.ts');
const WEB = read('enhance/summarizer.web.ts');

const WINDOW: EnhanceLine[] = [
  { atMs: 0, text: 'Primera línea', segmentIds: ['c1#0.0'] },
  { atMs: 1_000, text: 'Segunda línea', segmentIds: ['c1#0.1'] },
];

const PROMPT = buildPrompt(WINDOW, {
  language: 'es',
  profile: 'auto',
  intent: 'freeform',
  expansions: [],
});

/**
 * The prompt with an authorisation, where every field is legal.
 *
 * `derived` is deliberately absent from the ordinary prompt: it is the one route
 * by which knowledge the recording does not contain may enter a note, and
 * describing it to a model that has no permission to use it is teaching it a
 * field it must never fill. So the field census runs against this one.
 */
const AUTHORISED_PROMPT = buildPrompt(WINDOW, {
  language: 'es',
  profile: 'auto',
  intent: 'shopping-list',
  expansions: [
    {
      subject: 'una pizza de pollo',
      instructionSource: { captureId: 'c1', startMs: 0, endMs: 1, segmentIds: ['c1#0.0'] },
    },
  ],
});

/** Every field name the schema declares, at every level. */
function schemaFields(node: unknown, found = new Set<string>()): Set<string> {
  if (typeof node !== 'object' || node === null) return found;
  const shape = node as Record<string, unknown>;
  if (shape.properties && typeof shape.properties === 'object') {
    for (const key of Object.keys(shape.properties)) found.add(key);
  }
  for (const value of Object.values(shape)) schemaFields(value, found);
  return found;
}

describe('the schema is the source of truth', () => {
  it('names every field the code refers to by name', () => {
    // `FIELDS` is what the prompt, the parser and this test all read. A field in
    // one and not the other is exactly the drift that made a correct reply parse
    // to nothing.
    const declared = schemaFields(DOCUMENT_SCHEMA);
    for (const field of Object.values(FIELDS)) {
      expect(declared.has(field), `schema is missing ${field}`).toBe(true);
    }
  });

  it('offers exactly the profiles the app has', () => {
    // A model told it may answer `podcast` writes `podcast`, and the parser drops
    // it — silently, and only for recordings of that kind.
    expect([...SCHEMA_PROFILES].sort()).toEqual([...CAPTURE_PROFILES].sort());
  });
});

describe('the prompt describes that schema', () => {
  it('names every field, so the model is asked for what is validated', () => {
    for (const field of Object.values(FIELDS)) {
      expect(AUTHORISED_PROMPT, `prompt never mentions ${field}`).toContain(`"${field}"`);
    }
  });

  it('does not offer `derived` to a model with no permission to use it', () => {
    // Describing the one field that lets knowledge in, to a recording where
    // nothing was authorised, is teaching a model a habit the parser will then
    // have to refuse.
    expect(PROMPT).not.toContain(`"${FIELDS.derived}"`);
  });

  it('names every block type the parser accepts', () => {
    for (const type of BLOCK_TYPES) {
      expect(PROMPT, `prompt never mentions ${type}`).toContain(type);
    }
  });
});

describe('the parser reads what the schema promises', () => {
  it('accepts a reply built from the schema, field for field', () => {
    // Built from `FIELDS` rather than typed out, so a rename cannot leave this
    // test passing against the old spelling.
    const reply = JSON.stringify({
      [FIELDS.profile]: 'event',
      [FIELDS.title]: 'Una charla',
      [FIELDS.people]: [{ role: 'Ministro', [FIELDS.sources]: [1] }],
      [FIELDS.sections]: [
        {
          [FIELDS.heading]: 'Un tema',
          [FIELDS.blocks]: [
            { [FIELDS.type]: 'paragraph', [FIELDS.text]: 'Prosa.', [FIELDS.sources]: [1] },
            {
              [FIELDS.type]: 'bullet-list',
              [FIELDS.items]: [{ [FIELDS.text]: 'Uno', [FIELDS.sources]: [2] }],
            },
            {
              [FIELDS.type]: 'quote',
              [FIELDS.text]: 'Sus palabras.',
              [FIELDS.attribution]: 'el ponente',
              [FIELDS.sources]: [2],
            },
          ],
        },
      ],
      [FIELDS.actions]: [{ [FIELDS.text]: 'Hacer algo', [FIELDS.sources]: [1] }],
      [FIELDS.openQuestions]: [{ [FIELDS.text]: '¿Y esto?', [FIELDS.sources]: [2] }],
      [FIELDS.listAdditions]: [],
    });

    const parsed = parseOrNull(reply, { lineCount: WINDOW.length, authorisedSubjects: [] });
    expect(parsed).not.toBeNull();
    expect(parsed?.profile).toBe('event');
    expect(parsed?.people[0].role).toBe('Ministro');
    expect(parsed?.sections[0].heading).toBe('Un tema');
    expect(parsed?.sections[0].blocks.map((block) => block.type)).toEqual([
      'paragraph',
      'bullet-list',
      'quote',
    ]);
    expect(parsed?.actions[0].text).toBe('Hacer algo');
    expect(parsed?.openQuestions[0].text).toBe('¿Y esto?');
  });

  it('is not vacuous — the same reply with the old field names is refused', () => {
    // The shape this whole gate exists for. `notes: []` was the contract until
    // this change, and a backend still generating it must fail loudly rather
    // than produce an empty note.
    const stale = JSON.stringify({
      title: 'Una charla',
      notes: ['Prosa.'],
      actions: [],
      openQuestions: [],
    });
    expect(parseOrNull(stale, { lineCount: 2, authorisedSubjects: [] })).toBeNull();
  });
});

describe('both backends generate against that schema', () => {
  it('the phone constrains against the canonical one, not a copy', () => {
    // It carried its own, which stayed correct for exactly as long as nobody
    // changed the contract.
    expect(NATIVE).toContain("from '@/lib/enhance/schema'");
    expect(NATIVE).toContain('schema: DOCUMENT_SCHEMA');
    expect(NATIVE).not.toContain('REPLY_SCHEMA');
  });

  it('neither backend writes a schema of its own', () => {
    for (const [name, source] of [
      ['native', NATIVE],
      ['web', WEB],
    ] as const) {
      // A second `properties:` block in a backend is a second opinion about the
      // contract, which is the thing this file exists to prevent.
      expect(source, name).not.toMatch(/properties:\s*\{/);
    }
  });

  it('both go through the one summariser that parses and validates', () => {
    for (const [name, source] of [
      ['native', NATIVE],
      ['web', WEB],
    ] as const) {
      expect(source, name).toContain('summarize(request');
      expect(source, name).not.toContain('parseEnhancement');
    }
  });
});
