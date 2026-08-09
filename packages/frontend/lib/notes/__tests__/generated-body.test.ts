import { describe, expect, it } from 'vitest';

import {
  composeNoteBody,
  nextNoteBody,
  userBodyOf,
  type NoteBody,
} from '@/lib/notes/generated-body';

const GENERATED = '## Open questions\n\n- Is it reading the entire internet?';

describe('userBodyOf', () => {
  it('takes the app own previous block back out', () => {
    // The bug this exists for: without removing it, the next pass treats the
    // generated block as the user's writing, keeps it, and appends another —
    // four slices produced four identical "Open questions" sections.
    expect(userBodyOf(`Mis notas\n\n${GENERATED}`, GENERATED)).toBe('Mis notas');
  });

  it('leaves a note nothing has been generated into alone', () => {
    expect(userBodyOf('Solo lo mío', '')).toBe('Solo lo mío');
  });

  it('returns nothing when the user wrote nothing of their own', () => {
    expect(userBodyOf(GENERATED, GENERATED)).toBe('');
  });

  it('keeps what the user left when they edited inside the block', () => {
    // Indistinguishable from typing straight after the block, and treating it
    // as theirs is the safe direction: a stale line kept, never one deleted.
    const edited = '## Open questions\n\n- Is it reading the entire internet? NO';
    expect(userBodyOf(edited, GENERATED)).toBe('NO');
  });

  it('does not leave a widening gap where the block was', () => {
    // The blank lines that surrounded the block would otherwise pile up, and
    // the note grows a bigger hole on every slice.
    const body = `Escribí esto antes\n\n${GENERATED}\n\ny esto después`;
    expect(userBodyOf(body, GENERATED)).toBe('Escribí esto antes\n\ny esto después');
  });
});

describe('composeNoteBody', () => {
  it('puts the user first', () => {
    // They were in the meeting and chose to type that; burying it under
    // generated text is the app talking over them.
    expect(composeNoteBody('Mis notas', GENERATED)).toBe(`Mis notas\n\n${GENERATED}`);
  });

  it('is just the generated block when the user wrote nothing', () => {
    expect(composeNoteBody('', GENERATED)).toBe(GENERATED);
  });

  it('is just the user when nothing was generated', () => {
    expect(composeNoteBody('Mis notas', '')).toBe('Mis notas');
  });

  it('round-trips, which is the property that stops the note growing', () => {
    const composed = composeNoteBody('Mis notas', GENERATED);
    expect(userBodyOf(composed, GENERATED)).toBe('Mis notas');
  });

  it('is stable across slices when nobody types', () => {
    // The exact case that produced four duplicate sections: a meeting where the
    // user writes nothing and the app regenerates on every slice.
    const first = composeNoteBody(userBodyOf('', ''), GENERATED);
    const second = composeNoteBody(userBodyOf(first, GENERATED), GENERATED);
    expect(second).toBe(first);
  });
});

/**
 * The editor and the recorder writing the same note, in the order that used to
 * destroy it.
 *
 * Every fixture here carries BOTH kinds of text. One made only of what the user
 * typed, or only of what the app generated, cannot tell a correct merge from a
 * broken one — both halves survive a merge that drops the half the fixture does
 * not have.
 */
describe('nextNoteBody', () => {
  const TYPED = 'Preguntar por el presupuesto';
  const NEXT_GENERATED = '## Open questions\n\n- Is it reading the entire internet?\n- Who signs off?';

  /** A note mid-recording: the user has typed, and one slice has run. */
  const stored: NoteBody = {
    body: composeNoteBody(TYPED, GENERATED),
    generatedBody: GENERATED,
  };

  it('keeps the app block when the editor saves only what was typed', () => {
    const saved = nextNoteBody(stored, { userBody: `${TYPED} y el plazo` });
    expect(saved.body).toBe(composeNoteBody(`${TYPED} y el plazo`, GENERATED));
    expect(saved.generatedBody).toBe(GENERATED);
  });

  it('keeps what was typed when a slice replaces the app block', () => {
    const sliced = nextNoteBody(stored, { userBody: TYPED, generatedBody: NEXT_GENERATED });
    expect(sliced.body).toBe(composeNoteBody(TYPED, NEXT_GENERATED));
    expect(sliced.generatedBody).toBe(NEXT_GENERATED);
  });

  it('loses neither half when an editor save and a slice interleave', () => {
    // The reported bug, as a sequence: the note is open, the user types, and a
    // slice lands between their keystroke and the next one. Neither writer has
    // seen the other's work.
    const typedMore = `${TYPED} y el plazo`;
    const afterEditor = nextNoteBody(stored, { userBody: typedMore });
    const afterSlice = nextNoteBody(afterEditor, {
      userBody: typedMore,
      generatedBody: NEXT_GENERATED,
    });

    expect(afterSlice.body).toContain(typedMore);
    expect(afterSlice.body).toContain('Who signs off?');
    // The old block is gone rather than kept alongside the new one. Counting is
    // the point: a body that merely *contains* the new section also contains it
    // when the previous copy is still sitting above it.
    expect(afterSlice.body.split('## Open questions').length - 1).toBe(1);
    expect(afterSlice.body.split(typedMore).length - 1).toBe(1);
  });

  it('leaves the body alone for a patch that touches neither half', () => {
    // Pinning a note must not rebuild its body. A body pushed by the server does
    // not necessarily contain the block this device remembers writing, and
    // recomposing from halves that disagree appends a second copy.
    const drifted: NoteBody = { body: 'Lo que mandó el servidor', generatedBody: GENERATED };
    expect(nextNoteBody(drifted, {})).toEqual(drifted);
  });

  it('duplicates the block if a caller hands it the composed body', () => {
    // Not a defect to route around here — it is the reason the halves are the
    // API. This function cannot tell a user who pasted the block from a caller
    // that never took it out, so the caller has to be the one that owns half a
    // body, and `reconcileDraft`/`userBodyOf` are what make the editor one.
    // Pinned as a test so the guarantee is not mistaken for a wider one.
    const careless = nextNoteBody(stored, { userBody: stored.body });
    expect(careless.body.split('## Open questions').length - 1).toBe(2);
  });
});
