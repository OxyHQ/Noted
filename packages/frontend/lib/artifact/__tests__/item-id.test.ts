import { describe, expect, it } from 'vitest';

import { isGeneratedItemId, itemId } from '@/lib/artifact/item-id';

describe('itemId', () => {
  it('names the same point the same way every time', () => {
    // The property the live note turns on. Without it every rebuild is a new
    // note: bullets reorder, and the item somebody ticked forty seconds ago is a
    // different item by the time they look back at it.
    expect(itemId('note', 'PostgreSQL será la única base')).toBe(
      itemId('note', 'PostgreSQL será la única base'),
    );
  });

  it('does not care how the recogniser punctuated it', () => {
    expect(itemId('action', 'Hay que enviar el contrato.')).toBe(
      itemId('action', 'hay que enviar el contrato'),
    );
  });

  it('keeps the same sentence apart when it is two different things', () => {
    // A decision quoted inside a note is a separate item with separate
    // ownership, and the user may edit one without touching the other.
    expect(itemId('note', 'Usamos Postgres')).not.toBe(itemId('decision', 'Usamos Postgres'));
  });

  it('gives different points different names', () => {
    expect(itemId('note', 'Usamos Postgres')).not.toBe(itemId('note', 'Usamos MySQL'));
  });

  it('is stable across runs, not just within one', () => {
    // Pinned to a literal on purpose: a hash seeded from anything the runtime
    // supplies would give the same answer all through one session and a
    // different one after a restart, which is the worst possible failure — it
    // looks correct in every test.
    expect(itemId('note', 'Usamos Postgres')).toBe('note:ilq5fs');
  });
});

describe('isGeneratedItemId', () => {
  it('tells a generated item from one the user owns', () => {
    // `newNoteId` is nanoid's alphabet — letters, digits, `_` and `-` — so a
    // colon cannot appear in an id a user's own checklist item carries. That is
    // what makes this a discriminator rather than a guess, and it is the
    // replacement for the exact-substring trick.
    expect(isGeneratedItemId(itemId('action', 'Llamar al banco'))).toBe(true);
    expect(isGeneratedItemId('V1StGXR8_Z5jdHi6B-myT')).toBe(false);
  });
});
