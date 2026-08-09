import { describe, expect, it } from 'vitest';

import { parseEnhancement } from '@/lib/enhance/parse';

const GOOD = JSON.stringify({
  title: 'Presupuesto Q3',
  notes: ['El gasto de infraestructura subió un 12% en el trimestre'],
  actions: ['Nate manda el desglose el viernes'],
  openQuestions: ['Quién aprueba el gasto de AWS'],
});

describe('parseEnhancement', () => {
  it('reads a clean reply', () => {
    const result = parseEnhancement(GOOD);
    expect(result?.title).toBe('Presupuesto Q3');
    expect(result?.notes).toEqual(['El gasto de infraestructura subió un 12% en el trimestre']);
  });

  it('reads JSON wrapped in a code fence', () => {
    // The single most common shape a small model replies in.
    expect(parseEnhancement('```json\n' + GOOD + '\n```')?.title).toBe('Presupuesto Q3');
  });

  it('reads JSON preceded by a sentence', () => {
    expect(parseEnhancement(`Claro, aquí tienes:\n\n${GOOD}`)?.title).toBe('Presupuesto Q3');
  });

  it('is not confused by a brace in the prose after the JSON', () => {
    // Taking the first `{` and the last `}` would swallow the trailing sentence
    // and fail to parse a reply that was perfectly good.
    const reply = `${GOOD}\n\nEspero que sirva {para la reunión}.`;
    expect(parseEnhancement(reply)?.title).toBe('Presupuesto Q3');
  });

  it('is not confused by a brace inside a string', () => {
    const reply = JSON.stringify({
      title: 'Deploy',
      notes: ['Usar {env} en la plantilla'],
    });
    expect(parseEnhancement(reply)?.notes).toEqual(['Usar {env} en la plantilla']);
  });

  it('accepts a single string where a list was asked for', () => {
    // Asked for a list with one thing to say, a small model often just says it.
    const reply = JSON.stringify({ title: 'Sync', notes: 'Solo se habló del roadmap' });
    expect(parseEnhancement(reply)?.notes).toEqual(['Solo se habló del roadmap']);
  });

  it('strips the bullet markers models mirror back', () => {
    const reply = JSON.stringify({ title: 'Sync', notes: ['- uno', '* dos', '1. tres'] });
    expect(parseEnhancement(reply)?.notes).toEqual(['uno', 'dos', 'tres']);
  });

  it('drops repeats, which is how a model pads a list it has nothing for', () => {
    const reply = JSON.stringify({ title: 'Sync', notes: ['Uno', 'uno', 'UNO', 'Dos'] });
    expect(parseEnhancement(reply)?.notes).toEqual(['Uno', 'Dos']);
  });

  it('refuses a reply that is not JSON at all', () => {
    expect(parseEnhancement('Lo siento, no puedo ayudarte con eso.')).toBeNull();
  });

  it('refuses malformed JSON rather than salvaging it', () => {
    expect(parseEnhancement('{"title": "Sync", "notes": [')).toBeNull();
  });

  it('refuses a JSON array', () => {
    expect(parseEnhancement('["uno", "dos"]')).toBeNull();
  });

  it('refuses a title with no content behind it', () => {
    // A heading over emptiness is worse than the deterministic note it would
    // replace, so this is treated as no answer at all.
    expect(parseEnhancement(JSON.stringify({ title: 'Reunión', notes: [] }))).toBeNull();
  });

  it('drops a title that is really a paragraph, keeping the content', () => {
    const reply = JSON.stringify({
      title: 'x'.repeat(200),
      notes: ['Algo que sí sirve'],
    });
    const result = parseEnhancement(reply);
    expect(result?.title).toBe('');
    expect(result?.notes).toEqual(['Algo que sí sirve']);
  });

  it('drops an item long enough to be a transcript, keeping the rest', () => {
    const reply = JSON.stringify({
      title: 'Sync',
      notes: ['y'.repeat(500), 'Una línea normal'],
    });
    expect(parseEnhancement(reply)?.notes).toEqual(['Una línea normal']);
  });

  it('ignores non-string entries in a list', () => {
    const reply = JSON.stringify({ title: 'Sync', notes: ['Válido', 42, null, { a: 1 }] });
    expect(parseEnhancement(reply)?.notes).toEqual(['Válido']);
  });

  it('refuses a reply too long to be an answer', () => {
    expect(parseEnhancement('{"notes":["a"]}' + 'x'.repeat(20_001))).toBeNull();
  });
});
