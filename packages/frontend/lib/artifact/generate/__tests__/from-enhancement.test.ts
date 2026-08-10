import { describe, expect, it } from 'vitest';

import { unitsOf } from '@/lib/artifact/__tests__/fixtures';

import { allItems } from '@/lib/artifact/artifact';
import { composeNote } from '@/lib/artifact/compose';
import { enhancementToArtifact } from '@/lib/artifact/generate/from-enhancement';
import { renderArtifact } from '@/lib/artifact/render';
import type { PendingExpansion } from '@/lib/artifact/types';
import type { ResolvedBlock, ResolvedEnhancement, ResolvedItem } from '@/lib/enhance/contract';

const CAPTURE_ID = 'c1';
const FALLBACK = '8 Aug 2026, 10:00';

const EXPANSION: PendingExpansion = {
  subject: 'una pizza de pollo',
  instructionSource: { captureId: CAPTURE_ID, startMs: 9_000, endMs: 12_000, segmentIds: ['c1#0.3'] },
};

function item(text: string, over: Partial<ResolvedItem> = {}): ResolvedItem {
  return { text, segmentIds: ['c1#0.0'], atMs: 0, ...over };
}

function para(text: string, over: Partial<ResolvedBlock> = {}): ResolvedBlock {
  return { type: 'paragraph', text, segmentIds: ['c1#0.0'], atMs: 0, ...over };
}

function enhancement(over: Partial<ResolvedEnhancement> = {}): ResolvedEnhancement {
  return {
    title: 'Revisión del presupuesto',
    people: [],
    sections: [{ blocks: [para('Al final vamos a usar el proveedor barato')] }],
    actions: [item('Enviar el contrato antes del viernes', { segmentIds: ['c1#0.1'], atMs: 6_000 })],
    openQuestions: [item('¿Quién habla con el proveedor?', { segmentIds: ['c1#0.2'], atMs: 12_000 })],
    listAdditions: [],
    ...over,
  };
}

function build(over: Partial<ResolvedEnhancement> = {}, expansions: PendingExpansion[] = []) {
  return enhancementToArtifact({
    enhancement: enhancement(over),
    captureId: CAPTURE_ID,
    noteId: 'n1',
    stage: 'final',
    profile: 'meeting',
    intent: 'freeform',
    expansions,
    transcriptRevision: 3,
    now: '2026-08-08T11:00:00.000Z',
    fallbackTitle: FALLBACK,
  });
}

describe('the model writes the same shape', () => {
  it('writes its notes as prose, not as a list of peers', () => {
    // The change #59 exists for. A bullet list asserts that its lines are peers;
    // connected reasoning is not, and prefixing every item with a dash destroyed
    // the connection rather than styling it badly.
    expect(renderArtifact(build())).toBe(
      'Al final vamos a usar el proveedor barato\n\n## Open questions\n\n- ¿Quién habla con el proveedor?',
    );
  });

  it('keeps the heading the model gave a section', () => {
    const artifact = build({
      sections: [{ heading: 'El proveedor', blocks: [para('Al final el barato.')] }],
    });
    expect(renderArtifact(artifact)).toContain('## El proveedor');
  });

  it('records who was speaking when the model says, and invents nobody', () => {
    const named = build({ people: [{ role: 'Ministro de educación', segmentIds: ['c1#0.0'], atMs: 0 }] });
    expect(named.people?.[0]).toMatchObject({ role: 'Ministro de educación' });
    expect(named.people?.[0].name).toBeUndefined();
    expect(build().people).toEqual([]);
  });

  it('puts its actions in the checklist and nowhere else', () => {
    const artifact = build();
    expect(artifact.checklists[0].items.map((entry) => entry.text)).toEqual([
      'Enviar el contrato antes del viernes',
    ]);
    expect(renderArtifact(artifact)).not.toContain('Enviar el contrato');
  });

  it('omits an empty section rather than announcing it', () => {
    expect(renderArtifact(build({ openQuestions: [] }))).not.toContain('## Open questions');
    expect(build({ actions: [] }).checklists).toEqual([]);
    expect(build({ sections: [] }).sections).toEqual([]);
  });

  it('carries the profile through, so the note is organised as what it is', () => {
    expect(build().profile).toBe('meeting');
  });

  it('names the note when the model returned no title', () => {
    expect(build({ title: '   ' }).title?.text).toBe(FALLBACK);
  });
});

describe('grounding', () => {
  it('cites the segments the model actually referenced', () => {
    // The first version of this matched sentences to blocks by similarity and
    // cited whatever looked closest. That was a guess; these are the lines the
    // model said it used, checked against the ones it was shown.
    const cited = allItems(build()).find((entry) => entry.text.startsWith('Al final'));
    expect(cited?.sources[0]?.segmentIds).toEqual(['c1#0.0']);
    expect(cited?.origin).toBe('transcript');
  });

  it('cites nothing when the model cited nothing', () => {
    // An item a reader can follow to the wrong moment is worse than one they
    // cannot follow at all.
    const ungrounded = build({
      sections: [{ blocks: [para('Según nadie', { segmentIds: [], atMs: null })] }],
    });
    expect(unitsOf(ungrounded.sections[0])[0].sources).toEqual([]);
  });
});

describe('derived items', () => {
  const derived = item('mozzarella', {
    segmentIds: [],
    atMs: null,
    derived: { subject: 'una pizza de pollo', reason: 'base de la pizza' },
  });

  it('are marked as knowledge Noted supplied, with the receipt', () => {
    const artifact = build({ listAdditions: [derived] }, [EXPANSION]);
    const added = artifact.checklists[0].items[0];
    expect(added.origin).toBe('derived-from-instruction');
    expect(added.instructionSource).toEqual(EXPANSION.instructionSource);
    expect(added.derivationReason).toBe('base de la pizza');
  });

  it('go into the list the user dictated, not a second one beside it', () => {
    const artifact = build({ listAdditions: [derived], actions: [] }, [EXPANSION]);
    expect(artifact.checklists).toHaveLength(1);
    expect(artifact.checklists[0].id).toBe('checklist:c1:dictated');
  });

  it('are reported as ordinary content when the receipt is missing', () => {
    // Without the authorisation there is nothing to point at, and an unmarked
    // derived item is indistinguishable from something a speaker said. Reporting
    // it as transcript content is the honest fallback — and it then has to be
    // grounded like any other, which this one is not.
    const artifact = build({ listAdditions: [derived] }, []);
    const added = artifact.checklists[0].items[0];
    expect(added.origin).toBe('transcript');
    expect(added.instructionSource).toBeUndefined();
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
