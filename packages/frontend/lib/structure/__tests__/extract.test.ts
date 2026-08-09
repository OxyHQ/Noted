import { describe, expect, it } from 'vitest';

import { classifySentence, extractHighlights, splitSentences } from '@/lib/structure/extract';

describe('classifySentence', () => {
  it('finds commitments in Spanish', () => {
    expect(classifySentence('Hay que enviar el presupuesto el lunes')).toBe('action');
    expect(classifySentence('Me encargo yo de hablar con el cliente')).toBe('action');
    expect(classifySentence('Quedamos en revisarlo la semana que viene')).toBe('action');
  });

  it('finds commitments in English', () => {
    expect(classifySentence('We need to send the invoice today')).toBe('action');
    expect(classifySentence("I'll take the migration this week")).toBe('action');
  });

  it('finds settled points', () => {
    expect(classifySentence('Al final vamos a usar Postgres')).toBe('decision');
    expect(classifySentence('We decided to postpone the launch')).toBe('decision');
  });

  it('finds open questions from punctuation, in both scripts', () => {
    expect(classifySentence('¿Quién habla con el proveedor?')).toBe('question');
    expect(classifySentence('Who owns the migration?')).toBe('question');
  });

  // The rule this module is built around: an invented commitment is worse than a
  // missed one, so ordinary conversation must classify as nothing at all.
  it('leaves ordinary conversation alone', () => {
    expect(classifySentence('El informe salió bastante bien al final')).toBeNull();
    expect(classifySentence('The weather was terrible all week')).toBeNull();
    expect(classifySentence('Buenos días a todos')).toBeNull();
  });

  // `todo` is one of the most common words in Spanish, and the English `to-do`
  // marker is one character away from it. Without the hyphen requirement these
  // three sentences all become tasks.
  it('does not turn the Spanish word "todo" into a task', () => {
    expect(classifySentence('Todo el mundo estuvo de acuerdo')).toBeNull();
    expect(classifySentence('Salió todo bien en la demo')).toBeNull();
    expect(classifySentence('Revisamos todo el documento juntos')).toBeNull();
  });

  it('still finds the hyphenated English marker', () => {
    expect(classifySentence('Adding this to the to-do list now')).toBe('action');
  });

  // A sentence can read as both. The commitment wins because it is the reading
  // that produces a task the user can tick off.
  it('prefers the commitment when a sentence is both', () => {
    expect(classifySentence('Acordamos que hay que enviarlo el viernes')).toBe('action');
  });

  // Asking who will do something is the record that nobody has taken it on.
  // Classified as a commitment it becomes a task with no owner that nobody
  // agreed to — the exact invention this module refuses to make.
  it('treats a question as a question even when it names a commitment', () => {
    expect(classifySentence('¿Quién se encarga del diseño?')).toBe('question');
    expect(classifySentence('Do we need to send it today?')).toBe('question');
  });

  it('ignores fragments too short to carry anything', () => {
    expect(classifySentence('Vale')).toBeNull();
    expect(classifySentence('¿Sí?')).toBeNull();
  });
});

describe('splitSentences', () => {
  it('splits on terminal punctuation', () => {
    expect(splitSentences('Primero esto. Luego lo otro. Y ya.')).toEqual([
      'Primero esto.',
      'Luego lo otro.',
      'Y ya.',
    ]);
  });

  it('keeps a question mark with its sentence', () => {
    expect(splitSentences('¿Quién lo hace? Yo lo hago.')).toEqual([
      '¿Quién lo hace?',
      'Yo lo hago.',
    ]);
  });
});

describe('extractHighlights', () => {
  it('stamps each highlight with where it was said', () => {
    const highlights = extractHighlights(
      'Buenos días a todos. Hay que enviar el contrato. ¿Quién se encarga del diseño?',
      120_000,
    );
    expect(highlights.map((h) => h.kind)).toEqual(['action', 'question']);
    expect(highlights.every((h) => h.atMs === 120_000)).toBe(true);
  });

  it('returns nothing for a block with no commitments or questions', () => {
    expect(extractHighlights('Estuvimos comentando el tiempo que hizo el fin de semana.', 0))
      .toEqual([]);
  });
});
