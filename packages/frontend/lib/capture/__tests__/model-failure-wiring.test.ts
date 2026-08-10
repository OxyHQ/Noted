/**
 * That a model failure is not a failed note.
 *
 * Reported from a running browser. The recording finished, the deterministic note
 * was written, the model loaded — and then generation died inside the ONNX
 * runtime:
 *
 *     Program Gather requires f16 but the device does not support it.
 *
 * The exception propagated out of the finalisation pass, so the capture was
 * marked `generation: 'failed'` and the user was told "the recording is safe, but
 * Noted could not finish the notes" — with a Retry button that would fail the
 * same way, about a note that was sitting finished on their screen.
 *
 * The deterministic artifact is committed BEFORE the model is asked anything,
 * which is what makes every failure after that point survivable. This checks the
 * order and the boundary, because both are invisible to a suite that cannot run a
 * model: `restructure.ts` reaches SQLite, and the failure only reproduces on a
 * GPU without half-precision shaders.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HERE = import.meta.dirname;
const read = (path: string): string => readFileSync(join(HERE, '..', '..', path), 'utf8');

const RESTRUCTURE = read('capture/restructure.ts');
const SUMMARIZER_WEB = read('enhance/summarizer.web.ts');

describe('the files this checks', () => {
  it('are the files it thinks they are', () => {
    expect(RESTRUCTURE).toContain('export async function enhanceNote');
    expect(SUMMARIZER_WEB).toContain('export function getSummarizer');
  });
});

describe('the settled note is written before the model is asked', () => {
  it('commits the deterministic artifact first', () => {
    // The order is the guarantee. Asking the model first and committing
    // afterwards would make every model failure a lost note.
    const commitAt = RESTRUCTURE.indexOf('committed(settled,');
    const modelAt = RESTRUCTURE.indexOf('summarizer.enhance(');
    expect(commitAt).toBeGreaterThanOrEqual(0);
    expect(modelAt).toBeGreaterThan(commitAt);
  });

  it('does not let the model pass throw out of finalisation', () => {
    // The queue rethrows a failed FINAL task on purpose, so the capture can be
    // marked failed. That is right for a finalisation that produced nothing, and
    // wrong for one that produced a complete note and then failed to improve it.
    expect(RESTRUCTURE).toContain('enhanceWithModel(');
    expect(RESTRUCTURE).toMatch(/} catch \(error\) \{[\s\S]*could not improve the note/);
  });
});

describe('the browser model asks the GPU what it can run', () => {
  it('picks the quantisation from the adapter rather than assuming', () => {
    // `q4f16` needs `shader-f16`. Assuming it produced a 483 MB download and
    // then a shader compilation failure, by which point the user had recorded a
    // meeting and waited.
    expect(SUMMARIZER_WEB).toContain("has('shader-f16')");
    expect(SUMMARIZER_WEB).toContain('dtypeFor(adapter)');
  });

  it('does not hardcode one dtype at the call site', () => {
    expect(SUMMARIZER_WEB).not.toMatch(/dtype: 'q4f16'/);
  });
});
