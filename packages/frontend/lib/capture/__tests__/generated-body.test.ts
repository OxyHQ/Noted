import { describe, expect, it } from 'vitest';

import { composeNoteBody, userBodyOf } from '@/lib/capture/generated-body';

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
