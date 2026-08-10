/**
 * That the browser shows a note and not its plumbing.
 *
 * Half of #59 was invisible to every check the app has: a generated note is
 * Markdown, and the web body was a plain field, so `## Decisions` and leading
 * dashes were what the user read. Nothing failed — the note was correct, the
 * suite was green, and the screen was wrong.
 *
 * This cannot render anything: the suite runs in node, and the renderer parses
 * Markdown in WebAssembly inside a browser. What it can do is hold the wiring in
 * place, so the field cannot quietly become the whole story again.
 *
 * ## What was verified, and how, since this file cannot do it
 *
 * The rendered surface was checked in Chromium against the real route on a real
 * dev server: `## How AI entered the agenda` came back as an `<h2>`, the dashed
 * lines as `<li>`, the quotation as a `<blockquote>`, no `##` anywhere on
 * screen, and no console errors. A click between "neuro" and "científicos" put
 * the caret at exactly that character of the Markdown behind it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): string =>
  readFileSync(join(import.meta.dirname, '../../..', path), 'utf8');

const WEB = read('components/notes/markdown-body-editor.web.tsx');
const NATIVE = read('components/notes/markdown-body-editor.native.tsx');

/**
 * The file with its prose taken out.
 *
 * Both of these files EXPLAIN in comments which component exists on which
 * platform, so a plain search of the source finds the phone's editor named in
 * the browser's build and reads it as an import. What is imported and what is
 * rendered are the only things here that change behaviour.
 */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the browser reads a note as a document', () => {
  it('renders it with the library build that exists on web', () => {
    // The JSX, not the import: an import nothing renders is how this regressed
    // to a plain field with the wiring still apparently in place.
    expect(code(WEB)).toContain('<EnrichedMarkdownText');
  });

  it('does not reach for the editor that exists only on a phone', () => {
    // `EnrichedMarkdownTextInput` is iOS and Android only. Importing it here
    // resolves to `undefined`, which React reports as "Element type is invalid"
    // and takes the whole screen down — which is what it did.
    expect(code(WEB)).not.toContain('EnrichedMarkdownTextInput');
  });

  it('is not vacuous — the phone build is what a real match looks like', () => {
    // The same search against the file that genuinely does import it. Without
    // this, a `code()` that stripped everything would pass the assertion above.
    expect(code(NATIVE)).toContain('EnrichedMarkdownTextInput');
    expect(code(NATIVE)).not.toContain('markdownOffsetForRenderedPrefix');
  });
});

describe('and is still editable where the reader is pointing', () => {
  it('aligns a click on the rendered text with the Markdown behind it', () => {
    expect(WEB).toContain('markdownOffsetForRenderedPrefix');
    expect(WEB).toContain('setSelectionRange');
  });

  it('asks the browser for the caret in both the ways browsers answer', () => {
    // One of these is missing from Safari and the other from older Chrome. A
    // build that only asks one way silently loses click-to-edit in that engine.
    expect(WEB).toContain('caretPositionFromPoint');
    expect(WEB).toContain('caretRangeFromPoint');
  });

  it('opens the field for a note with nothing in it yet', () => {
    // There is nothing to render and everything to invite. Without this the
    // placeholder would be behind an empty reading surface.
    expect(WEB).toContain('value.trim().length === 0');
  });
});
