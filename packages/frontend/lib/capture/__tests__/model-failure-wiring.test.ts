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
    expect(RESTRUCTURE).toContain('export async function finalizeNote');
    expect(RESTRUCTURE).toContain('export async function enhanceNote');
    expect(SUMMARIZER_WEB).toContain('export function getSummarizer');
  });
});

describe('the note and the improvement are two operations', () => {
  const COORDINATOR = read('capture/coordinator.ts');

  it('writes the note without asking a model anything', () => {
    // `finalizeNote` is the pass that must always work. It reaching for a model
    // is what made a model failure look like a lost note in the first place.
    const finalize = RESTRUCTURE.slice(
      RESTRUCTURE.indexOf('export async function finalizeNote'),
      RESTRUCTURE.indexOf('export async function enhanceNote'),
    );
    expect(finalize).toContain('committed(settled,');
    expect(finalize).not.toContain('getSummarizer(');
    expect(finalize).not.toContain('summarizer.enhance');
  });

  it('improves it from a separate entry point', () => {
    expect(RESTRUCTURE).toContain('export async function enhanceNote');
    expect(RESTRUCTURE).toContain('runModel(summarizer');
  });

  it('improves what was actually persisted, not a second opinion', () => {
    // Rebuilding the artifact here and improving THAT would show the user a note
    // nobody committed.
    expect(RESTRUCTURE).toContain('const settled = context.artifacts.final;');
  });

  it('does not let a failed improvement mark the note failed', () => {
    // The reported symptom, as a gate: `generation` is the note, `enhancement`
    // is the improvement, and the second failing must never write the first.
    const enhancement = COORDINATOR.slice(COORDINATOR.indexOf('private async runEnhancement'));
    expect(enhancement).toContain("enhancement: 'failed'");
    expect(enhancement).not.toContain("generation: 'failed'");
  });

  it('stops before the improvement when there is no note to improve', () => {
    expect(COORDINATOR).toContain('this.finalizing = null;\n        return;');
  });

  it('records the stage that failed, not one word for all of them', () => {
    expect(COORDINATOR).toContain("errorCodeOf(error, 'deterministic_generate')");
    expect(COORDINATOR).toContain("errorCodeOf(error, 'model_inference')");
  });
});

describe('the browser model asks the GPU what it can run', () => {
  it('picks the quantisation from what the device reports, not from an assumption', () => {
    // `q4f16` needs `shader-f16`. Assuming it produced a 483 MB download and
    // then a shader compilation failure, by which point the user had recorded a
    // meeting and waited.
    expect(SUMMARIZER_WEB).toContain("has('shader-f16')");
    // Asked of the DEVICE first. An adapter is not what compiles shaders, and
    // the probe now goes all the way to a `GPUDevice` — so the answer that
    // chooses the dtype is the one inference actually runs on.
    expect(SUMMARIZER_WEB).toContain('device.features?.has');
  });

  it('asks for a device, not only an adapter', () => {
    // A machine can advertise an adapter and refuse `requestDevice()`. The old
    // probe called that supported, downloaded the weights, and failed after.
    expect(SUMMARIZER_WEB).toContain('requestDevice');
    expect(SUMMARIZER_WEB).toContain("reason: 'device_request_failed'");
  });

  it('does not hardcode one dtype at the call site', () => {
    // The pipeline is handed the value the probe decided, never a literal. A
    // plain "the string q4f16 does not appear" would now fail on the type
    // annotation `dtype: 'q4f16' | 'q4'`, which is the opposite of a problem.
    expect(SUMMARIZER_WEB).toContain("{ device: 'webgpu', dtype }");
    expect(SUMMARIZER_WEB).not.toMatch(/dtype: 'q4f16' \}/);
  });
});
