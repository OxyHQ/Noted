import { describe, expect, it } from 'vitest';

import { cleanSpeech } from '@/lib/structure/clean';

describe('cleanSpeech', () => {
  it('removes hesitation in both languages', () => {
    expect(cleanSpeech('eh, vamos a empezar')).toBe('Vamos a empezar');
    expect(cleanSpeech('um, let us start')).toBe('Let us start');
  });

  it('removes runs of adjacent fillers', () => {
    // Adjacent fillers share the separator they match on, so a single pass
    // leaves the second one behind.
    expect(cleanSpeech('eh, em, vale')).toBe('Vale');
  });

  // The next two are why the pattern is word-bounded. Without the boundary these
  // sentences lose a chunk of a real word and the note says something else.
  it('does not eat a filler that appears inside a real word', () => {
    expect(cleanSpeech('Esteban lo revisa')).toBe('Esteban lo revisa');
    expect(cleanSpeech('The umbral case is rare')).toBe('The umbral case is rare');
  });

  it('keeps words that look like filler but carry the sentence', () => {
    // `o sea` and `so` are the classic over-removals: both routinely introduce
    // the clause that matters.
    // Compared case-insensitively because sentence-start capitalisation is
    // applied too; what is being asserted is that the words survive at all.
    expect(cleanSpeech('o sea que no lo hacemos').toLowerCase()).toContain('o sea');
    expect(cleanSpeech('So we ship on Friday').toLowerCase()).toContain('so we ship');
  });

  it('collapses a stalled repetition', () => {
    expect(cleanSpeech('el el informe')).toBe('El informe');
  });

  it('tidies the spacing a recogniser leaves around punctuation', () => {
    expect(cleanSpeech('hola , ¿qué tal ?')).toBe('Hola, ¿Qué tal?');
  });

  it('capitalises the start of each sentence', () => {
    expect(cleanSpeech('primero esto. luego lo otro')).toBe('Primero esto. Luego lo otro');
  });

  it('leaves already-clean text alone', () => {
    // A note can be re-structured when more transcript arrives, so cleaning has
    // to be safe to apply twice.
    const once = cleanSpeech('eh, revisamos el presupuesto. Luego lo firmamos');
    expect(cleanSpeech(once)).toBe(once);
  });

  it('does not lowercase an acronym or a name the recogniser got right', () => {
    expect(cleanSpeech('el informe de AWS lo revisa María')).toBe(
      'El informe de AWS lo revisa María',
    );
  });
});
