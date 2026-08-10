import { describe, expect, it } from 'vitest';

import { allItems } from '@/lib/artifact/artifact';
import type { UserItemOverride } from '@noted/shared-types';
import { applyOverrides, carryProtectedItems, emptyOverride, isProtected, isTouched, overridesById } from '@/lib/artifact/ownership';
import {
  artifact,
  checklist,
  checklistItem,
  item,
  section,
  unitsOf,
} from '@/lib/artifact/__tests__/fixtures';

function overrides(...entries: Partial<UserItemOverride>[]): ReturnType<typeof overridesById> {
  return overridesById(
    entries.map((entry) => ({ ...emptyOverride(entry.itemId ?? ''), ...entry })),
  );
}

describe('isTouched', () => {
  it('is false for a row that records nothing', () => {
    // Only a real decision protects an item; an empty row would freeze the whole
    // note against every later pass.
    expect(isTouched(emptyOverride('a'))).toBe(false);
  });

  it('is true for an untick, which is a decision like any other', () => {
    // `checked: false` is not the absence of an answer. Regeneration may set a
    // tick nobody has touched, and may not undo one the user cleared.
    expect(isTouched({ ...emptyOverride('a'), checked: false })).toBe(true);
  });
});

describe('applyOverrides', () => {
  const base = artifact({
    sections: [section('s', [item('n1', 'Migrar a PostgreSQL'), item('n2', 'Borrar Mongo')])],
    checklists: [checklist('c', [checklistItem('a1', 'pollo'), checklistItem('a2', 'pasta')])],
  });

  it('shows the user their own wording', () => {
    const shown = applyOverrides(base, overrides({ itemId: 'n1', text: 'Migrar a Postgres 17' }));
    expect(unitsOf(shown.sections[0])[0].text).toBe('Migrar a Postgres 17');
    expect(unitsOf(shown.sections[0])[1].text).toBe('Borrar Mongo');
  });

  it('keeps the tick the user set', () => {
    const shown = applyOverrides(base, overrides({ itemId: 'a1', checked: true }));
    expect(shown.checklists[0].items[0].checked).toBe(true);
    expect(shown.checklists[0].items[1].checked).toBe(false);
  });

  it('leaves a tick nobody set to the generator', () => {
    const generated = artifact({
      checklists: [checklist('c', [checklistItem('a1', 'pollo', { checked: true })])],
    });
    expect(applyOverrides(generated, overrides({ itemId: 'a1', text: 'pollo de corral' }))
      .checklists[0].items[0].checked).toBe(true);
  });

  it('takes out what the user deleted', () => {
    const shown = applyOverrides(base, overrides({ itemId: 'n2', removed: true }));
    expect(unitsOf(shown.sections[0]).map((entry) => entry.id)).toEqual(['n1']);
  });

  it('does not touch the stored artifact', () => {
    // Applied at read time on purpose: a regeneration has to compare against
    // what the model actually said last time, not against a version the user
    // rewrote, or every edit slowly becomes the model's own opinion.
    applyOverrides(base, overrides({ itemId: 'n1', text: 'otra cosa', removed: true }));
    expect(unitsOf(base.sections[0])[0].text).toBe('Migrar a PostgreSQL');
    expect(unitsOf(base.sections[0])).toHaveLength(2);
  });

  it('is the identity when the user has done nothing', () => {
    expect(applyOverrides(base, overridesById([]))).toBe(base);
  });
});

describe('isProtected', () => {
  it('protects what the user touched and nothing else', () => {
    const map = overrides({ itemId: 'a', checked: true }, { itemId: 'b' });
    expect(isProtected('a', map)).toBe(true);
    expect(isProtected('b', map)).toBe(false);
    expect(isProtected('c', map)).toBe(false);
  });
});

describe('carryProtectedItems', () => {
  const previous = artifact({
    sections: [section('s', [item('n1', 'punto tocado'), item('n2', 'punto intacto')])],
    checklists: [checklist('c', [checklistItem('a1', 'pollo'), checklistItem('a2', 'pasta')])],
    openQuestions: [item('q1', '¿Y el presupuesto?')],
  });

  // A finalisation that rebuilt the note from the whole recording and found none
  // of the old ids: the ordinary case, since it merges and rewords freely.
  const regenerated = artifact({
    stage: 'final',
    sections: [section('s', [item('n9', 'punto reconciliado')])],
    checklists: [checklist('c', [checklistItem('a9', 'pasta integral')])],
  });

  it('puts back the item the user ticked', () => {
    const merged = carryProtectedItems(
      previous,
      regenerated,
      overrides({ itemId: 'a1', checked: true }),
    );
    expect(merged.checklists[0].items.map((entry) => entry.id)).toEqual(['a9', 'a1']);
  });

  it('lets the finaliser drop what nobody touched', () => {
    const merged = carryProtectedItems(previous, regenerated, overridesById([]));
    expect(allItems(merged).map((entry) => entry.id)).toEqual(['n9', 'a9']);
  });

  it('does not resurrect what the user threw away', () => {
    // The override survives and `applyOverrides` would drop it again, but
    // carrying it back would make it flicker into the note for one render.
    const merged = carryProtectedItems(
      previous,
      regenerated,
      overrides({ itemId: 'n1', removed: true }),
    );
    expect(allItems(merged).map((entry) => entry.id)).toEqual(['n9', 'a9']);
  });

  it('carries a protected open question back too', () => {
    const merged = carryProtectedItems(
      previous,
      regenerated,
      overrides({ itemId: 'q1', text: '¿Y el presupuesto de 2027?' }),
    );
    expect(merged.openQuestions.map((entry) => entry.id)).toEqual(['q1']);
  });

  it('does not duplicate an item the new pass kept', () => {
    const keeping = artifact({
      stage: 'final',
      sections: [section('s', [item('n1', 'punto tocado, reescrito')])],
    });
    const merged = carryProtectedItems(
      previous,
      keeping,
      overrides({ itemId: 'n1', text: 'mi versión' }),
    );
    expect(unitsOf(merged.sections[0]).map((entry) => entry.id)).toEqual(['n1']);
  });

  it('keeps a protected item whose section the new pass did not produce', () => {
    const elsewhere = artifact({
      stage: 'final',
      sections: [section('otra', [item('n9', 'otra sección')])],
    });
    const merged = carryProtectedItems(
      previous,
      elsewhere,
      overrides({ itemId: 'n2', adopted: true }),
    );
    expect(merged.sections.map((entry) => entry.id)).toEqual(['otra', 's']);
    expect(unitsOf(merged.sections[1]).map((entry) => entry.id)).toEqual(['n2']);
  });

  it('is the identity when there was no previous artifact', () => {
    expect(carryProtectedItems(null, regenerated, overridesById([]))).toBe(regenerated);
  });
});
