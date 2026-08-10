import { describe, expect, it } from 'vitest';

import { parseListCommands } from '@/lib/artifact/dictation/instructions';
import { classifyProfile, resolveProfile, spokenProfile } from '@/lib/artifact/profile';

function blocks(...lines: string[]): { text: string; startMs: number }[] {
  return lines.map((text, index) => ({ text, startMs: index * 5_000 }));
}

describe('who decides the profile', () => {
  it('the user, whenever they chose', () => {
    // Quietly overruling somebody who picked "Class" before pressing record is
    // the kind of cleverness that makes an app feel untrustworthy.
    expect(
      resolveProfile({ selected: 'lecture', spoken: 'meeting', classified: 'interview' }),
    ).toBe('lecture');
  });

  it('then what they said out loud', () => {
    expect(resolveProfile({ selected: 'auto', spoken: 'meeting', classified: 'interview' })).toBe(
      'meeting',
    );
  });

  it('then what the recording looks like', () => {
    expect(resolveProfile({ selected: 'auto', spoken: null, classified: 'interview' })).toBe(
      'interview',
    );
  });

  it('and general notes when nobody knows, which is a fine answer', () => {
    expect(resolveProfile({})).toBe('auto');
    expect(resolveProfile({ selected: 'auto', spoken: null, classified: 'auto' })).toBe('auto');
  });
});

describe('what somebody said this is', () => {
  it('hears a recording being named', () => {
    expect(spokenProfile(blocks('Bueno, esto es una clase de introducción.'))).toBe('lecture');
    expect(spokenProfile(blocks('Esto es una reunión de seguimiento.'))).toBe('meeting');
    expect(spokenProfile(blocks('Esto es una entrevista con Ana.'))).toBe('interview');
  });

  it('hears an instruction to file it as something', () => {
    expect(spokenProfile(blocks('Grábalo como entrevista, por favor.'))).toBe('interview');
  });

  it('does not confuse the subject of a talk with what the talk is', () => {
    // A lecture ABOUT meetings is a lecture. A keyword search cannot tell the
    // difference, which is why this needs a naming construction.
    expect(spokenProfile(blocks('Hoy hablamos de cómo dirigir una reunión eficaz.'))).toBeNull();
  });

  it('hears nothing in an ordinary recording', () => {
    expect(spokenProfile(blocks('Empezamos con el presupuesto del trimestre.'))).toBeNull();
  });
});

describe('what the recording looks like', () => {
  it('reads a dictated list as dictation', () => {
    const lines = blocks('Quiero una lista de la compra. Añade pollo y pasta.');
    expect(classifyProfile(lines, parseListCommands(lines))).toBe('dictation');
  });

  it('does not turn a meeting into a list because somebody dictated one in it', () => {
    // The order that matters: reading the commands first would throw away
    // everything else that was said.
    const lines = blocks(
      'Empezamos la reunión. El primer punto del día es el presupuesto.',
      'Añade pollo y pasta a la lista de la compra.',
    );
    expect(classifyProfile(lines, parseListCommands(lines))).toBe('meeting');
  });

  it('recognises a class from how a class opens', () => {
    expect(classifyProfile(blocks('Hoy vamos a ver los modelos de lenguaje.'), [])).toBe('lecture');
  });

  it('recognises a talk and a brainstorm', () => {
    expect(classifyProfile(blocks('El ponente empieza con una anécdota.'), [])).toBe('event');
    expect(classifyProfile(blocks('Venga, lluvia de ideas para el nombre.'), [])).toBe('brainstorm');
  });

  it('recognises an interview from how much of it is questions', () => {
    expect(
      classifyProfile(
        blocks(
          '¿Cómo empezaste en esto? Llevo quince años trabajando en cocina.',
          '¿Y qué fue lo más difícil? Los primeros dos años, sin duda.',
          '¿Volverías a hacerlo? Sí, sin pensarlo.',
          '¿Qué le dirías a alguien que empieza? Que tenga paciencia.',
          'Me formé en Francia y volví en 2010.',
        ),
        [],
      ),
    ).toBe('interview');
  });

  it('says nothing rather than guessing from a handful of sentences', () => {
    // Below a floor a ratio says nothing at all, and a confident wrong answer is
    // worse than no answer: general notes are what most recordings want.
    expect(classifyProfile(blocks('¿Vamos? Sí.'), [])).toBe('auto');
    expect(classifyProfile(blocks('El presupuesto sube un diez por ciento.'), [])).toBe('auto');
  });
});
