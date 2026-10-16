import { describe, expect, it } from 'vitest';

import type { NoteBlock } from '@/lib/notes/blocks';
import { isEmptyNote, type EmptinessInput } from '@/lib/notes/emptiness';

function note(over: Partial<EmptinessInput> = {}): EmptinessInput {
  return { title: '', blocks: [], ...over };
}
const line = (text: string, type: NoteBlock['type'] = 'paragraph'): NoteBlock => ({
  id: text || 'blank',
  parentBlockId: null,
  type,
  content: type === 'todo' ? { text, checked: false } : { text },
  order: 0,
});

describe('a note with nothing in it', () => {
  it('is empty', () => {
    expect(isEmptyNote(note())).toBe(true);
  });

  it('is still empty when it is only whitespace', () => {
    expect(isEmptyNote(note({ title: '   ', blocks: [line('\n\n  ')] }))).toBe(true);
  });

  it('is still empty when its only line or task was never typed into', () => {
    // The empty line the editor offers is not something anybody wrote.
    expect(isEmptyNote(note({ blocks: [line('')] }))).toBe(true);
    expect(isEmptyNote(note({ blocks: [line('  ', 'todo')] }))).toBe(true);
  });
});

describe('a note with something in it', () => {
  it('is kept for a title', () => {
    expect(isEmptyNote(note({ title: 'Presupuesto' }))).toBe(false);
  });

  it('is kept for text', () => {
    expect(isEmptyNote(note({ blocks: [line('algo')] }))).toBe(false);
  });

  it('is kept for a task somebody typed', () => {
    expect(isEmptyNote(note({ blocks: [line('pan', 'todo')] }))).toBe(false);
  });

  it('is kept for a block that is content without text (a divider)', () => {
    expect(isEmptyNote(note({ blocks: [line('', 'divider')] }))).toBe(false);
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
    expect(
      isEmptyNote(
        note({
          blocks: [line('Al final usamos Postgres')],
          generated: { 'Al final usamos Postgres': { key: 'n1' } },
        }),
      ),
    ).toBe(false);
  });

  it('is never empty while the recorder holds blocks in it, even blank ones', () => {
    expect(isEmptyNote(note({ blocks: [line('')], generated: { blank: { key: 'n1' } } }))).toBe(
      false,
    );
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
