/**
 * The one definition of what the model returns.
 *
 * It was three opinions. The prompt asked for four arrays of strings, the native
 * backend constrained generation against a JSON Schema requiring arrays of
 * strings, the browser constrained nothing at all, and the parser had learned to
 * accept objects with sources. Three of those disagreed with the TypeScript
 * contract and nothing could tell: a constrained grammar guarantees the SHAPE and
 * says nothing about whether anyone else expects that shape.
 *
 * So the schema is written once, here, next to the types it describes. The
 * prompt is generated from it, the native runtime constrains against it, the
 * parser validates against the same field names, and a test compares all of them.
 * Drift stops being something to notice and becomes something that fails.
 *
 * ## Why it is hand-written JSON Schema and not derived from the types
 *
 * TypeScript types are erased. Deriving a schema from them at runtime needs a
 * compiler or a decorator library in the bundle of a note-taking app, for a
 * document with nine fields. The gate below is the cheaper answer: the schema is
 * the source of truth, and the test proves the code agrees with it.
 */

/** Field names, referenced by everything rather than retyped by each of them. */
export const FIELDS = {
  profile: 'profile',
  title: 'title',
  people: 'people',
  sections: 'sections',
  blocks: 'blocks',
  heading: 'heading',
  type: 'type',
  text: 'text',
  items: 'items',
  attribution: 'attribution',
  actions: 'actions',
  openQuestions: 'openQuestions',
  listAdditions: 'listAdditions',
  derived: 'derived',
  /**
   * The short name for source line numbers.
   *
   * One letter on purpose: it appears on every block a model writes, and a small
   * model asked for `"sourceLineNumbers"` spends its budget on the key rather
   * than on the note.
   */
  sources: 's',
} as const;

/** The block types a section may contain. Mirrors `GeneratedBlock['kind']`. */
export const BLOCK_TYPES = ['paragraph', 'bullet-list', 'numbered-list', 'quote'] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

/** The profiles the model may report. Mirrors `CaptureProfile`. */
export const SCHEMA_PROFILES = [
  'auto',
  'meeting',
  'lecture',
  'event',
  'brainstorm',
  'interview',
  'dictation',
] as const;

const sourceRefs = {
  type: 'array',
  items: { type: 'integer' },
} as const;

const listItems = {
  type: 'array',
  items: {
    type: 'object',
    properties: { [FIELDS.text]: { type: 'string' }, [FIELDS.sources]: sourceRefs },
    required: [FIELDS.text],
  },
} as const;

/**
 * The document the model is asked for.
 *
 * `required` is deliberately short. Every list may legitimately be empty, and a
 * schema that demands a key the model has nothing for teaches it to invent one —
 * which is the failure this whole contract exists to prevent. What IS required is
 * the shape of anything it does send.
 */
export const DOCUMENT_SCHEMA = {
  type: 'object',
  properties: {
    [FIELDS.profile]: { type: 'string', enum: SCHEMA_PROFILES },
    [FIELDS.title]: { type: 'string' },
    [FIELDS.people]: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          role: { type: 'string' },
          organization: { type: 'string' },
          [FIELDS.sources]: sourceRefs,
        },
      },
    },
    [FIELDS.sections]: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          [FIELDS.heading]: { type: 'string' },
          [FIELDS.blocks]: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                [FIELDS.type]: { type: 'string', enum: BLOCK_TYPES },
                [FIELDS.text]: { type: 'string' },
                [FIELDS.items]: listItems,
                [FIELDS.attribution]: { type: 'string' },
                [FIELDS.sources]: sourceRefs,
              },
              required: [FIELDS.type],
            },
          },
        },
        required: [FIELDS.blocks],
      },
    },
    [FIELDS.actions]: listItems,
    [FIELDS.openQuestions]: listItems,
    [FIELDS.listAdditions]: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          [FIELDS.text]: { type: 'string' },
          [FIELDS.sources]: sourceRefs,
          [FIELDS.derived]: {
            type: 'object',
            properties: { subject: { type: 'string' }, reason: { type: 'string' } },
          },
        },
        required: [FIELDS.text],
      },
    },
  },
  required: [FIELDS.title, FIELDS.sections],
} as const;

/**
 * The reply shape as the prompt states it.
 *
 * Generated from the field names above rather than typed out beside them, so a
 * renamed field cannot end up described one way in the prompt and validated
 * another. A model reads an example far better than it reads a JSON Schema, which
 * is why this is an example and the schema is what constrains it.
 */
export function describeSchema(): string {
  return `Return valid JSON only, in this shape:
{
  "${FIELDS.profile}": "event",
  "${FIELDS.title}": "",
  "${FIELDS.people}": [{ "role": "", "name": "", "organization": "", "${FIELDS.sources}": [1] }],
  "${FIELDS.sections}": [
    {
      "${FIELDS.heading}": "",
      "${FIELDS.blocks}": [
        { "${FIELDS.type}": "paragraph", "${FIELDS.text}": "", "${FIELDS.sources}": [1, 2] },
        { "${FIELDS.type}": "bullet-list", "${FIELDS.items}": [{ "${FIELDS.text}": "", "${FIELDS.sources}": [3] }] }
      ]
    }
  ],
  "${FIELDS.actions}": [],
  "${FIELDS.openQuestions}": [],
  "${FIELDS.listAdditions}": []
}

"${FIELDS.type}" is one of: ${BLOCK_TYPES.join(', ')}.
"${FIELDS.sources}" lists the transcript line numbers a piece came from. Use only numbers shown below; use [] if nothing supports it.
"${FIELDS.heading}" names what a section is about. Omit it only when the whole note is one subject.
Use "paragraph" for connected reasoning and "bullet-list" only for genuinely list-shaped information.
Use "quote" with "${FIELDS.attribution}" when you keep somebody's exact words.
Every list may be empty. An empty list is a real answer; inventing something to fill it is not.`;
}
