import { describe, expect, it } from 'vitest';

import { parseEnhancement, type ParseOptions } from '@/lib/enhance/parse';

/** Six transcript lines were shown, and nothing was authorised. */
const SHOWN: ParseOptions = { lineCount: 6, authorisedSubjects: [] };

const CLEAN = JSON.stringify({
  title: 'Presupuesto Q3',
  notes: [{ text: 'El gasto de infraestructura subió un 12% en el trimestre', s: [1, 2] }],
  actions: [{ text: 'Nate manda el desglose el viernes', s: [3] }],
  openQuestions: [],
  listAdditions: [],
});

describe('finding the JSON', () => {
  it('reads a clean reply', () => {
    const parsed = parseEnhancement(CLEAN, SHOWN);
    expect(parsed?.title).toBe('Presupuesto Q3');
    expect(parsed?.notes[0]).toEqual({
      text: 'El gasto de infraestructura subió un 12% en el trimestre',
      sources: [1, 2],
    });
  });

  it('reads JSON wrapped in a code fence', () => {
    // The single most common shape a small model replies in.
    expect(parseEnhancement(`\`\`\`json\n${CLEAN}\n\`\`\``, SHOWN)?.title).toBe('Presupuesto Q3');
  });

  it('reads JSON preceded by a sentence', () => {
    expect(parseEnhancement(`Here are the notes:\n${CLEAN}`, SHOWN)?.title).toBe('Presupuesto Q3');
  });

  it('is not confused by a brace in the prose after the JSON', () => {
    expect(parseEnhancement(`${CLEAN}\n\nHope that helps {smile}`, SHOWN)?.title).toBe(
      'Presupuesto Q3',
    );
  });

  it('is not confused by a brace inside a string', () => {
    const reply = JSON.stringify({
      title: 'x',
      notes: [{ text: 'use {id} here', s: [] }],
      actions: [],
      openQuestions: [],
      listAdditions: [],
    });
    expect(parseEnhancement(reply, SHOWN)?.notes[0].text).toBe('use {id} here');
  });

  it('refuses a reply that is not JSON at all', () => {
    expect(parseEnhancement('I could not summarise that.', SHOWN)).toBeNull();
  });

  it('refuses malformed JSON rather than salvaging it', () => {
    expect(parseEnhancement('{"title": "x", "notes": [', SHOWN)).toBeNull();
  });

  it('refuses a JSON array', () => {
    expect(parseEnhancement('["a", "b"]', SHOWN)).toBeNull();
  });

  it('refuses a reply too long to be an answer', () => {
    expect(parseEnhancement('x'.repeat(20_001), SHOWN)).toBeNull();
  });
});

describe('reading a sloppy list', () => {
  it('accepts a bare string as an item', () => {
    // Asked for a list, a small model with one thing to say often just says it.
    // Refusing that throws away a correct answer over its shape.
    const parsed = parseEnhancement(
      '{"title":"x","notes":"Una sola nota","actions":[],"openQuestions":[],"listAdditions":[]}',
      SHOWN,
    );
    expect(parsed?.notes).toEqual([{ text: 'Una sola nota', sources: [] }]);
  });

  it('strips the bullet markers models mirror back', () => {
    const parsed = parseEnhancement(
      '{"title":"x","notes":["- Primero","2) Segundo"],"actions":[],"openQuestions":[],"listAdditions":[]}',
      SHOWN,
    );
    expect(parsed?.notes.map((item) => item.text)).toEqual(['Primero', 'Segundo']);
  });

  it('drops repeats, which is how a model pads a list it has nothing for', () => {
    const parsed = parseEnhancement(
      '{"title":"x","notes":["Uno","uno"],"actions":[],"openQuestions":[],"listAdditions":[]}',
      SHOWN,
    );
    expect(parsed?.notes).toHaveLength(1);
  });

  it('drops an item long enough to be a transcript, keeping the rest', () => {
    const long = 'x'.repeat(401);
    const parsed = parseEnhancement(
      `{"title":"x","notes":["Corta","${long}"],"actions":[],"openQuestions":[],"listAdditions":[]}`,
      SHOWN,
    );
    expect(parsed?.notes.map((item) => item.text)).toEqual(['Corta']);
  });

  it('ignores entries that are neither a string nor an item', () => {
    const parsed = parseEnhancement(
      '{"title":"x","notes":[42,null,{"text":"Buena"}],"actions":[],"openQuestions":[],"listAdditions":[]}',
      SHOWN,
    );
    expect(parsed?.notes.map((item) => item.text)).toEqual(['Buena']);
  });

  it('refuses a title with no content behind it', () => {
    // A model that had nothing to say about the recording. The rule-based note is
    // better than a heading over emptiness.
    expect(
      parseEnhancement(
        '{"title":"Reunión","notes":[],"actions":[],"openQuestions":[],"listAdditions":[]}',
        SHOWN,
      ),
    ).toBeNull();
  });

  it('drops a title that is really a paragraph, keeping the content', () => {
    const parsed = parseEnhancement(
      `{"title":"${'x'.repeat(121)}","notes":["Algo"],"actions":[],"openQuestions":[],"listAdditions":[]}`,
      SHOWN,
    );
    expect(parsed?.title).toBe('');
    expect(parsed?.notes).toHaveLength(1);
  });
});

describe('citations are checked, not believed', () => {
  it('keeps a reference to a line the model was shown', () => {
    const parsed = parseEnhancement(
      '{"title":"x","notes":[{"text":"Algo","s":[1,6]}],"actions":[],"openQuestions":[],"listAdditions":[]}',
      SHOWN,
    );
    expect(parsed?.notes[0].sources).toEqual([1, 6]);
  });

  it('drops a reference to a line that does not exist', () => {
    // A citation a reader can follow to the wrong moment is worse than no
    // citation: it costs them their trust in every other one.
    const parsed = parseEnhancement(
      '{"title":"x","notes":[{"text":"Algo","s":[2,99,0,-1]}],"actions":[],"openQuestions":[],"listAdditions":[]}',
      SHOWN,
    );
    expect(parsed?.notes[0].sources).toEqual([2]);
  });

  it('keeps the item when every one of its citations was invented', () => {
    // Usually still a real note about the recording; throwing it away costs the
    // user more than showing it ungrounded does. What must never happen is the
    // citation being believed.
    const parsed = parseEnhancement(
      '{"title":"x","notes":[{"text":"Algo","s":[99]}],"actions":[],"openQuestions":[],"listAdditions":[]}',
      SHOWN,
    );
    expect(parsed?.notes[0]).toEqual({ text: 'Algo', sources: [] });
  });

  it('accepts the longer spelling too, and does not repeat a line', () => {
    const parsed = parseEnhancement(
      '{"title":"x","notes":[{"text":"Algo","sources":[3,3]}],"actions":[],"openQuestions":[],"listAdditions":[]}',
      SHOWN,
    );
    expect(parsed?.notes[0].sources).toEqual([3]);
  });
});

describe('derived items', () => {
  const AUTHORISED: ParseOptions = { lineCount: 6, authorisedSubjects: ['una pizza de pollo'] };

  function reply(derived: unknown): string {
    return JSON.stringify({
      title: 'Compra',
      notes: [],
      actions: [],
      openQuestions: [],
      listAdditions: [{ text: 'mozzarella', s: [2], derived }],
    });
  }

  it('are kept when the user authorised that subject', () => {
    const parsed = parseEnhancement(
      reply({ subject: 'una pizza de pollo', reason: 'base de la pizza' }),
      AUTHORISED,
    );
    expect(parsed?.listAdditions[0]).toEqual({
      text: 'mozzarella',
      sources: [2],
      derived: { subject: 'una pizza de pollo', reason: 'base de la pizza' },
    });
  });

  it('are refused entirely when nobody authorised that subject', () => {
    // The model helping itself. Not a formatting slip — this is the one route by
    // which knowledge the recording does not contain can enter a note.
    expect(
      parseEnhancement(reply({ subject: 'una paella', reason: 'me apetece' }), AUTHORISED),
    ).toBeNull();
  });

  it('are refused when nothing at all was authorised', () => {
    expect(
      parseEnhancement(reply({ subject: 'una pizza de pollo', reason: 'x' }), SHOWN),
    ).toBeNull();
  });

  it('do not need the exact wording the user used', () => {
    // The model rephrases. What matters is that it names something authorised.
    const parsed = parseEnhancement(reply('pizza de pollo'), AUTHORISED);
    expect(parsed?.listAdditions[0].derived?.subject).toBe('una pizza de pollo');
  });

  it('leave an ordinary item alone', () => {
    const parsed = parseEnhancement(
      '{"title":"x","notes":[{"text":"Algo","s":[1]}],"actions":[],"openQuestions":[],"listAdditions":[]}',
      AUTHORISED,
    );
    expect(parsed?.notes[0].derived).toBeUndefined();
  });
});
