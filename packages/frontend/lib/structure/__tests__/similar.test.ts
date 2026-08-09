import { describe, expect, it } from 'vitest';

import { dropNearDuplicates, isNearDuplicate } from '@/lib/structure/similar';

describe('isNearDuplicate', () => {
  it('sees a sentence a slice cut in half and the whole one as the same line', () => {
    // The reported repetition: the first slice ended mid-sentence, the next one
    // transcribed the whole thing, and the note carried both.
    expect(
      isNearDuplicate(
        "There's a moment where it appears to be thinking, what's actually happening?",
        "When you send a message to an AI, there's a moment where it appears to be thinking, what's actually happening?",
      ),
    ).toBe(true);
  });

  it('sees the same remark transcribed two slightly different ways', () => {
    expect(
      isNearDuplicate('Is it just a fancy or search engine?', 'Is it just a fancier search engine?'),
    ).toBe(true);
  });

  it('keeps two different remarks apart', () => {
    // Without this the de-duplication is not a filter, it is a shredder — and a
    // suite made only of near-duplicates cannot tell the two apart.
    expect(
      isNearDuplicate('Is it reading the entire internet?', 'Is it copying answers from a database?'),
    ).toBe(false);
    expect(
      isNearDuplicate('Hay que enviar el contrato el viernes.', 'Hay que avisar al cliente.'),
    ).toBe(false);
  });

  it('does not call a short phrase a duplicate of a sentence containing it', () => {
    expect(isNearDuplicate('Yes', 'Yes, we can ship it on Friday.')).toBe(false);
  });

  it('treats one misheard word in a repeated sentence as the same line', () => {
    // The point of comparing by overlap rather than by text: a recogniser that
    // mishears one word in a sentence it wrote correctly a moment ago has still
    // written the same line twice.
    expect(isNearDuplicate('we sent a men to it', 'we sent a mention to it today')).toBe(true);
  });

  it('stops short of merging two remarks that share only their scaffolding', () => {
    // The other side of that threshold. Both are short sentences about the same
    // subject and share several words; they are not the same remark.
    expect(
      isNearDuplicate('The model was trained on text.', 'The model was released last year.'),
    ).toBe(false);
  });
});

describe('dropNearDuplicates', () => {
  it('keeps the fuller wording, not whichever arrived first', () => {
    const kept = dropNearDuplicates(
      [
        { text: 'it appears to be thinking, what is actually happening?' },
        { text: 'When you send a message, it appears to be thinking, what is actually happening?' },
      ],
      (item) => item.text,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].text).toBe(
      'When you send a message, it appears to be thinking, what is actually happening?',
    );
  });

  it('leaves distinct lines alone', () => {
    const lines = [{ text: 'Al final usamos Postgres.' }, { text: 'Hay que avisar al cliente.' }];
    expect(dropNearDuplicates(lines, (item) => item.text)).toHaveLength(2);
  });
});
