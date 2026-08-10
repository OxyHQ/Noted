/**
 * That clicking a word in the rendered note puts the caret on that word.
 *
 * The alignment is checked the only way that means anything: take the offset it
 * returns, slice the Markdown there, and assert the text continues where the
 * reader was pointing. An offset asserted as a number would pass just as well
 * against an off-by-one nobody would tolerate in a caret.
 */

import { describe, expect, it } from 'vitest';

import { markdownOffsetForRenderedPrefix } from '@/lib/markdown/caret';

/** What the user would type into next, had they clicked there. */
const restOf = (markdown: string, rendered: string): string =>
  markdown.slice(markdownOffsetForRenderedPrefix(markdown, rendered));

describe('a note with no syntax in it', () => {
  it('maps a position to itself', () => {
    const markdown = 'El ministerio consultó a expertos.';
    expect(markdownOffsetForRenderedPrefix(markdown, 'El ministerio')).toBe(13);
  });

  it('lands at the start when nothing precedes the caret', () => {
    expect(markdownOffsetForRenderedPrefix('Algo escrito.', '')).toBe(0);
  });
});

describe('a heading', () => {
  const markdown = '## Decisiones\n\nSe aprobó el presupuesto.';

  it('accounts for the hashes the reader never saw', () => {
    // Rendered, "Decisiones" starts at 0. In the Markdown it starts at 3.
    expect(restOf(markdown, 'Decisiones')).toBe('\n\nSe aprobó el presupuesto.');
  });

  it('reaches text in the paragraph below it', () => {
    expect(restOf(markdown, 'Decisiones\nSe aprobó')).toBe(' el presupuesto.');
  });
});

describe('a list', () => {
  const markdown = '- neurocientíficos\n- empresas tecnológicas';

  it('skips the dashes', () => {
    expect(restOf(markdown, 'neurocientíficos')).toBe('\n- empresas tecnológicas');
  });

  it('reaches the second line', () => {
    expect(restOf(markdown, 'neurocientíficos\nempresas')).toBe(' tecnológicas');
  });

  it('skips the numbers of an ordered list, which the renderer draws itself', () => {
    expect(restOf('1. Primero\n2. Segundo', 'Primero\nSegundo')).toBe('');
  });
});

describe('inline marks', () => {
  it('sees through emphasis', () => {
    expect(restOf('Esto es **muy** importante.', 'Esto es muy')).toBe('** importante.');
  });

  it('sees through a link, whose URL is longer than its text', () => {
    const markdown = 'Escrito en [Noted](https://noted.oxy.so/notes/1) ayer.';
    expect(restOf(markdown, 'Escrito en Noted')).toBe('](https://noted.oxy.so/notes/1) ayer.');
  });

  it('reaches the text after a link, on the far side of its URL', () => {
    const markdown = 'Escrito en [Noted](https://noted.oxy.so/notes/1) ayer.';
    expect(restOf(markdown, 'Escrito en Noted ayer')).toBe('.');
  });
});

describe('a quotation', () => {
  it('sees through the marker on every line of it', () => {
    const markdown = '> Fui ministro en abril.\n>\n> — el ponente';
    expect(restOf(markdown, 'Fui ministro')).toBe(' en abril.\n>\n> — el ponente');
  });
});

describe('what the renderer draws that no Markdown contains', () => {
  it('is skipped rather than hunted for', () => {
    // A bullet glyph is in the DOM and in no source. Hunting for it would drag
    // the caret to wherever "•" happened to appear next — here, nowhere, so an
    // unguarded search would run off the end of the note.
    const markdown = '- uno\n- dos';
    expect(restOf(markdown, '• uno\n• dos')).toBe('');
  });

  it('does not let one invented character lose the rest of the alignment', () => {
    const markdown = '- uno\n- dos';
    expect(restOf(markdown, '• uno')).toBe('\n- dos');
  });
});

describe('the whole note', () => {
  it('ends at the end', () => {
    const markdown = '## Un tema\n\nProsa.\n\n- uno\n- dos';
    expect(restOf(markdown, 'Un tema\nProsa.\nuno\ndos')).toBe('');
  });
});

describe('a run of syntax longer than the note has any right to contain', () => {
  it('stops the alignment where it stands rather than leaping', () => {
    // The guard that keeps a mis-alignment local. Without it, a stray character
    // matches anywhere later in the note and everything after it is wrong.
    const markdown = `[x](https://example.com/${'a'.repeat(400)}) fin`;
    const offset = markdownOffsetForRenderedPrefix(markdown, 'x fin');
    expect(offset).toBeLessThan(markdown.length);
  });
});
