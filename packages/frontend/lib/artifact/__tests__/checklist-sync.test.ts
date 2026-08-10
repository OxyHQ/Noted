import { describe, expect, it } from 'vitest';

import type { ChecklistItem } from '@noted/shared-types';

import { overridesForChecklistChange } from '@/lib/artifact/checklist-sync';
import { itemId } from '@/lib/artifact/item-id';

const GENERATED = itemId('action', 'Llamar al banco');
const MINE = 'V1StGXR8_Z5jdHi6B-myT';

function item(id: string, text: string, checked = false): ChecklistItem {
  return { id, text, checked };
}

describe('a tick on a generated item', () => {
  it('is recorded, so it survives the next finalisation', () => {
    // Without this the next pass rebuilds the artifact, finds no record that
    // anybody touched anything, and the tick disappears minutes later — which is
    // the worst possible time to notice.
    const before = [item(GENERATED, 'Llamar al banco')];
    const after = [item(GENERATED, 'Llamar al banco', true)];
    expect(overridesForChecklistChange(before, after)).toEqual([
      { itemId: GENERATED, checked: true },
    ]);
  });

  it('records an untick too, because that is also a decision', () => {
    const before = [item(GENERATED, 'Llamar al banco', true)];
    const after = [item(GENERATED, 'Llamar al banco')];
    expect(overridesForChecklistChange(before, after)).toEqual([
      { itemId: GENERATED, checked: false },
    ]);
  });
});

describe('rewording and removing', () => {
  it('records the new wording', () => {
    const before = [item(GENERATED, 'Llamar al banco')];
    const after = [item(GENERATED, 'Llamar al banco el lunes')];
    expect(overridesForChecklistChange(before, after)).toEqual([
      { itemId: GENERATED, text: 'Llamar al banco el lunes' },
    ]);
  });

  it('records a removal, which is what keeps it gone', () => {
    expect(overridesForChecklistChange([item(GENERATED, 'Llamar al banco')], [])).toEqual([
      { itemId: GENERATED, removed: true },
    ]);
  });

  it('records both when one edit did both', () => {
    // Renaming an item and ticking it in the same breath is one edit, not two.
    const before = [item(GENERATED, 'Llamar al banco')];
    const after = [item(GENERATED, 'Llamar al banco el lunes', true)];
    expect(overridesForChecklistChange(before, after)).toEqual([
      { itemId: GENERATED, checked: true },
      { itemId: GENERATED, text: 'Llamar al banco el lunes' },
    ]);
  });
});

describe('the user’s own items', () => {
  it('produce nothing at all', () => {
    // Their ids are theirs and the note's own column already holds them. An
    // override here would record that the user had touched something the app
    // never wrote.
    const before = [item(MINE, 'Comprar pan')];
    const after = [item(MINE, 'Comprar pan integral', true)];
    expect(overridesForChecklistChange(before, after)).toEqual([]);
  });

  it('do not produce a removal either', () => {
    expect(overridesForChecklistChange([item(MINE, 'Comprar pan')], [])).toEqual([]);
  });
});

describe('no change', () => {
  it('records nothing', () => {
    const list = [item(GENERATED, 'Llamar al banco'), item(MINE, 'Comprar pan')];
    expect(overridesForChecklistChange(list, [...list])).toEqual([]);
  });

  it('records nothing for an item that only just appeared', () => {
    // A generated item the composer added this render was not edited by anybody.
    expect(overridesForChecklistChange([], [item(GENERATED, 'Llamar al banco')])).toEqual([]);
  });
});
