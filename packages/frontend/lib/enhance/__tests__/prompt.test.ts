import { describe, expect, it } from 'vitest';

import type { PendingExpansion } from '@noted/shared-types';
import type { EnhanceLine } from '@/lib/enhance/contract';
import {
  buildPrompt,
  CORE_INSTRUCTIONS,
  expansionInstructions,
  PROFILE_INSTRUCTIONS,
  splitForContext,
  type PromptOptions,
} from '@/lib/enhance/prompt';
import { CAPTURE_PROFILES } from '@noted/shared-types';

function lines(count: number, text: string): EnhanceLine[] {
  return Array.from({ length: count }, (_, index) => ({
    atMs: index * 1000,
    text,
    segmentIds: [`c1#0.${String(index)}`],
  }));
}

function options(over: Partial<PromptOptions> = {}): PromptOptions {
  return { language: 'es', profile: 'auto', intent: 'freeform', expansions: [], ...over };
}

describe('splitForContext', () => {
  it('keeps a short transcript in one window', () => {
    expect(splitForContext(lines(3, 'corto'))).toHaveLength(1);
  });

  it('splits a long transcript rather than dropping any of it', () => {
    // Truncating loses whatever was said in the part thrown away, and the end of
    // a recording is usually where the decisions are.
    const transcript = lines(10, 'x'.repeat(1_000));
    const windows = splitForContext(transcript);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows.flat()).toHaveLength(transcript.length);
  });

  it('keeps every window within the budget', () => {
    for (const window of splitForContext(lines(20, 'x'.repeat(500)), 2_000)) {
      const size = window.reduce((total, line) => total + line.text.length + 1, 0);
      // One oversized line is allowed a window of its own; anything else fits.
      expect(window.length === 1 || size <= 2_000).toBe(true);
    }
  });

  it('never splits a single line, even one larger than the budget', () => {
    const windows = splitForContext(lines(1, 'x'.repeat(9_000)), 1_000);
    expect(windows).toEqual([lines(1, 'x'.repeat(9_000))]);
  });

  it('returns nothing for an empty transcript', () => {
    expect(splitForContext([])).toEqual([]);
  });
});

describe('the core instruction', () => {
  const prompt = buildPrompt(lines(2, 'Hablamos del presupuesto'), options());

  it('numbers the transcript so a note can cite it', () => {
    // A model handles `[3, 4]` far better than a list of segment ids, and the
    // caller can check those numbers against the lines it actually sent.
    expect(prompt).toContain('1. [00:00] Hablamos del presupuesto');
    expect(prompt).toContain('2. [00:01] Hablamos del presupuesto');
  });

  it('forbids inventing what was not said', () => {
    expect(CORE_INSTRUCTIONS).toContain('Do not add knowledge of your own.');
    expect(prompt).toContain('Do not add knowledge of your own.');
  });

  it('says an empty list is a real answer', () => {
    // A model that feels obliged to fill four sections will invent three of
    // them, and an invented action item is worse than a missing one.
    expect(prompt).toContain('An empty list is a real answer');
  });

  it('asks for exactly the fields the parser reads', () => {
    for (const field of ['title', 'notes', 'actions', 'openQuestions', 'listAdditions']) {
      expect(prompt).toContain(field);
    }
  });

  it('passes the user’s own notes so they are not repeated', () => {
    expect(buildPrompt(lines(1, 'x'), options({ existingBody: 'ojo con el margen' }))).toContain(
      'ojo con el margen',
    );
  });

  it('omits that section entirely when the user wrote nothing', () => {
    expect(prompt).not.toContain('The user has already written');
  });

  it('tells a partial window not to conclude about the whole recording', () => {
    expect(buildPrompt(lines(1, 'x'), options({ isPartial: true }))).toContain(
      'part of a longer recording',
    );
    expect(prompt).toContain('This is the whole recording.');
  });
});

describe('one core, plus a fragment per profile', () => {
  it('has a fragment for every profile', () => {
    // A missing entry would silently fall back to nothing, which reads exactly
    // like a profile that was deliberately given no instruction.
    for (const profile of CAPTURE_PROFILES) {
      expect(PROFILE_INSTRUCTIONS[profile], profile).toBeDefined();
    }
  });

  it('still tells a recording nobody classified to be a document', () => {
    // It used to add nothing, and "no profile" was being read as "no instruction
    // about form" — which is how `auto` produced the worst notes of any profile.
    expect(PROFILE_INSTRUCTIONS.auto).toContain('headings and paragraphs');
    expect(PROFILE_INSTRUCTIONS.auto).toContain('never one long list');
  });

  it('never restates the core, which is what makes copies drift', () => {
    for (const profile of CAPTURE_PROFILES) {
      const fragment = PROFILE_INSTRUCTIONS[profile];
      expect(fragment.length, profile).toBeLessThan(CORE_INSTRUCTIONS.length);
      expect(fragment, profile).not.toContain('Act as an excellent human note-taker');
    }
  });

  it('tells a class it usually has no actions', () => {
    const prompt = buildPrompt(lines(1, 'x'), options({ profile: 'lecture' }));
    expect(prompt).toContain('This is a class.');
    expect(prompt).toContain('leave those empty');
  });

  it('tells a dictation to fill the list and leave the rest alone', () => {
    expect(buildPrompt(lines(1, 'x'), options({ profile: 'dictation' }))).toContain(
      'listAdditions',
    );
  });
});

describe('authorised expansion', () => {
  const expansion: PendingExpansion = {
    subject: 'una pizza de pollo',
    instructionSource: { captureId: 'c1', startMs: 0, endMs: 1, segmentIds: ['c1#0.0'] },
  };

  it('says nothing at all when nothing was authorised', () => {
    // Which is almost always. Ordinary discussion may only be reported.
    expect(expansionInstructions([])).toBe('');
    expect(buildPrompt(lines(1, 'x'), options())).not.toContain('you may add standard items');
  });

  it('names exactly what was authorised, and nothing else', () => {
    const prompt = buildPrompt(lines(1, 'x'), options({ expansions: [expansion] }));
    expect(prompt).toContain('- una pizza de pollo');
    expect(prompt).toContain('ONLY these');
    expect(prompt).toContain('add nothing for any other subject');
  });
});
