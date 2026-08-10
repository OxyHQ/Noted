import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { hasRemovableParts, RETENTION_KEYS, retentionParts } from '@/lib/capture/retention';
import { CAPTURE_PROFILES } from '@/lib/artifact/types';

describe('what a recording is keeping', () => {
  it('offers the audio first, because that is the one people delete for space', () => {
    expect(retentionParts({ audioPath: 'audio:c1', segmentCount: 12 }).map((part) => part.kind)).toEqual([
      'audio',
      'transcript',
    ]);
  });

  it('knows when there is nothing to delete', () => {
    const empty = { audioPath: '', segmentCount: 0 };
    expect(hasRemovableParts(empty)).toBe(false);
    expect(retentionParts(empty).every((part) => !part.present)).toBe(true);
  });

  it('offers the transcript even when the audio is already gone', () => {
    // The two are stored separately and deleted separately; a control that hid
    // one because the other was missing would strand the remaining half.
    const parts = retentionParts({ audioPath: '', segmentCount: 12 });
    expect(parts[0].present).toBe(false);
    expect(parts[1].present).toBe(true);
    expect(hasRemovableParts({ audioPath: '', segmentCount: 12 })).toBe(true);
  });

  it('says what each deletion costs and what survives it', () => {
    // The consequences are not symmetric, and a control that did not say so is a
    // control that surprises people.
    for (const part of retentionParts({ audioPath: 'x', segmentCount: 1 })) {
      expect(part.costKey).not.toBe(part.keepsKey);
    }
  });
});

describe('the copy', () => {
  const locales = ['en', 'es'] as const;

  function read(locale: string): Record<string, unknown> {
    return JSON.parse(
      readFileSync(join(import.meta.dirname, '../../i18n/locales', `${locale}.json`), 'utf8'),
    ) as Record<string, unknown>;
  }

  function lookup(bundle: Record<string, unknown>, key: string): unknown {
    return key.split('.').reduce<unknown>((node, part) => {
      if (typeof node !== 'object' || node === null) return undefined;
      return (node as Record<string, unknown>)[part];
    }, bundle);
  }

  it('exists in every locale, for every consequence this can state', () => {
    expect(RETENTION_KEYS.length).toBe(4);
    for (const locale of locales) {
      const bundle = read(locale);
      for (const key of RETENTION_KEYS) {
        expect(typeof lookup(bundle, key), `${locale} ${key}`).toBe('string');
      }
    }
  });

  it('names every profile the picker can offer', () => {
    // A missing one renders as `capture.profile.brainstorm` in a menu, and
    // nothing else in the app would catch it.
    for (const locale of locales) {
      const bundle = read(locale);
      for (const profile of CAPTURE_PROFILES) {
        expect(typeof lookup(bundle, `capture.profile.${profile}`), `${locale} ${profile}`).toBe(
          'string',
        );
      }
    }
  });

  it('reads a real value, so a broken lookup cannot pass', () => {
    expect(lookup(read('en'), 'capture.retention.audioCost')).toBeTypeOf('string');
    expect(lookup(read('en'), 'capture.retention.nope')).toBeUndefined();
  });
});
