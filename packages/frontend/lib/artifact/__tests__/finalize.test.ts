import { describe, expect, it } from 'vitest';

import { visibleItems } from '@/lib/artifact/artifact';
import {
  closeAnsweredQuestions,
  finalizeArtifact,
  mergeSemanticDuplicates,
  supersedeRevisedDecisions,
} from '@/lib/artifact/finalize';
import type { UserItemOverride } from '@noted/shared-types';
import { emptyOverride, overridesById } from '@/lib/artifact/ownership';
import {
  artifact,
  checklist,
  checklistItem,
  item,
  NOW,
  section,
  source,
  unitsOf,
} from '@/lib/artifact/__tests__/fixtures';

const NONE = overridesById([]);

function overrides(...entries: (Partial<UserItemOverride> & { itemId: string })[]) {
  return overridesById(entries.map((entry) => ({ ...emptyOverride(entry.itemId), ...entry })));
}

describe('mergeSemanticDuplicates', () => {
  it('merges a point somebody made twice in different words', () => {
    // The reconciliation the issue asks for by name: one coherent point, with
    // both source ranges.
    const merged = mergeSemanticDuplicates([
      item('a', 'PostgreSQL será la única base de datos', { sources: [source(0, 1_000, 's1')] }),
      item('b', 'PostgreSQL será la única base de datos del proyecto', {
        sources: [source(60_000, 61_000, 's2')],
      }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].sources).toHaveLength(2);
  });

  it('keeps the id and the place of the wording the reader already saw', () => {
    const merged = mergeSemanticDuplicates([
      item('primero', 'hay un momento en el que parece pensar'),
      item('segundo', 'Cuando le mandas un mensaje hay un momento en el que parece pensar'),
    ]);
    expect(merged[0].id).toBe('primero');
    // …but the fullest wording wins the text.
    expect(merged[0].text).toBe(
      'Cuando le mandas un mensaje hay un momento en el que parece pensar',
    );
  });

  it('leaves two genuinely different points alone', () => {
    const merged = mergeSemanticDuplicates([
      item('a', 'El presupuesto sube un diez por ciento este trimestre'),
      item('b', 'La migración de base de datos termina el viernes'),
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe('supersedeRevisedDecisions', () => {
  it('retires a decision an explicit correction replaced', () => {
    // The issue's example. Monday is current; Friday is history, and presenting
    // it as another active decision is the bug.
    const settled = supersedeRevisedDecisions([
      item('viernes', 'Lanzamos el viernes'),
      item('lunes', 'Al final se retrasa hasta el lunes'),
    ]);
    expect(settled[0].status).toBe('superseded');
    expect(settled[1].status).toBe('active');
    expect(visibleItems(settled).map((entry) => entry.id)).toEqual(['lunes']);
  });

  it('retires only the most recent decision, not the whole history', () => {
    const settled = supersedeRevisedDecisions([
      item('a', 'Usamos Postgres para todo'),
      item('b', 'Lanzamos el viernes'),
      item('c', 'Al final se retrasa hasta el lunes'),
    ]);
    expect(settled.map((entry) => entry.status)).toEqual(['active', 'superseded', 'active']);
  });

  it('does not retire anything without an explicit marker', () => {
    // Tone is not evidence. A rule that guessed would quietly retire decisions
    // nobody revoked, which is worse than leaving both in — the reader cannot
    // tell it happened.
    const settled = supersedeRevisedDecisions([
      item('a', 'Lanzamos el viernes'),
      item('b', 'Se retrasa hasta el lunes'),
    ]);
    expect(settled.every((entry) => entry.status === 'active')).toBe(true);
  });

  it('does not retire a decision the correction is merely restating', () => {
    const settled = supersedeRevisedDecisions([
      item('a', 'Al final vamos a usar el proveedor barato'),
      item('b', 'Al final vamos a usar el proveedor barato, confirmado'),
    ]);
    expect(settled[0].status).toBe('active');
  });
});

describe('closeAnsweredQuestions', () => {
  const asked = [item('q1', '¿Eliminamos MongoDB?'), item('q2', '¿Quién firma el contrato?')];

  it('closes the one the recording went on to answer', () => {
    // A question raised in one window and settled in the next: the
    // whole-transcript pass stops reporting it, and that is the signal.
    const closed = closeAnsweredQuestions(asked, [asked[1]], NONE);
    expect(closed[0].status).toBe('resolved');
    expect(closed[1].status).toBe('active');
  });

  it('recognises the same question worded differently', () => {
    const closed = closeAnsweredQuestions(asked, [item('otro', '¿Quién firma el contrato?')], NONE);
    expect(closed[1].status).toBe('active');
  });

  it('leaves a question the user touched alone', () => {
    const closed = closeAnsweredQuestions(asked, [], overrides({ itemId: 'q1', adopted: true }));
    expect(closed[0].status).toBe('active');
  });
});

describe('finalizeArtifact', () => {
  const live = artifact({
    stage: 'live',
    sections: [section('s', [item('n1', 'PostgreSQL será la única base de datos')])],
    openQuestions: [item('q1', '¿Eliminamos MongoDB?')],
  });

  it('settles the stage, whatever the fresh reading called itself', () => {
    const settled = finalizeArtifact({
      previous: live,
      next: artifact({ stage: 'live', sections: live.sections }),
      overrides: NONE,
      now: '2026-08-10T12:00:00.000Z',
    });
    expect(settled.stage).toBe('final');
    expect(settled.updatedAt).toBe('2026-08-10T12:00:00.000Z');
  });

  it('closes a question the live pass raised and the final reading does not', () => {
    // Across windows: the question was asked at 00:04 and answered at 00:31, and
    // only a pass over the whole recording can see that.
    const settled = finalizeArtifact({
      previous: live,
      next: artifact({
        stage: 'final',
        sections: [
          section('s', [
            item('n1', 'PostgreSQL será la única base de datos'),
            item('n2', 'La migración terminó y Mongo ya no se usa'),
          ]),
        ],
        openQuestions: [],
      }),
      overrides: NONE,
      now: '2026-08-10T12:00:00.000Z',
    });
    expect(visibleItems(settled.openQuestions)).toEqual([]);
    expect(settled.openQuestions[0].status).toBe('resolved');
  });

  it('merges a point the recording made twice', () => {
    const settled = finalizeArtifact({
      previous: null,
      next: artifact({
        stage: 'final',
        sections: [
          section('s', [
            item('a', 'PostgreSQL será la única base de datos'),
            item('b', 'PostgreSQL será la única base de datos del proyecto'),
          ]),
        ],
      }),
      overrides: NONE,
      now: '2026-08-10T12:00:00.000Z',
    });
    expect(unitsOf(settled.sections[0])).toHaveLength(1);
  });

  it('retires an overturned decision and keeps the current one', () => {
    const settled = finalizeArtifact({
      previous: null,
      next: artifact({
        stage: 'final',
        sections: [
          section(
            's',
            [item('viernes', 'Lanzamos el viernes'), item('lunes', 'Al final se retrasa hasta el lunes')],
            { kind: 'decisions' },
          ),
        ],
      }),
      overrides: NONE,
      now: '2026-08-10T12:00:00.000Z',
    });
    expect(visibleItems(unitsOf(settled.sections[0])).map((entry) => entry.id)).toEqual(['lunes']);
  });

  it('drops a section whose every item was retired', () => {
    const settled = finalizeArtifact({
      previous: null,
      next: artifact({
        stage: 'final',
        sections: [section('s', [item('a', 'Fuera', { status: 'removed' })])],
      }),
      overrides: NONE,
      now: '2026-08-10T12:00:00.000Z',
    });
    expect(settled.sections).toEqual([]);
  });

  it('keeps the note’s original creation time', () => {
    const settled = finalizeArtifact({
      previous: live,
      next: artifact({ stage: 'final', createdAt: '2027-01-01T00:00:00.000Z' }),
      overrides: NONE,
      now: '2026-08-10T12:00:00.000Z',
    });
    expect(settled.createdAt).toBe(live.createdAt);
  });
});

describe('what the user ticked while the recording was still running', () => {
  /**
   * The failure this exists for.
   *
   * Item ids are content hashes, so a task whose WORDING changes between the
   * live pass and the end of the recording comes back with a different id — and
   * the tick, which is stored against the old one, stops applying. It only
   * happens when the recogniser corrects a sentence it already emitted, which is
   * why it went unnoticed: with the text unchanged the hash matches by luck.
   *
   * Found by the evaluation corpus, on the scenario written for exactly that
   * ("Whisper repetitions and corrected/re-emitted segments").
   */
  const live = artifact({
    stage: 'live',
    checklists: [
      checklist('checklist:cap_1:actions', [
        checklistItem('action:early', 'Y hay que mandarlo a contabilidad', { checked: true }),
      ]),
    ],
  });

  // The same commitment, as the recogniser finally heard it.
  const corrected = artifact({
    stage: 'final',
    checklists: [
      checklist('checklist:cap_1:actions', [
        checklistItem(
          'action:late',
          'El informe se entrega el viernes y hay que mandarlo a contabilidad',
        ),
      ]),
    ],
  });

  it('is still the same item after the recogniser corrects the sentence', () => {
    const settled = finalizeArtifact({
      previous: live,
      next: corrected,
      overrides: overrides({ itemId: 'action:early', checked: true }),
      now: NOW,
    });
    expect(settled.checklists[0].items.map((entry) => entry.id)).toEqual(['action:early']);
  });

  it('is not vacuous — an unrelated task keeps its own identity', () => {
    // If the reconciliation matched anything to anything, this would also
    // collapse onto the live item.
    const unrelated = artifact({
      stage: 'final',
      checklists: [
        checklist('checklist:cap_1:actions', [
          checklistItem('action:other', 'Reservar la sala para el martes'),
        ]),
      ],
    });
    const settled = finalizeArtifact({
      previous: live,
      next: unrelated,
      overrides: NONE,
      now: NOW,
    });
    expect(settled.checklists[0].items.map((entry) => entry.id)).toEqual(['action:other']);
  });

  it('still lets the complete reading drop a task nobody touched', () => {
    // The finaliser has read the whole recording; a live guess it no longer
    // makes should go. Only what the user touched is kept against its judgement.
    const settled = finalizeArtifact({
      previous: artifact({
        stage: 'live',
        checklists: [
          checklist('checklist:cap_1:actions', [checklistItem('action:guess', 'Algo que se oyó mal')]),
        ],
      }),
      next: artifact({ stage: 'final', checklists: [] }),
      overrides: NONE,
      now: NOW,
    });
    expect(settled.checklists).toEqual([]);
  });
});
