import { describe, expect, it } from 'vitest';

import {
  buildPrompt,
  mergeEnhancements,
  splitForContext,
  type TranscriptLine,
} from '@/lib/enhance/prompt';
import type { Enhancement } from '@/lib/enhance/contract';

function lines(count: number, text: string): TranscriptLine[] {
  return Array.from({ length: count }, (_, index) => ({ atMs: index * 1000, text }));
}

function enhancement(overrides: Partial<Enhancement>): Enhancement {
  return { title: '', notes: [], actions: [], openQuestions: [], ...overrides };
}

describe('splitForContext', () => {
  it('keeps a short transcript in one window', () => {
    expect(splitForContext(lines(3, 'hola'), 100)).toHaveLength(1);
  });

  it('splits a long transcript rather than dropping any of it', () => {
    // The whole point: nothing is thrown away. A truncating implementation
    // would pass a "fits in one window" test and lose the end of the meeting,
    // which is where decisions live.
    const transcript = lines(20, 'x'.repeat(20));
    const windows = splitForContext(transcript, 100);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows.flat()).toHaveLength(20);
    expect(windows.flat().map((line) => line.atMs)).toEqual(transcript.map((line) => line.atMs));
  });

  it('keeps every window within the budget', () => {
    for (const window of splitForContext(lines(20, 'x'.repeat(20)), 100)) {
      const size = window.reduce((total, line) => total + line.text.length + 1, 0);
      // A single over-long line is the one allowed exception, tested below.
      expect(window.length === 1 || size <= 100).toBe(true);
    }
  });

  it('never splits a single line, even one larger than the budget', () => {
    const windows = splitForContext([{ atMs: 0, text: 'y'.repeat(500) }], 100);
    expect(windows).toEqual([[{ atMs: 0, text: 'y'.repeat(500) }]]);
  });

  it('returns nothing for an empty transcript', () => {
    expect(splitForContext([], 100)).toEqual([]);
  });
});

describe('buildPrompt', () => {
  it('includes the transcript with timestamps', () => {
    const prompt = buildPrompt([{ atMs: 65_000, text: 'Empezamos' }], { language: 'auto' });
    expect(prompt).toContain('[01:05] Empezamos');
  });

  it('forbids inventing what was not said', () => {
    // The instruction that stops a small model filling the shape it was given
    // with things nobody said. An invented action is worse than a missing one,
    // because the user acts on it.
    const prompt = buildPrompt(lines(1, 'hola'), { language: 'auto' });
    expect(prompt).toContain('Do not invent or infer information that was not said');
    expect(prompt).toContain('Only create an action when someone actually committed');
  });

  it('asks for the fields the parser reads, and no others', () => {
    // The prompt, the generation grammar and the parser have to agree on the
    // shape. They are in three files, and a rename in one is silent in the
    // other two: the model answers, and the answer is dropped.
    const prompt = buildPrompt(lines(1, 'hola'), { language: 'auto' });
    for (const field of ['title', 'notes', 'actions', 'openQuestions']) {
      expect(prompt).toContain(field);
    }
  });

  it('passes the user own notes so they are not repeated', () => {
    const prompt = buildPrompt(lines(1, 'hola'), {
      language: 'es',
      existingBody: 'Ya escribí esto',
    });
    expect(prompt).toContain('Ya escribí esto');
    expect(prompt).toContain('Do not repeat them');
  });

  it('omits the notes section entirely when the user wrote nothing', () => {
    const prompt = buildPrompt(lines(1, 'hola'), { language: 'es', existingBody: '   ' });
    expect(prompt).not.toContain('Do not repeat them');
  });

  it('tells a partial window not to conclude about the whole meeting', () => {
    expect(buildPrompt(lines(1, 'hola'), { language: 'auto', isPartial: true })).toContain(
      'part of a longer conversation',
    );
    expect(buildPrompt(lines(1, 'hola'), { language: 'auto' })).toContain(
      'the full conversation',
    );
  });
});

describe('mergeEnhancements', () => {
  it('keeps the order the meeting happened in', () => {
    const merged = mergeEnhancements([
      enhancement({ notes: ['primero'] }),
      enhancement({ notes: ['segundo'] }),
    ]);
    expect(merged?.notes).toEqual(['primero', 'segundo']);
  });

  it('drops a point restated in a later window', () => {
    const merged = mergeEnhancements([
      enhancement({ notes: ['Congelar contrataciones'] }),
      enhancement({ notes: ['congelar contrataciones'] }),
    ]);
    expect(merged?.notes).toEqual(['Congelar contrataciones']);
  });

  it('takes the title from the first window that named the meeting', () => {
    const merged = mergeEnhancements([
      enhancement({ notes: ['algo'] }),
      enhancement({ title: 'Presupuesto', notes: ['más'] }),
      enhancement({ title: 'Otra cosa', notes: ['y más'] }),
    ]);
    expect(merged?.title).toBe('Presupuesto');
  });

  it('reports nothing when no window had anything to say', () => {
    expect(mergeEnhancements([enhancement({ title: 'Reunión' })])).toBeNull();
    expect(mergeEnhancements([])).toBeNull();
  });
});
