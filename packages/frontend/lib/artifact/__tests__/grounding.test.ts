/**
 * That a document nobody can check does not replace fragments they can.
 *
 * Four runs of the real model over the same transcript on a real device gave
 * 4 grounded blocks of 13, then 4 of 8, then **0 of 16**. That last document was
 * sixteen paragraphs of fluent prose about a talk with nothing tying any of it
 * to what was said — and it would have replaced the extractive note, which is
 * worse written and every line of which points at a moment in the recording.
 *
 * It reads better. That is exactly the problem.
 */

import { describe, expect, it } from 'vitest';

import { groundingOf, isCheckable, MIN_GROUNDED_RATIO } from '@/lib/artifact/grounding';
import { artifact, paragraph, prose } from '@/lib/artifact/__tests__/fixtures';

// The fixture grounds a paragraph by default, which is the right default for
// every other suite — here the ungrounded case has to be asked for.
const grounded = (id: string) => paragraph(id, 'Algo que se dijo.');
const ungrounded = (id: string) => paragraph(id, 'Algo que suena bien.', { sources: [] });

describe('a document that cannot be checked', () => {
  it('does not replace the note', () => {
    // The measured case: every block ungrounded.
    const invented = artifact({ sections: [prose('s', [ungrounded('a'), ungrounded('b')])] });
    expect(groundingOf(invented).ratio).toBe(0);
    expect(isCheckable(invented)).toBe(false);
  });

  it('is judged on transcript claims only', () => {
    // A derived item carries its authorisation instead of sources, and counting
    // it as ungrounded would refuse documents for the wrong reason.
    const authorised = artifact({
      sections: [
        prose('s', [
          grounded('a'),
          paragraph('b', 'Harina.', { origin: 'derived-from-instruction', sources: [] }),
        ]),
      ],
    });
    expect(groundingOf(authorised).units).toBe(1);
    expect(isCheckable(authorised)).toBe(true);
  });
});

describe('a document that mostly can be', () => {
  it('replaces the note, because a summary has connective sentences', () => {
    // Demanding a citation for every line would refuse good documents: "the
    // speaker then turned to funding" belongs to no single line.
    const mixed = artifact({
      sections: [prose('s', [grounded('a'), grounded('b'), ungrounded('c')])],
    });
    expect(groundingOf(mixed).ratio).toBeCloseTo(2 / 3);
    expect(isCheckable(mixed)).toBe(true);
  });

  it('draws the line where more is unverifiable than verifiable', () => {
    const half = artifact({ sections: [prose('s', [grounded('a'), ungrounded('b')])] });
    expect(groundingOf(half).ratio).toBe(MIN_GROUNDED_RATIO);
    expect(isCheckable(half)).toBe(true);

    const below = artifact({
      sections: [prose('s', [grounded('a'), ungrounded('b'), ungrounded('c')])],
    });
    expect(isCheckable(below)).toBe(false);
  });

  it('does not call an empty document ungrounded', () => {
    // Nothing to check is not the same as nothing checkable; an empty document
    // is refused elsewhere, for being empty.
    expect(isCheckable(artifact({ sections: [] }))).toBe(true);
  });
});

describe('the gate is wired into the pass that commits', () => {
  it('keeps the structured note instead of publishing prose nobody can verify', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source_ = readFileSync(join(import.meta.dirname, '../../capture/restructure.ts'), 'utf8');
    expect(source_).toContain('if (!isCheckable(fromModel))');
    // And it is a no-change, not a failure: the model ran fine and the note is
    // already on screen.
    expect(source_).toMatch(/isCheckable\(fromModel\)[\s\S]{0,400}kind: 'no-change'/);
  });
});
