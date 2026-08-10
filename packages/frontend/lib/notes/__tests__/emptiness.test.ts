import { describe, expect, it } from 'vitest';

import { isEmptyNote, type EmptinessInput } from '@/lib/notes/emptiness';

function note(over: Partial<EmptinessInput> = {}): EmptinessInput {
  return { title: '', userBody: '', checklist: [], ...over };
}

describe('a note with nothing in it', () => {
  it('is empty', () => {
    expect(isEmptyNote(note())).toBe(true);
  });

  it('is still empty when it is only whitespace', () => {
    expect(isEmptyNote(note({ title: '   ', userBody: '\n\n  ' }))).toBe(true);
  });

  it('is still empty when its only checklist row was never typed into', () => {
    // The blank row the editor offers is not something anybody wrote.
    expect(isEmptyNote(note({ checklist: [{ id: 'a', text: '  ', checked: false }] }))).toBe(true);
  });
});

describe('a note with something in it', () => {
  it('is kept for a title', () => {
    expect(isEmptyNote(note({ title: 'Presupuesto' }))).toBe(false);
  });

  it('is kept for a body', () => {
    expect(isEmptyNote(note({ userBody: 'algo' }))).toBe(false);
  });

  it('is kept for a checklist item somebody typed', () => {
    expect(isEmptyNote(note({ checklist: [{ id: 'a', text: 'pan', checked: false }] }))).toBe(false);
  });

  it('is kept for an attachment', () => {
    expect(isEmptyNote(note({ attachments: ['file_1'] }))).toBe(false);
  });
});

describe('a recording is content, even with nothing typed', () => {
  // The whole shape of this product: somebody puts the phone on the table, types
  // nothing, and the note fills itself. Reading that as empty deletes a meeting.
  it('is never empty when it was born from a recording', () => {
    expect(isEmptyNote(note({ kind: 'voice' }))).toBe(false);
  });

  it('is never empty when a generator wrote into it', () => {
    expect(isEmptyNote(note({ generatedBody: '- Al final usamos Postgres' }))).toBe(false);
  });

  it('is empty again when the generated half is only whitespace', () => {
    // A `generated_body` of blanks is not a note; it is a column that was
    // written to and never filled.
    expect(isEmptyNote(note({ generatedBody: '   \n' }))).toBe(true);
  });
});

describe('a reminder is content', () => {
  it('keeps an otherwise blank note', () => {
    // It is a thing the user arranged that will go off. Keeping a blank note is
    // a small annoyance; deleting it is a missed appointment.
    expect(isEmptyNote(note({ reminderAt: '2026-08-11T09:00:00.000Z' }))).toBe(false);
  });

  it('does not keep one that was cleared', () => {
    expect(isEmptyNote(note({ reminderAt: null }))).toBe(true);
  });
});

describe('filing is not content', () => {
  it('does not keep a note for a colour, a label or a pin', () => {
    // A yellow blank card is no more identifiable than a white one. None of
    // these are fields this function reads, and that is the point — pinned and
    // coloured emptiness is still emptiness.
    expect(isEmptyNote(note())).toBe(true);
  });
});
