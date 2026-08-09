import { describe, expect, it } from 'vitest';

import { enhancementToNotePatch } from '@/lib/enhance/apply';
import type { Enhancement } from '@/lib/enhance/contract';

let counter = 0;
const makeId = () => `id-${String((counter += 1))}`;

function enhancement(overrides: Partial<Enhancement> = {}): Enhancement {
  return {
    title: 'Presupuesto Q3',
    summary: ['Se revisó el gasto'],
    decisions: ['Congelar contrataciones'],
    actions: ['Nate manda el desglose'],
    questions: ['¿Quién aprueba AWS?'],
    ...overrides,
  };
}

const FALLBACK = '9/8/2026, 12:00';

describe('enhancementToNotePatch', () => {
  it('writes the sections the model filled', () => {
    const patch = enhancementToNotePatch(enhancement(), { makeId, fallbackTitle: FALLBACK });
    expect(patch.body).toContain('## Summary');
    expect(patch.body).toContain('- Se revisó el gasto');
    expect(patch.body).toContain('## Decisions');
    expect(patch.body).toContain('## Open questions');
  });

  it('omits a section the model left empty', () => {
    const patch = enhancementToNotePatch(enhancement({ decisions: [], questions: [] }), {
      makeId,
      fallbackTitle: FALLBACK,
    });
    expect(patch.body).not.toContain('## Decisions');
    expect(patch.body).not.toContain('## Open questions');
    expect(patch.body).toContain('## Summary');
  });

  it('keeps tasks out of the body, since they are the checklist', () => {
    const patch = enhancementToNotePatch(enhancement(), { makeId, fallbackTitle: FALLBACK });
    expect(patch.body).not.toContain('Nate manda el desglose');
    expect(patch.checklist?.map((item) => item.text)).toContain('Nate manda el desglose');
  });

  it('puts what the person wrote first, verbatim', () => {
    const patch = enhancementToNotePatch(enhancement(), {
      makeId,
      fallbackTitle: FALLBACK,
      existing: { title: '', body: 'Lo que escribí yo', checklist: [] },
    });
    expect(patch.body?.startsWith('Lo que escribí yo')).toBe(true);
  });

  it('never overwrites a title the person gave', () => {
    const patch = enhancementToNotePatch(enhancement(), {
      makeId,
      fallbackTitle: FALLBACK,
      existing: { title: 'Mi título', body: '', checklist: [] },
    });
    expect(patch.title).toBe('Mi título');
  });

  it('falls back when neither the person nor the model named it', () => {
    const patch = enhancementToNotePatch(enhancement({ title: '  ' }), {
      makeId,
      fallbackTitle: FALLBACK,
    });
    expect(patch.title).toBe(FALLBACK);
  });

  it('keeps the ticks and the order of the checklist the person had', () => {
    const patch = enhancementToNotePatch(enhancement(), {
      makeId,
      fallbackTitle: FALLBACK,
      existing: {
        title: '',
        body: '',
        checklist: [
          { id: 'mine-1', text: 'Ya hecho', checked: true },
          { id: 'mine-2', text: 'Pendiente', checked: false },
        ],
      },
    });
    expect(patch.checklist?.slice(0, 2)).toEqual([
      { id: 'mine-1', text: 'Ya hecho', checked: true },
      { id: 'mine-2', text: 'Pendiente', checked: false },
    ]);
  });

  it('does not add a task the person already wrote down', () => {
    // The model noticing something the user already typed must not produce a
    // duplicate — and the comparison has to ignore case and trailing
    // punctuation, which is exactly how the two would differ.
    const patch = enhancementToNotePatch(enhancement({ actions: ['nate manda el desglose.'] }), {
      makeId,
      fallbackTitle: FALLBACK,
      existing: {
        title: '',
        body: '',
        checklist: [{ id: 'mine-1', text: 'Nate manda el desglose', checked: false }],
      },
    });
    expect(patch.checklist).toHaveLength(1);
    expect(patch.checklist?.[0].id).toBe('mine-1');
  });
});
