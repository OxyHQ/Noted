import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The browser engine cannot be loaded in a test (it reaches for transformers.js and
// the audio stack), so these read the source: what matters is that each place that
// transcribes goes through the desktop path when the shell is detected, and that the
// live recorder does not hammer the sidecar with provisional text.
const read = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8');

describe('desktop transcription wiring', () => {
  const engine = read('engine.web.ts');

  it('chooses the sidecar once, from the shell detection', () => {
    expect(engine).toContain('isDesktop() ? createDesktopTranscriber(loadTauriInvoke) : null');
  });

  it('sends both the live slices and whole recordings through it', () => {
    expect(engine).toMatch(/if \(desktop\) \{\s*return desktop\.transcribe\(/);
    expect(engine).toMatch(
      /if \(desktop\) \{\s*const segments = await desktop\.transcribeRecording\(/,
    );
  });

  it('passes the chosen model on for a whole recording', () => {
    expect(engine).toContain('model: request.model');
  });

  it('turns provisional text off on desktop, and the live recorder honours it', () => {
    expect(engine).toContain('export const PARTIAL_TRANSCRIPTION = desktop === null;');
    const realtime = read('realtime.web.ts');
    expect(realtime).toMatch(/if \(!PARTIAL_TRANSCRIPTION\) return;\s*run\(/);
  });
});

describe('desktop model bookkeeping', () => {
  const root = join(__dirname, '..', '..');
  const models = readFileSync(join(root, 'stt', 'models.ts'), 'utf8');

  it('records the same model_files states as the phone, so the recorder can see the model', () => {
    expect(models).toContain("recordState(model, 'downloading', viewer)");
    expect(models).toContain("recordState(model, 'ready', viewer)");
    expect(models).toContain("recordState(model, 'failed', viewer)");
    expect(models).toContain("recordState(model, 'absent', viewer)");
  });

  it('makes the capture engine wait for a downloaded model on desktop as on a phone', () => {
    const engine = readFileSync(join(root, 'capture', 'use-capture-engine.ts'), 'utf8');
    expect(engine).toContain(
      'hasDownloadableModels() || isDesktop() ? readyModels.has(model) : true',
    );
  });
});
