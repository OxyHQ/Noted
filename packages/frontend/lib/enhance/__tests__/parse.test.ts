import { describe, expect, it } from 'vitest';

import { parseEnhancement, type ParseOptions } from '@/lib/enhance/parse';

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


/** Six transcript lines were shown, and nothing was authorised. */
const SHOWN: ParseOptions = { lineCount: 6, authorisedSubjects: [] };

/** A document, which is what the model is asked for now. */
const CLEAN = JSON.stringify({
  title: 'Presupuesto Q3',
  sections: [
    {
      heading: 'Infraestructura',
      blocks: [
        {
          type: 'paragraph',
          text: 'El gasto de infraestructura subió un 12% en el trimestre',
          s: [1, 2],
        },
      ],
    },
  ],
  actions: [{ text: 'Nate manda el desglose el viernes', s: [3] }],
  openQuestions: [],
  listAdditions: [],
});

describe('finding the JSON', () => {
  it('reads a clean reply', () => {
    const parsed = parseOrNull(CLEAN, SHOWN);
    expect(parsed?.title).toBe('Presupuesto Q3');
    expect(parsed?.sections[0].heading).toBe('Infraestructura');
    expect(parsed?.sections[0].blocks[0]).toEqual({
      type: 'paragraph',
      text: 'El gasto de infraestructura subió un 12% en el trimestre',
      sources: [1, 2],
    });
  });

  it('reads JSON wrapped in a code fence', () => {
    // The single most common shape a small model replies in.
    expect(parseOrNull(`\`\`\`json\n${CLEAN}\n\`\`\``, SHOWN)?.title).toBe('Presupuesto Q3');
  });

  it('reads JSON preceded by a sentence', () => {
    expect(parseOrNull(`Here are the notes:\n${CLEAN}`, SHOWN)?.title).toBe('Presupuesto Q3');
  });

  it('is not confused by a brace in the prose after the JSON', () => {
    expect(parseOrNull(`${CLEAN}\n\nHope that helps {smile}`, SHOWN)?.title).toBe(
      'Presupuesto Q3',
    );
  });

  it('is not confused by a brace inside a string', () => {
    const reply = JSON.stringify({
      title: 'x',
      sections: [{ blocks: [{ type: 'paragraph', text: 'use {id} here', s: [] }] }],
      actions: [],
      openQuestions: [],
      listAdditions: [],
    });
    expect(parseOrNull(reply, SHOWN)?.sections[0].blocks[0].text).toBe('use {id} here');
  });

  it('refuses a reply that is not JSON at all', () => {
    expect(parseOrNull('I could not summarise that.', SHOWN)).toBeNull();
  });

  it('refuses malformed JSON rather than salvaging it', () => {
    expect(parseOrNull('{"title": "x", "notes": [', SHOWN)).toBeNull();
  });

  it('refuses a JSON array', () => {
    expect(parseOrNull('["a", "b"]', SHOWN)).toBeNull();
  });

  it('refuses a reply too long to be an answer', () => {
    expect(parseOrNull('x'.repeat(20_001), SHOWN)).toBeNull();
  });
});

describe('reading a sloppy reply', () => {
  function withActions(actions: unknown): string {
    return JSON.stringify({ title: 'x', sections: [], actions, openQuestions: [], listAdditions: [] });
  }

  it('accepts a bare string as an item', () => {
    // Asked for a list, a small model with one thing to say often just says it.
    // Refusing that throws away a correct answer over its shape.
    expect(parseOrNull(withActions('Una sola acción'), SHOWN)?.actions).toEqual([
      { text: 'Una sola acción', sources: [] },
    ]);
  });

  it('strips the bullet markers models mirror back', () => {
    expect(
      parseOrNull(withActions(['- Primero', '2) Segundo']), SHOWN)?.actions.map(
        (item) => item.text,
      ),
    ).toEqual(['Primero', 'Segundo']);
  });

  it('drops repeats, which is how a model pads a list it has nothing for', () => {
    expect(parseOrNull(withActions(['Uno', 'uno']), SHOWN)?.actions).toHaveLength(1);
  });

  it('drops an item long enough to be a transcript, keeping the rest', () => {
    const long = 'x'.repeat(401);
    expect(
      parseOrNull(withActions(['Corta', long]), SHOWN)?.actions.map((item) => item.text),
    ).toEqual(['Corta']);
  });

  it('ignores entries that are neither a string nor an item', () => {
    expect(
      parseOrNull(withActions([42, null, { text: 'Buena' }]), SHOWN)?.actions.map(
        (item) => item.text,
      ),
    ).toEqual(['Buena']);
  });

  it('refuses a title with no document behind it', () => {
    // A model that had nothing to say about the recording. The rule-based note
    // is better than a heading over emptiness.
    expect(
      parseOrNull(
        '{"title":"Reunión","sections":[],"actions":[],"openQuestions":[],"listAdditions":[]}',
        SHOWN,
      ),
    ).toBeNull();
  });

  it('drops a title that is really a paragraph, keeping the document', () => {
    const parsed = parseOrNull(
      JSON.stringify({
        title: 'x'.repeat(121),
        sections: [{ blocks: [{ type: 'paragraph', text: 'Algo', s: [] }] }],
      }),
      SHOWN,
    );
    expect(parsed?.title).toBe('');
    expect(parsed?.sections).toHaveLength(1);
  });
});

describe('reading the document', () => {
  function withSections(sections: unknown): string {
    return JSON.stringify({ title: 'x', sections, actions: [], openQuestions: [], listAdditions: [] });
  }

  it('keeps a paragraph and a list apart', () => {
    const parsed = parseOrNull(
      withSections([
        {
          heading: 'Consultas',
          blocks: [
            { type: 'paragraph', text: 'Consultaron a tres grupos.', s: [1] },
            { type: 'bullet-list', items: [{ text: 'neurocientíficos', s: [2] }] },
          ],
        },
      ]),
      SHOWN,
    );
    expect(parsed?.sections[0].blocks.map((block) => block.type)).toEqual([
      'paragraph',
      'bullet-list',
    ]);
    expect(parsed?.sections[0].blocks[1].items?.[0].sources).toEqual([2]);
  });

  it('keeps a quotation with whose words they are', () => {
    const parsed = parseOrNull(
      withSections([
        {
          blocks: [
            { type: 'quote', text: 'I became a minister in 2023.', attribution: 'the speaker', s: [1] },
          ],
        },
      ]),
      SHOWN,
    );
    expect(parsed?.sections[0].blocks[0]).toMatchObject({
      type: 'quote',
      attribution: 'the speaker',
    });
  });

  it('reads a bare string where a block was asked for as a paragraph', () => {
    // Small models do this constantly and the meaning is not in doubt.
    const parsed = parseOrNull(withSections([{ blocks: ['Prosa suelta.'] }]), SHOWN);
    expect(parsed?.sections[0].blocks[0]).toEqual({
      type: 'paragraph',
      text: 'Prosa suelta.',
      sources: [],
    });
  });

  it('drops a block whose type it does not recognise', () => {
    // Rendering an unknown type as a paragraph would silently turn a list the
    // model meant into prose, and a note that quietly restructures itself is
    // worse than one missing a piece.
    const parsed = parseOrNull(
      withSections([
        {
          blocks: [
            { type: 'table', text: 'algo', s: [] },
            { type: 'paragraph', text: 'Real.', s: [] },
          ],
        },
      ]),
      SHOWN,
    );
    expect(parsed?.sections[0].blocks.map((block) => block.text)).toEqual(['Real.']);
  });

  it('drops an empty list and a section left with nothing', () => {
    expect(
      parseOrNull(withSections([{ heading: 'Vacía', blocks: [{ type: 'bullet-list', items: [] }] }]), SHOWN),
    ).toBeNull();
  });

  it('reads the profile it was given, and ignores one it does not know', () => {
    const known = parseOrNull(
      JSON.stringify({
        profile: 'event',
        title: 'x',
        sections: [{ blocks: [{ type: 'paragraph', text: 'Algo', s: [] }] }],
      }),
      SHOWN,
    );
    expect(known?.profile).toBe('event');

    const unknown = parseOrNull(
      JSON.stringify({
        profile: 'podcast',
        title: 'x',
        sections: [{ blocks: [{ type: 'paragraph', text: 'Algo', s: [] }] }],
      }),
      SHOWN,
    );
    expect(unknown?.profile).toBeUndefined();
  });
});

describe('who was speaking', () => {
  function withPeople(people: unknown): string {
    return JSON.stringify({
      title: 'x',
      people,
      sections: [{ blocks: [{ type: 'paragraph', text: 'Algo', s: [] }] }],
    });
  }

  it('keeps a role the recording stated', () => {
    expect(parseOrNull(withPeople([{ role: 'Education minister', s: [1] }]), SHOWN)?.people).toEqual([
      { role: 'Education minister', sources: [1] },
    ]);
  });

  it('drops a person with nothing known about them', () => {
    // An empty person is not information, and rendering one puts a bare
    // "Speaker:" over a note.
    expect(parseOrNull(withPeople([{ s: [1] }]), SHOWN)?.people).toEqual([]);
  });
});

describe('citations are checked, not believed', () => {
  function withParagraph(sources: unknown): string {
    return JSON.stringify({
      title: 'x',
      sections: [{ blocks: [{ type: 'paragraph', text: 'Algo', s: sources }] }],
    });
  }

  it('keeps a reference to a line the model was shown', () => {
    expect(parseOrNull(withParagraph([1, 6]), SHOWN)?.sections[0].blocks[0].sources).toEqual([
      1, 6,
    ]);
  });

  it('drops a reference to a line that does not exist', () => {
    // A citation a reader can follow to the wrong moment is worse than no
    // citation: it costs them their trust in every other one.
    expect(
      parseOrNull(withParagraph([2, 99, 0, -1]), SHOWN)?.sections[0].blocks[0].sources,
    ).toEqual([2]);
  });

  it('keeps the block when every one of its citations was invented', () => {
    // Usually still a real note about the recording; throwing it away costs the
    // user more than showing it ungrounded does.
    expect(parseOrNull(withParagraph([99]), SHOWN)?.sections[0].blocks[0]).toEqual({
      type: 'paragraph',
      text: 'Algo',
      sources: [],
    });
  });
});

describe('derived items', () => {
  const AUTHORISED: ParseOptions = { lineCount: 6, authorisedSubjects: ['una pizza de pollo'] };

  function reply(derived: unknown): string {
    return JSON.stringify({
      title: 'Compra',
      sections: [],
      actions: [],
      openQuestions: [],
      listAdditions: [{ text: 'mozzarella', s: [2], derived }],
    });
  }

  it('are kept when the user authorised that subject', () => {
    expect(
      parseOrNull(reply({ subject: 'una pizza de pollo', reason: 'base de la pizza' }), AUTHORISED)
        ?.listAdditions[0],
    ).toEqual({
      text: 'mozzarella',
      sources: [2],
      derived: { subject: 'una pizza de pollo', reason: 'base de la pizza' },
    });
  });

  it('are refused entirely when nobody authorised that subject', () => {
    // The model helping itself. Not a formatting slip — this is the one route by
    // which knowledge the recording does not contain can enter a note.
    expect(
      parseOrNull(reply({ subject: 'una paella', reason: 'me apetece' }), AUTHORISED),
    ).toBeNull();
  });

  it('are refused when nothing at all was authorised', () => {
    expect(parseOrNull(reply({ subject: 'una pizza de pollo', reason: 'x' }), SHOWN)).toBeNull();
  });

  it('do not need the exact wording the user used', () => {
    expect(parseOrNull(reply('pizza de pollo'), AUTHORISED)?.listAdditions[0].derived?.subject).toBe(
      'una pizza de pollo',
    );
  });
});
