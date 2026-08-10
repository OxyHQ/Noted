/**
 * That the sentence on screen matches what actually happened.
 *
 * Eight distinct situations rendered as one line:
 *
 *     Basic notes are ready. This device cannot organize them further.
 *
 * Two of them are about the PAGE — an http:// URL, a browser without WebGPU —
 * where the remedy is a different address and the device is irrelevant. Two are
 * about the model's OUTPUT, where a retry is the remedy and none was offered.
 * Telling somebody their machine is incapable, when it is not and when the fix
 * is one they could have applied, is the user-visible half of #68.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { captureStatus, CAPTURE_STATUS_KEYS } from '@/lib/capture/status';
import type { CaptureLifecycle } from '@/lib/capture/lifecycle';

const settled = (over: Partial<CaptureLifecycle> = {}): CaptureLifecycle => ({
  capture: 'stopped',
  transcription: 'complete',
  generation: 'complete',
  enhancement: 'complete',
  ...over,
});

const read = (locale: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, '../../i18n/locales', `${locale}.json`), 'utf8'),
  ) as Record<string, unknown>;

const lookup = (bundle: Record<string, unknown>, key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => {
    if (typeof node !== 'object' || node === null) return undefined;
    return (node as Record<string, unknown>)[part];
  }, bundle);

describe('a page problem does not read as a hardware problem', () => {
  it.each([
    ['insecure_context'],
    ['navigator_gpu_missing'],
    ['adapter_unavailable'],
    ['device_request_failed'],
    ['runtime_initialization_failed'],
    ['model_files_unavailable'],
  ])('%s gets its own sentence', (reason) => {
    const status = captureStatus(settled({ enhancement: 'unsupported' }), reason);
    expect(status.messageKey).not.toBe('capture.status.basicReady');
    expect(typeof lookup(read('en'), status.messageKey)).toBe('string');
    expect(typeof lookup(read('es'), status.messageKey)).toBe('string');
  });

  it('tells the user to change the URL when that is the actual fix', () => {
    const status = captureStatus(settled({ enhancement: 'unsupported' }), 'insecure_context');
    const english = String(lookup(read('en'), status.messageKey));
    expect(english).toMatch(/HTTPS|localhost/);
    // And says nothing about the device, which is not the problem.
    expect(english).not.toMatch(/device cannot/i);
  });

  it('falls back to the generic line for a reason nobody wrote copy for', () => {
    // Degrading to the old sentence is right; rendering the raw reason as a key
    // in the middle of a note is not.
    const status = captureStatus(settled({ enhancement: 'unsupported' }), 'something_new');
    expect(status.messageKey).toBe('capture.status.basicReady');
  });
});

describe('an unusable answer offers the retry it needs', () => {
  it.each([['truncated'], ['all_content_dropped']])('%s is retryable and specific', (reason) => {
    const status = captureStatus(settled({ enhancement: 'failed' }), reason);
    expect(status.retry).toBe('enhancement');
    expect(status.messageKey).not.toBe('capture.status.enhancementFailed');
    expect(typeof lookup(read('en'), status.messageKey)).toBe('string');
  });

  it('says the note was cut off rather than that the device failed', () => {
    const status = captureStatus(settled({ enhancement: 'failed' }), 'truncated');
    expect(String(lookup(read('en'), status.messageKey))).toMatch(/cut off/i);
  });
});

describe('the copy gate covers the new keys', () => {
  it('lists every reason key, in both locales', () => {
    // Derived from the reason map rather than typed again, so a reason added
    // without copy fails here instead of rendering as its own key on screen.
    const reasonKeys = CAPTURE_STATUS_KEYS.filter((key) => key.includes('basicReady') || key.includes('enhancement'));
    expect(reasonKeys.length).toBeGreaterThan(8);
    for (const locale of ['en', 'es']) {
      const bundle = read(locale);
      for (const key of CAPTURE_STATUS_KEYS) {
        expect(typeof lookup(bundle, key), `${locale} ${key}`).toBe('string');
      }
    }
  });
});
