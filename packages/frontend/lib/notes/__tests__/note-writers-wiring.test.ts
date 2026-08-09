/**
 * That every writer of a note body actually goes through the ownership rules.
 *
 * The three writers reach SQLite, expo-router or React, so none of them can run
 * in this suite — and the rules they have to follow live in `generated-body.ts`
 * and `draft-sync.ts`, which are tested thoroughly and in isolation. That leaves
 * exactly one gap, and it is the gap both bugs fell through: the pure module can
 * be perfect while nothing calls it.
 *
 * Proven, not assumed. Each assertion below was mutation-tested by putting the
 * old code back and confirming that this file is the only one that goes red.
 *
 * These are source checks, which is crude, and they are scoped to named files
 * and named symbols rather than pretending to be a general rule.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HERE = import.meta.dirname;

const RESTRUCTURE = readFileSync(join(HERE, '../../capture/restructure.ts'), 'utf8');
const REPO = readFileSync(join(HERE, '../../db/notes-repo.ts'), 'utf8');
const EDITOR = readFileSync(join(HERE, '../../../app/n/[id].tsx'), 'utf8');

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

describe('the recorder', () => {
  it('reads a file that actually contains the writers', () => {
    // Without this, a renamed or moved file makes every assertion below pass by
    // finding nothing at all.
    expect(RESTRUCTURE).toContain('export async function restructureNote');
    expect(RESTRUCTURE).toContain('export async function enhanceNote');
  });

  it('writes the note in exactly one place, for both passes', () => {
    // The two passes used to be two write paths, and a rule enforced in one copy
    // is not enforced. They now share one `commit`, which is why the counts here
    // are one rather than two: a second `updateNote` is a second opinion about
    // who owns what.
    expect(occurrences(RESTRUCTURE, 'updateNote(')).toBe(1);
    expect(occurrences(RESTRUCTURE, 'userBodyOf(')).toBe(1);
  });

  it('sends both halves and composes neither', () => {
    // The duplication bug: the generated block was written as the whole body,
    // then read back next slice as if the user had typed it, and appended to.
    // It is the store that puts the halves together, against the row as it
    // stands at write time — so composing here would be composing against a
    // copy of the note that a slice or a keystroke may already have moved past.
    expect(RESTRUCTURE).toContain('userBody: context.userBody');
    expect(RESTRUCTURE).toContain('generatedBody: composed.generatedBody');
    expect(RESTRUCTURE).not.toContain('composeNoteBody');
  });

  it('never shows a writer the note body it wrote itself', () => {
    // The model is handed the USER's half, never the composed body: shown its
    // own previous output it summarises itself. The deterministic pass is handed
    // no body at all — it reads the transcript.
    expect(RESTRUCTURE).toContain('body: context.userBody');
    expect(RESTRUCTURE).not.toMatch(/body:\s*context\.note\.body/);
  });

  it('treats generated checklist items as the app’s, by id and not by text', () => {
    // The exact-substring trick this epic exists to delete: it could not tell an
    // edit from a paragraph typed after the block, and said nothing at all about
    // a checklist item.
    expect(RESTRUCTURE).toContain('isGeneratedItemId(');
  });
});

describe('the store', () => {
  it('reads a file that actually contains the writes', () => {
    expect(REPO).toContain('export async function createNote');
    expect(REPO).toContain('export async function updateNote');
  });

  it('is the one place a body is assembled', () => {
    // Both writes hand their halves to the assembler; a write that stopped
    // doing so would have to compose somewhere else, and the single path would
    // be two.
    expect(occurrences(REPO, 'nextNoteBody(')).toBe(2);
  });

  it('does not accept a whole body from anyone', () => {
    // `NoteInput` deliberately drops `body` from the fields it picks. A caller
    // able to set it is a caller able to overwrite the half it does not own.
    expect(REPO).not.toMatch(/\|\s*'body'/);
  });
});

describe('the open editor', () => {
  it('reads a file that actually contains the editor', () => {
    expect(EDITOR).toContain('export default function NoteEditorScreen');
  });

  it('sends only the half it owns', () => {
    // The reported bug: the editor persisted `body` in full, so a keystroke in
    // an open note wrote back the body as it was when the note opened and
    // erased everything the recorder had added since.
    expect(EDITOR).toContain('userBodyOf(next.body, next.generatedBody)');
    expect(EDITOR).not.toMatch(/^\s*body: next\.body,\s*$/m);
  });

  it('follows the store instead of hydrating once', () => {
    // `hydrated` was a boolean that never went back to false, so nothing
    // written after the note opened ever reached the draft — which is why the
    // card and the editor showed different text for the same note.
    expect(EDITOR).toContain('reconcileDraft(');
    expect(EDITOR).not.toContain('setHydrated');
  });
});
