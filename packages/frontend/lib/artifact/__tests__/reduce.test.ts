import { describe, expect, it } from 'vitest';

import { visibleItems } from '@/lib/artifact/artifact';
import { emptyOverride, overridesById, type UserItemOverride } from '@/lib/artifact/ownership';
import { mergeSources, reconcileItems, reduceLiveArtifact } from '@/lib/artifact/reduce';
import {
  artifact,
  checklist,
  checklistItem,
  item,
  section,
  source,
} from '@/lib/artifact/__tests__/fixtures';

const NONE = overridesById([]);

function overrides(...entries: (Partial<UserItemOverride> & { itemId: string })[]) {
  return overridesById(entries.map((entry) => ({ ...emptyOverride(entry.itemId), ...entry })));
}

describe('mergeSources', () => {
  it('keeps both ranges when a point was made twice', () => {
    const merged = mergeSources([source(0, 1_000, 'a')], [source(60_000, 61_000, 'b')]);
    expect(merged).toHaveLength(2);
  });

  it('does not repeat a range it already has', () => {
    const same = source(0, 1_000, 'a');
    expect(mergeSources([same], [{ ...same }])).toHaveLength(1);
  });
});

describe('reconcileItems', () => {
  it('keeps the order the reader is already looking at', () => {
    // Replacing the note with each fresh reading is what makes a live note
    // unreadable: bullets reorder under the reader's eye.
    const previous = [item('a', 'Primero'), item('b', 'Segundo'), item('c', 'Tercero')];
    const next = [item('c', 'Tercero'), item('a', 'Primero'), item('b', 'Segundo')];
    expect(
      reconcileItems(previous, next, { overrides: NONE, missing: 'drop' }).map((entry) => entry.id),
    ).toEqual(['a', 'b', 'c']);
  });

  it('improves the wording of a point without moving it', () => {
    // The commonest pair this meets: a sentence cut short by a slice boundary,
    // and the complete version of it a few seconds later. Same point.
    const previous = [item('a', 'Uno'), item('truncado', 'hay un momento en el que parece pensar')];
    const next = [
      item('a', 'Uno'),
      item('completo', 'Cuando le mandas un mensaje hay un momento en el que parece pensar'),
    ];
    const reconciled = reconcileItems(previous, next, { overrides: NONE, missing: 'drop' });
    expect(reconciled.map((entry) => entry.id)).toEqual(['a', 'truncado']);
    expect(reconciled[1].text).toBe(
      'Cuando le mandas un mensaje hay un momento en el que parece pensar',
    );
  });

  it('keeps the sources of both readings', () => {
    const previous = [item('a', 'hay un momento en el que parece pensar', { sources: [source(0, 1_000, 's1')] })];
    const next = [
      item('b', 'Cuando le mandas un mensaje hay un momento en el que parece pensar', {
        sources: [source(2_000, 4_000, 's2')],
      }),
    ];
    expect(reconcileItems(previous, next, { overrides: NONE, missing: 'drop' })[0].sources).toHaveLength(2);
  });

  it('appends genuinely new items at the end, where a reader expects them', () => {
    const reconciled = reconcileItems([item('a', 'Uno')], [item('a', 'Uno'), item('b', 'Dos')], {
      overrides: NONE,
      missing: 'drop',
    });
    expect(reconciled.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('drops what the new reading merged away', () => {
    expect(
      reconcileItems([item('a', 'Uno'), item('b', 'Dos')], [item('a', 'Uno')], {
        overrides: NONE,
        missing: 'drop',
      }).map((entry) => entry.id),
    ).toEqual(['a']);
  });

  it('resolves rather than deletes a question the recording moved past', () => {
    // Its id survives, so anything the user did to it still points at something,
    // and the note can say the difference between "answered" and "never
    // mentioned again".
    const reconciled = reconcileItems(
      [item('q', '¿Eliminamos MongoDB?')],
      [],
      { overrides: NONE, missing: 'resolve' },
    );
    expect(reconciled[0].status).toBe('resolved');
    expect(visibleItems(reconciled)).toEqual([]);
  });

  it('keeps an item the user touched, even when the new reading dropped it', () => {
    const reconciled = reconcileItems(
      [item('a', 'Uno'), item('mio', 'Lo mío')],
      [item('a', 'Uno')],
      { overrides: overrides({ itemId: 'mio', checked: true }), missing: 'drop' },
    );
    expect(reconciled.map((entry) => entry.id)).toEqual(['a', 'mio']);
  });

  it('does not reword an item the user touched', () => {
    // Their edit lives in the overrides and is applied at read time; replacing
    // the text underneath it would make their edit describe a different sentence.
    const reconciled = reconcileItems(
      [item('mio', 'hay un momento en el que parece pensar')],
      [item('nuevo', 'Cuando le mandas un mensaje hay un momento en el que parece pensar')],
      { overrides: overrides({ itemId: 'mio', text: 'mi versión' }), missing: 'drop' },
    );
    expect(reconciled[0].text).toBe('hay un momento en el que parece pensar');
  });

  it('does not resolve a question the user touched', () => {
    const reconciled = reconcileItems([item('q', '¿Y el presupuesto?')], [], {
      overrides: overrides({ itemId: 'q', adopted: true }),
      missing: 'resolve',
    });
    expect(reconciled[0].status).toBe('active');
  });
});

describe('reduceLiveArtifact', () => {
  const previous = artifact({
    sections: [section('section:c:notes', [item('n1', 'Punto uno'), item('n2', 'Punto dos')])],
    checklists: [checklist('checklist:c:actions', [checklistItem('a1', 'Llamar al banco')])],
    openQuestions: [item('q1', '¿Quién firma?')],
  });

  it('is the fresh reading when there is nothing to reconcile against', () => {
    const next = artifact({ sections: [section('s', [item('x', 'Solo')])] });
    expect(reduceLiveArtifact(null, next, NONE)).toBe(next);
  });

  it('folds a new point into the section already on screen', () => {
    const next = artifact({
      sections: [
        section('section:c:notes', [
          item('n1', 'Punto uno'),
          item('n2', 'Punto dos'),
          item('n3', 'Punto tres'),
        ]),
      ],
    });
    const reduced = reduceLiveArtifact(previous, next, NONE);
    expect(reduced.sections).toHaveLength(1);
    expect(reduced.sections[0].items.map((entry) => entry.id)).toEqual(['n1', 'n2', 'n3']);
  });

  it('keeps the note’s own creation time through every rebuild', () => {
    const next = artifact({ createdAt: '2027-01-01T00:00:00.000Z', sections: previous.sections });
    expect(reduceLiveArtifact(previous, next, NONE).createdAt).toBe(previous.createdAt);
  });

  it('adds a section the recording only just produced', () => {
    const next = artifact({
      sections: [
        section('section:c:notes', [item('n1', 'Punto uno')]),
        section('section:c:decisions', [item('d1', 'Al final usamos Postgres')], {
          kind: 'decisions',
        }),
      ],
    });
    expect(reduceLiveArtifact(previous, next, NONE).sections.map((entry) => entry.id)).toEqual([
      'section:c:notes',
      'section:c:decisions',
    ]);
  });

  it('closes a question the recording went on to answer', () => {
    const next = artifact({ sections: previous.sections, openQuestions: [] });
    const reduced = reduceLiveArtifact(previous, next, NONE);
    expect(reduced.openQuestions[0].status).toBe('resolved');
  });

  it('keeps a title the user rewrote', () => {
    const withTitle = artifact({ ...previous, title: item('t', 'Título automático') });
    const next = artifact({ title: item('t2', 'Otro título'), sections: previous.sections });
    const reduced = reduceLiveArtifact(withTitle, next, overrides({ itemId: 't', text: 'El mío' }));
    expect(reduced.title?.id).toBe('t');
  });

  it('lets the generator improve a title nobody touched', () => {
    // The early automatic title is the one the old code could never improve,
    // because nothing recorded that the app had written it.
    const withTitle = artifact({ ...previous, title: item('t', 'Título automático') });
    const next = artifact({ title: item('t2', 'Un título mejor'), sections: previous.sections });
    expect(reduceLiveArtifact(withTitle, next, NONE).title?.text).toBe('Un título mejor');
  });
});
