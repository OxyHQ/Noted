import { describe, expect, it } from 'vitest';

import type { LocalNote } from '@/lib/db/notes-repo';
import { reconcileDraft } from '@/lib/notes/draft-sync';
import { composeNoteBody } from '@/lib/notes/generated-body';

const TYPED = 'Preguntar por el presupuesto';
const FIRST_SLICE = '## Open questions\n\n- Is it reading the entire internet?';
const SECOND_SLICE = `${FIRST_SLICE}\n- Who signs off?`;

function note(over: Partial<LocalNote> = {}): LocalNote {
  return {
    id: 'note-1',
    kind: 'voice',
    title: 'Reunión',
    body: composeNoteBody(TYPED, FIRST_SLICE),
    generatedBody: FIRST_SLICE,
    checklist: [],
    color: 'default',
    labels: [],
    pinned: false,
    archived: false,
    trashed: false,
    attachments: [],
    reminderAt: null,
    order: 0,
    createdAt: '2026-08-10T10:00:00.000Z',
    updatedAt: '2026-08-10T10:00:00.000Z',
    ...over,
  };
}

/**
 * Every fixture below carries BOTH what the user typed and what the app
 * generated. One made of only one of them cannot tell a correct merge from a
 * merge that drops the half the fixture does not have — both look green.
 */
describe('reconcileDraft', () => {
  it('takes the whole note when the user has changed nothing', () => {
    const base = note();
    const stored = note({
      body: composeNoteBody(TYPED, SECOND_SLICE),
      generatedBody: SECOND_SLICE,
      title: 'Reunión de producto',
      updatedAt: '2026-08-10T10:00:12.000Z',
    });

    expect(reconcileDraft(base, base, stored)).toEqual(stored);
  });

  it('keeps what was typed and shows what the slice added', () => {
    // The case the whole thing exists for: the note is open, the user is
    // typing, and a slice lands underneath them.
    const base = note();
    const draft = note({ body: composeNoteBody(`${TYPED} y el plazo`, FIRST_SLICE) });
    const stored = note({
      body: composeNoteBody(TYPED, SECOND_SLICE),
      generatedBody: SECOND_SLICE,
      updatedAt: '2026-08-10T10:00:12.000Z',
    });

    const next = reconcileDraft(base, draft, stored);

    expect(next.body).toBe(composeNoteBody(`${TYPED} y el plazo`, SECOND_SLICE));
    expect(next.generatedBody).toBe(SECOND_SLICE);
    // Counted, not merely present: a body that kept the old block above the new
    // one contains both of these too.
    expect(next.body.split('## Open questions').length - 1).toBe(1);
    expect(next.body.split('y el plazo').length - 1).toBe(1);
  });

  it('extracts with the block the draft holds, not the one the store holds', () => {
    // The two differ exactly when a slice has landed since the editor last
    // looked. Using the store's would fail to match, and the whole draft —
    // generated text included — would be filed as the user's writing and kept
    // forever, which is the duplication bug wearing the user's name.
    const base = note();
    const draft = note({ body: composeNoteBody(TYPED, FIRST_SLICE) });
    const stored = note({
      body: composeNoteBody(TYPED, SECOND_SLICE),
      generatedBody: SECOND_SLICE,
      updatedAt: '2026-08-10T10:00:12.000Z',
    });

    expect(reconcileDraft(base, draft, stored).body).toBe(stored.body);
  });

  it('keeps a title the user typed and takes one they did not', () => {
    const base = note();
    const stored = note({ title: 'Reunión de producto', updatedAt: '2026-08-10T10:00:12.000Z' });

    expect(reconcileDraft(base, note({ title: 'Mi reunión' }), stored).title).toBe('Mi reunión');
    expect(reconcileDraft(base, base, stored).title).toBe('Reunión de producto');
  });

  it('keeps a checklist the user reordered and takes one they did not touch', () => {
    const mine = [{ id: 'a', text: 'Mandar el desglose', checked: true }];
    const theirs = [{ id: 'b', text: 'Mandar el desglose', checked: false }];
    const base = note();
    const stored = note({ checklist: theirs, updatedAt: '2026-08-10T10:00:12.000Z' });

    // An array is compared by value: the editor replaces it wholesale on every
    // change, so identity would report a change on every render.
    expect(reconcileDraft(base, note({ checklist: [] }), stored).checklist).toEqual(theirs);
    expect(reconcileDraft(base, note({ checklist: mine }), stored).checklist).toEqual(mine);
  });

  it('keeps a colour the user picked while a slice was landing', () => {
    const base = note();
    const stored = note({
      body: composeNoteBody(TYPED, SECOND_SLICE),
      generatedBody: SECOND_SLICE,
      updatedAt: '2026-08-10T10:00:12.000Z',
    });

    const next = reconcileDraft(base, note({ color: 'teal' }), stored);
    expect(next.color).toBe('teal');
    expect(next.generatedBody).toBe(SECOND_SLICE);
  });

  it('does not put the block back after the user converted it away', () => {
    // Converting a body to a checklist moves every generated line into items the
    // user owns, and clears the draft's record of the block. A slice landing in
    // the moment before that write reaches the store must not compose the block
    // back into a body the user has just emptied.
    const base = note();
    const converted = note({
      body: '',
      generatedBody: '',
      checklist: [{ id: 'a', text: 'Is it reading the entire internet?', checked: false }],
    });
    const stored = note({
      body: composeNoteBody(TYPED, SECOND_SLICE),
      generatedBody: SECOND_SLICE,
      updatedAt: '2026-08-10T10:00:12.000Z',
    });

    const next = reconcileDraft(base, converted, stored);

    expect(next.body).toBe('');
    expect(next.generatedBody).toBe('');
    expect(next.checklist).toEqual(converted.checklist);
  });

  it('leaves the draft consistent for the next reconcile', () => {
    // The invariant the editor's save depends on: the block recorded in
    // `generatedBody` is the block actually sitting inside `body`. Two slices in
    // a row with typing in between is the shortest sequence that can break it.
    const base = note();
    const afterFirst = reconcileDraft(
      base,
      note({ body: composeNoteBody(`${TYPED} y el plazo`, FIRST_SLICE) }),
      note({
        body: composeNoteBody(TYPED, SECOND_SLICE),
        generatedBody: SECOND_SLICE,
        updatedAt: '2026-08-10T10:00:12.000Z',
      }),
    );

    const third = '## Open questions\n\n- Who signs off?\n- When do we ship?';
    const afterSecond = reconcileDraft(
      afterFirst,
      { ...afterFirst, body: composeNoteBody(`${TYPED} y el plazo, y quién firma`, SECOND_SLICE) },
      note({
        body: composeNoteBody(TYPED, third),
        generatedBody: third,
        updatedAt: '2026-08-10T10:00:24.000Z',
      }),
    );

    expect(afterSecond.body).toBe(
      composeNoteBody(`${TYPED} y el plazo, y quién firma`, third),
    );
    expect(afterSecond.body.split('## Open questions').length - 1).toBe(1);
  });
});
