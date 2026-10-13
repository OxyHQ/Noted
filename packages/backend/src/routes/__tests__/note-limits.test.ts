import { describe, expect, it } from 'bun:test';
import { NOTE_LIMITS, noteWriteSchema } from '../notes';

describe('noteWriteSchema list limits', () => {
  it('accepts a note at every ceiling', () => {
    const result = noteWriteSchema.safeParse({
      attachments: Array.from({ length: NOTE_LIMITS.attachments }, (_, i) => `file-${i}`),
      labels: Array.from({ length: NOTE_LIMITS.labels }, (_, i) => `label-${i}`),
    });
    expect(result.success).toBe(true);
  });

  it('rejects one past a ceiling', () => {
    expect(
      noteWriteSchema.safeParse({
        attachments: Array.from({ length: NOTE_LIMITS.attachments + 1 }, (_, i) => `f${i}`),
      }).success,
    ).toBe(false);
    expect(
      noteWriteSchema.safeParse({
        labels: Array.from({ length: NOTE_LIMITS.labels + 1 }, (_, i) => `l${i}`),
      }).success,
    ).toBe(false);
  });

  it('rejects an oversized id', () => {
    expect(
      noteWriteSchema.safeParse({ attachments: ['x'.repeat(NOTE_LIMITS.idLength + 1)] }).success,
    ).toBe(false);
  });
});
