import { describe, expect, it } from 'vitest';

import {
  adoptItem,
  checkItem,
  editItem,
  isUserOwned,
  removeItem,
  restoreItem,
} from '@/lib/artifact/actions';
import { emptyOverride, type UserItemOverride } from '@/lib/artifact/ownership';

function override(over: Partial<UserItemOverride> = {}): UserItemOverride {
  return { ...emptyOverride('a'), ...over };
}

describe('what each gesture records', () => {
  it('records an untick as a decision, not as the absence of one', () => {
    // A regeneration may set a tick nobody has touched, and may not undo one the
    // user cleared. `false` and "never said" have to be different values.
    expect(checkItem('a', false)).toEqual({ itemId: 'a', checked: false });
    expect(checkItem('a', true)).toEqual({ itemId: 'a', checked: true });
  });

  it('records a rewording against the id, never against the text', () => {
    expect(editItem('a', '  mi versión  ')).toEqual({ itemId: 'a', text: 'mi versión' });
  });

  it('treats an emptied item as thrown away', () => {
    // An empty bullet is not something anybody meant to write, and leaving one is
    // how a note accumulates blank lines nobody can explain.
    expect(editItem('a', '   ')).toEqual({ itemId: 'a', removed: true });
  });

  it('records a removal rather than performing one', () => {
    // The artifact is rebuilt from the transcript on every pass, so an item
    // deleted from the artifact comes straight back. The override is what keeps
    // it gone.
    expect(removeItem('a')).toEqual({ itemId: 'a', removed: true });
    expect(restoreItem('a')).toEqual({ itemId: 'a', removed: false });
  });

  it('records adoption, which is the strongest of the four', () => {
    expect(adoptItem('a')).toEqual({ itemId: 'a', adopted: true });
  });
});

describe('isUserOwned', () => {
  it('is false for an item nobody has touched', () => {
    // Only a real decision protects an item; an empty row would freeze the whole
    // note against every later pass.
    expect(isUserOwned(undefined)).toBe(false);
    expect(isUserOwned(override())).toBe(false);
  });

  it('is true after any of the four gestures', () => {
    expect(isUserOwned(override({ checked: true }))).toBe(true);
    expect(isUserOwned(override({ checked: false }))).toBe(true);
    expect(isUserOwned(override({ text: 'mío' }))).toBe(true);
    expect(isUserOwned(override({ removed: true }))).toBe(true);
    expect(isUserOwned(override({ adopted: true }))).toBe(true);
  });
});
