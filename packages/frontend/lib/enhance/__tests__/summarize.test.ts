import { describe, expect, it, vi } from 'vitest';

import type { PendingExpansion } from '@/lib/artifact/types';
import type { EnhanceRequest, SummarizerProgress } from '@/lib/enhance/contract';
import { summarize } from '@/lib/enhance/summarize';

/** A document with one paragraph per line given, which is what the model returns now. */
function reply(
  paragraphs: (string | { text: string; s?: number[] })[],
  title = 'Charla',
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    title,
    sections: [
      {
        blocks: paragraphs.map((entry) =>
          typeof entry === 'string'
            ? { type: 'paragraph', text: entry, s: [] }
            : { type: 'paragraph', text: entry.text, s: entry.s ?? [] },
        ),
      },
    ],
    actions: [],
    openQuestions: [],
    listAdditions: [],
    ...extra,
  });
}

/** The paragraphs of the merged document, for the assertions below. */
function paragraphsOf(result: { sections: { blocks: { text?: string }[] }[] } | null): string[] {
  return (result?.sections ?? []).flatMap((section) =>
    section.blocks.map((block) => block.text ?? ''),
  );
}

function request(lineCount: number, over: Partial<EnhanceRequest> = {}): EnhanceRequest {
  return {
    transcript: Array.from({ length: lineCount }, (_, index) => ({
      atMs: index * 1000,
      // Long enough that a handful of lines exceed one window.
      text: `linea ${String(index)} ${'x'.repeat(400)}`,
      segmentIds: [`c1#0.${String(index)}`],
    })),
    language: 'es',
    profile: 'auto',
    intent: 'freeform',
    expansions: [],
    ...over,
  };
}

describe('asking the model', () => {
  it('returns what it understood', async () => {
    const generate = vi.fn().mockResolvedValue(reply(['El gasto subió un 12%']));
    const result = await summarize(request(1), generate);
    expect(paragraphsOf(result)[0]).toBe('El gasto subió un 12%');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('asks once per window and combines the answers', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce(reply(['Primera parte']))
      .mockResolvedValueOnce(reply(['Segunda parte']))
      // A long transcript is more than two windows; without a default the third
      // call resolves undefined and the failure looks like a parser bug.
      .mockResolvedValue(reply(['Resto']));
    const result = await summarize(request(30), generate);
    expect(generate.mock.calls.length).toBeGreaterThan(1);
    expect(paragraphsOf(result)).toContain('Primera parte');
  });

  it('never asks about an empty transcript', async () => {
    const generate = vi.fn();
    expect(await summarize(request(0), generate)).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it('shows the model what the user already wrote', async () => {
    const generate = vi.fn().mockResolvedValue(reply(['Algo']));
    await summarize(
      request(1, { existing: { title: '', body: 'ojo con el margen', checklist: [] } }),
      generate,
    );
    expect(String(generate.mock.calls[0][0])).toContain('ojo con el margen');
  });

  it('keeps the rest of the recording when one window comes back unusable', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce('lo siento, no puedo')
      .mockResolvedValue(reply(['Lo que sí entendió']));
    const result = await summarize(request(30), generate);
    expect(paragraphsOf(result)).toEqual(['Lo que sí entendió']);
  });

  it('reports nothing when every reply is unusable', async () => {
    const generate = vi.fn().mockResolvedValue('nada de JSON aquí');
    expect(await summarize(request(4), generate)).toBeNull();
  });
});

describe('citations become evidence', () => {
  it('turns a line number into the segments behind that line', () => {
    // Line numbers are meaningless outside the window the model was shown, so
    // they are resolved while that window is still in hand.
    return summarize(request(3), vi.fn().mockResolvedValue(reply([{ text: 'Algo', s: [2] }]))).then(
      (result) => {
        expect(result?.sections[0].blocks[0].segmentIds).toEqual(['c1#0.1']);
        expect(result?.sections[0].blocks[0].atMs).toBe(1000);
      },
    );
  });

  it('leaves an item with no citations visibly ungrounded', async () => {
    const result = await summarize(
      request(3),
      vi.fn().mockResolvedValue(reply([{ text: 'Según nadie', s: [] }])),
    );
    expect(result?.sections[0].blocks[0].segmentIds).toEqual([]);
    expect(result?.sections[0].blocks[0].atMs).toBeNull();
  });

  it('merges two windows that wrote about the same subject', async () => {
    // Two windows that both wrote "The printing-press analogy" wrote about the
    // same thing. Appending them as separate sections gives the note the same
    // heading twice.
    const withHeading = (text: string, line: number) =>
      JSON.stringify({
        title: 'Charla',
        sections: [
          { heading: 'La imprenta', blocks: [{ type: 'paragraph', text, s: [line] }] },
        ],
        actions: [],
        openQuestions: [],
        listAdditions: [],
      });

    const generate = vi
      .fn()
      .mockResolvedValueOnce(withHeading('Primera mitad.', 1))
      .mockResolvedValue(withHeading('Segunda mitad.', 1));
    const result = await summarize(request(30), generate);
    expect(result?.sections).toHaveLength(1);
    expect(result?.sections[0].blocks.length).toBeGreaterThan(1);
  });
});

describe('authorised expansion', () => {
  const expansion: PendingExpansion = {
    subject: 'una pizza de pollo',
    instructionSource: { captureId: 'c1', startMs: 0, endMs: 1, segmentIds: ['c1#0.0'] },
  };

  it('lets the model add what the user asked it to complete', async () => {
    const generate = vi.fn().mockResolvedValue(
      reply([], 'Compra', {
        listAdditions: [
          { text: 'mozzarella', s: [1], derived: { subject: 'una pizza de pollo', reason: 'base' } },
        ],
      }),
    );
    const result = await summarize(request(2, { expansions: [expansion] }), generate);
    expect(result?.listAdditions[0].derived?.subject).toBe('una pizza de pollo');
  });

  it('refuses an addition for a subject nobody authorised', async () => {
    const generate = vi.fn().mockResolvedValue(
      reply([], 'Compra', {
        listAdditions: [
          { text: 'azafrán', s: [1], derived: { subject: 'una paella', reason: 'me apetece' } },
        ],
      }),
    );
    expect(await summarize(request(2, { expansions: [expansion] }), generate)).toBeNull();
  });
});

describe('progress', () => {
  it('says which window it is on, so the wait is honest', async () => {
    // A 300 MB download and a two-second load look identical from outside, and
    // "Organizing notes…" over silence is what made stopping feel broken.
    const seen: SummarizerProgress[] = [];
    await summarize(
      request(30, { onProgress: (progress) => seen.push(progress) }),
      vi.fn().mockResolvedValue(reply(['Algo'])),
    );
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[0]).toMatchObject({ stage: 'generating', window: { index: 1 } });
    expect(seen[0].window?.total).toBe(seen.length);
  });
});
