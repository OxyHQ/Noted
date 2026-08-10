import { describe, expect, it } from 'vitest';

import { allItems } from '@/lib/artifact/artifact';
import { composeNote } from '@/lib/artifact/compose';
import { enhancementToArtifact } from '@/lib/artifact/generate/from-enhancement';
import { renderArtifact } from '@/lib/artifact/render';
import type { Enhancement } from '@/lib/enhance/contract';
import type { Block } from '@/lib/structure/segment';

const CAPTURE_ID = 'c1';
const FALLBACK = '8 Aug 2026, 10:00';

const BLOCKS: Block[] = [
  {
    startMs: 0,
    endMs: 5_000,
    text: 'Al final vamos a usar el proveedor barato para todo el trimestre',
    speaker: null,
    segmentIds: ['c1#0.0'],
  },
  {
    startMs: 6_000,
    endMs: 11_000,
    text: 'Hay que enviar el contrato antes del viernes por la mañana',
    speaker: null,
    segmentIds: ['c1#0.1'],
  },
];

function enhancement(over: Partial<Enhancement> = {}): Enhancement {
  return {
    title: 'Revisión del presupuesto',
    notes: ['Al final vamos a usar el proveedor barato para todo el trimestre'],
    actions: ['Hay que enviar el contrato antes del viernes por la mañana'],
    openQuestions: ['¿Quién habla con el proveedor?'],
    ...over,
  };
}

function build(over: Partial<Enhancement> = {}) {
  return enhancementToArtifact({
    enhancement: enhancement(over),
    captureId: CAPTURE_ID,
    noteId: 'n1',
    blocks: BLOCKS,
    stage: 'final',
    transcriptRevision: 3,
    now: '2026-08-08T11:00:00.000Z',
    fallbackTitle: FALLBACK,
  });
}

describe('the model writes the same shape', () => {
  it('puts its notes in the body with no heading over them', () => {
    // "## Summary" over the only content on the page is a label for something
    // that needs no labelling — and the note's structure must not change because
    // a model happened to be installed.
    expect(renderArtifact(build())).toBe(
      '- Al final vamos a usar el proveedor barato para todo el trimestre\n\n## Open questions\n\n- ¿Quién habla con el proveedor?',
    );
  });

  it('puts its actions in the checklist and nowhere else', () => {
    const artifact = build();
    expect(artifact.checklists[0].items.map((entry) => entry.text)).toEqual([
      'Hay que enviar el contrato antes del viernes por la mañana',
    ]);
    expect(renderArtifact(artifact)).not.toContain('enviar el contrato');
  });

  it('omits an empty section rather than announcing it', () => {
    expect(renderArtifact(build({ openQuestions: [] }))).not.toContain('## Open questions');
    expect(build({ actions: [] }).checklists).toEqual([]);
    expect(build({ notes: [] }).sections).toEqual([]);
  });

  it('drops blank lines the model padded its reply with', () => {
    expect(build({ notes: ['  ', 'Algo real que se dijo'] }).sections[0].items).toHaveLength(1);
  });

  it('names the note when the model returned no title', () => {
    expect(build({ title: '   ' }).title?.text).toBe(FALLBACK);
  });
});

describe('grounding', () => {
  it('cites the moment an item is plainly about', () => {
    const cited = allItems(build()).find((entry) => entry.text.startsWith('Al final'));
    expect(cited?.sources[0]?.segmentIds).toEqual(['c1#0.0']);
  });

  it('cites nothing rather than the moment it was probably about', () => {
    // An invented citation is worse than a missing one: a reader who follows it
    // and finds the wrong moment stops trusting every other citation in the note.
    const invented = build({ notes: ['El equipo está contento con el resultado general'] });
    expect(invented.sections[0].items[0].sources).toEqual([]);
  });
});

describe('what the user wrote', () => {
  it('survives the model exactly as it survives the rules', () => {
    const composed = composeNote({
      user: {
        title: 'Presupuesto Q3',
        body: '- ojo con el margen',
        checklist: [{ id: 'mine', text: 'Llamar a Ana', checked: true }],
      },
      final: build(),
      fallbackTitle: FALLBACK,
    });
    expect(composed.title).toBe('Presupuesto Q3');
    expect(composed.body.startsWith('- ojo con el margen')).toBe(true);
    expect(composed.checklist[0]).toEqual({ id: 'mine', text: 'Llamar a Ana', checked: true });
  });
});
