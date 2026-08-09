/**
 * That the note writers actually use the replace-my-own-block rule.
 *
 * `restructure.ts` reaches SQLite, so it cannot run in this suite — and the
 * rule it has to follow lives in `generated-body.ts`, which is tested
 * thoroughly and in isolation. That leaves exactly one gap, and it is the gap
 * the bug fell through: the pure module can be perfect while nothing calls it.
 *
 * Proven, not assumed: putting the old code back — handing the structurer the
 * note's current body and writing `toNotePatch` straight out — leaves every
 * other test in this repository green. This is the only check that goes red.
 *
 * It is a source check, which is crude, and it is scoped to one file and two
 * names rather than pretending to be a general rule.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(join(import.meta.dirname, '../restructure.ts'), 'utf8');

/** Both writers: the deterministic pass and the model pass. */
const WRITERS = 2;

describe('note writers', () => {
  it('reads a file that actually contains the writers', () => {
    // Without this, a renamed or moved file makes every assertion below pass by
    // finding nothing at all.
    expect(SOURCE).toContain('export async function restructureNote');
    expect(SOURCE).toContain('export async function enhanceNote');
  });

  it('composes the body instead of writing the generated block straight out', () => {
    // The duplication bug: the generated block was written as the whole body,
    // then read back next slice as if the user had typed it, and appended to.
    expect(SOURCE.split('composeNoteBody(').length - 1).toBeGreaterThanOrEqual(WRITERS);
  });

  it('remembers what it wrote, in both writers', () => {
    // Without this the next pass has nothing to remove, and composing alone
    // does not help.
    expect(SOURCE.split('writeGeneratedBody(').length - 1).toBeGreaterThanOrEqual(WRITERS);
    expect(SOURCE.split('readGeneratedBody(').length - 1).toBeGreaterThanOrEqual(WRITERS);
  });

  it('never shows a writer the note body it wrote itself', () => {
    // The structurer and the model are handed an empty body on purpose, so what
    // comes back is their contribution alone. `existing: authored` — the old
    // code — passes the whole current body straight back in.
    expect(SOURCE).not.toMatch(/existing:\s*authored\s*,/);
  });
});
