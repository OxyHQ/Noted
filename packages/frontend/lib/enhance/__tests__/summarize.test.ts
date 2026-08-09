import { describe, expect, it, vi } from 'vitest';

import { summarize } from '@/lib/enhance/summarize';
import type { EnhanceRequest } from '@/lib/enhance/contract';

function reply(notes: string[], title = 'Charla'): string {
  return JSON.stringify({ title, notes, actions: [], openQuestions: [] });
}

function request(lineCount: number): EnhanceRequest {
  return {
    transcript: Array.from({ length: lineCount }, (_, index) => ({
      atMs: index * 1000,
      // Long enough that a handful of lines exceed one window.
      text: `linea ${String(index)} ${'x'.repeat(400)}`,
    })),
    language: 'es',
  };
}

describe('summarize', () => {
  it('asks the model and returns what it understood', async () => {
    const generate = vi.fn().mockResolvedValue(reply(['El gasto subió un 12%']));
    const result = await summarize(request(1), generate);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result?.notes).toEqual(['El gasto subió un 12%']);
  });

  it('asks once per window and combines the answers', async () => {
    // A meeting longer than the context window is the normal case, not an edge
    // one — an hour of speech is many times what a phone model can hold.
    const generate = vi
      .fn()
      .mockResolvedValueOnce(reply(['primero']))
      .mockResolvedValueOnce(reply(['segundo']))
      .mockResolvedValue(reply(['tercero']));

    const result = await summarize(request(40), generate);

    expect(generate.mock.calls.length).toBeGreaterThan(1);
    expect(result?.notes.slice(0, 2)).toEqual(['primero', 'segundo']);
  });

  it('tells a window of several that it is only a part', async () => {
    const generate = vi.fn().mockResolvedValue(reply(['algo']));
    await summarize(request(40), generate);
    expect(generate.mock.calls[0][0]).toContain('part of a longer conversation');
  });

  it('keeps the rest of the meeting when one window comes back unusable', async () => {
    // One bad reply should not cost the user the whole note.
    const generate = vi
      .fn()
      .mockResolvedValueOnce('Lo siento, no puedo ayudarte con eso.')
      .mockResolvedValue(reply(['esto sí sirve']));

    const result = await summarize(request(40), generate);
    expect(result?.notes).toContain('esto sí sirve');
  });

  it('reports nothing when every reply is unusable', async () => {
    // Null is a complete answer: the deterministic note is already written.
    const generate = vi.fn().mockResolvedValue('no.');
    expect(await summarize(request(2), generate)).toBeNull();
  });

  it('never asks about an empty transcript', async () => {
    const generate = vi.fn();
    expect(await summarize({ transcript: [], language: 'es' }, generate)).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it('shows the model what the user already wrote', async () => {
    const generate = vi.fn().mockResolvedValue(reply(['algo']));
    await summarize(
      {
        ...request(1),
        existing: { title: '', body: 'Ya escribí esto', checklist: [] },
      },
      generate,
    );
    expect(generate.mock.calls[0][0]).toContain('Ya escribí esto');
  });
});
