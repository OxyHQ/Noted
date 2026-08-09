import { describe, expect, it } from 'vitest';

import { parseBlocks, toPreviewText } from '@/lib/markdown/blocks';

describe('parseBlocks', () => {
  it('reads the shape the structurer writes', () => {
    const markdown = ['## Decisions', '', '- Congelar contrataciones', '- Revisar en septiembre'].join(
      '\n',
    );
    expect(parseBlocks(markdown)).toEqual([
      { kind: 'heading', level: 2, text: 'Decisions' },
      { kind: 'bullet', text: 'Congelar contrataciones' },
      { kind: 'bullet', text: 'Revisar en septiembre' },
    ]);
  });

  it('keeps what the user typed above it as a paragraph', () => {
    const blocks = parseBlocks('Lo que escribí yo\n\n## Summary\n\n- Algo');
    expect(blocks[0]).toEqual({ kind: 'paragraph', text: 'Lo que escribí yo' });
  });

  it('joins wrapped lines into one paragraph', () => {
    // A line break mid-sentence is wrapping, not a new paragraph — which is how
    // someone typing into the note expects it to behave.
    expect(parseBlocks('una frase\nque sigue aquí')).toEqual([
      { kind: 'paragraph', text: 'una frase que sigue aquí' },
    ]);
  });

  it('separates paragraphs on a blank line', () => {
    expect(parseBlocks('primero\n\nsegundo')).toEqual([
      { kind: 'paragraph', text: 'primero' },
      { kind: 'paragraph', text: 'segundo' },
    ]);
  });

  it('accepts both bullet markers', () => {
    expect(parseBlocks('- uno\n* dos').every((block) => block.kind === 'bullet')).toBe(true);
  });

  it('reads level three headings as their own level', () => {
    expect(parseBlocks('### Detalle')).toEqual([
      { kind: 'heading', level: 3, text: 'Detalle' },
    ]);
  });

  it('leaves syntax it does not know as text rather than mangling it', () => {
    // The subset is what this app writes; anything a user types outside it has
    // to survive readable, not be half-parsed.
    expect(parseBlocks('# Uno')).toEqual([{ kind: 'paragraph', text: '# Uno' }]);
    expect(parseBlocks('> cita')).toEqual([{ kind: 'paragraph', text: '> cita' }]);
    expect(parseBlocks('1. numerada')).toEqual([{ kind: 'paragraph', text: '1. numerada' }]);
  });

  it('does not treat a dash inside a sentence as a bullet', () => {
    expect(parseBlocks('esto - aquello')).toEqual([
      { kind: 'paragraph', text: 'esto - aquello' },
    ]);
  });

  it('does not treat a bare dash as a bullet', () => {
    // `- ` with nothing after it is not an item, and rendering an empty bullet
    // is worse than showing the character.
    expect(parseBlocks('-')).toEqual([{ kind: 'paragraph', text: '-' }]);
  });

  it('returns nothing for an empty body', () => {
    expect(parseBlocks('')).toEqual([]);
    expect(parseBlocks('\n\n  \n')).toEqual([]);
  });
});

describe('toPreviewText', () => {
  it('shows prose, not syntax', () => {
    // The point: a card is a glance, and `## Summary` in a preview tells the
    // reader nothing while costing a line.
    const markdown = '## Summary\n\n- Se revisó el gasto\n\n## Decisions\n\n- Congelar';
    expect(toPreviewText(markdown)).toBe('Summary · Se revisó el gasto · Decisions · Congelar');
  });

  it('leads with what the user wrote', () => {
    expect(toPreviewText('Mis notas\n\n## Summary\n\n- Algo')).toBe('Mis notas · Summary · Algo');
  });

  it('is empty for an empty body', () => {
    expect(toPreviewText('')).toBe('');
  });
});
