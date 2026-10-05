import { describe, expect, it } from 'vitest';
import { attachmentMetadataKey, readScopedStorage, displayStorageUsage, scopedAttachmentSelection } from '../shared-storage';

describe('Oxy attachment storage ownership', () => {
  it('shares the server account limit instead of adding a Noted allowance', () => {
    for (const totalLimitBytes of [15 * 1024 ** 3, 100_000_000_000, 2 * 1024 ** 4]) {
      const result = displayStorageUsage({ totalUsedBytes: 1_000_000_000, totalLimitBytes, quotaEnforcement: 'metadata_admission' });
      expect(result.usedGB).toBe('1');
      expect(result.limitGB).toBe((totalLimitBytes / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }));
    }
  });
  it('reflects cancellation and expiry through the next authoritative response', () => {
    expect(displayStorageUsage({ totalUsedBytes: 0, totalLimitBytes: 100_000_000_000, quotaEnforcement: 'metadata_admission' }).limitGB).toBe('100');
    expect(displayStorageUsage({ totalUsedBytes: 0, totalLimitBytes: 15 * 1024 ** 3, quotaEnforcement: 'metadata_admission' }).limitGB).not.toBe('100');
  });
  it('does not claim configured enforcement for legacy or unconfigured responses', () => {
    for (const quotaEnforcement of [undefined, 'unconfigured'] as const) {
      expect(displayStorageUsage({ totalUsedBytes: 0, totalLimitBytes: 15 * 1024 ** 3, quotaEnforcement }).configured).toBe(false);
    }
  });
  it('rejects malformed usage instead of inventing a quota', () => {
    for (const totalLimitBytes of [-1, NaN, Infinity, 1.5]) expect(() => displayStorageUsage({ totalUsedBytes: 0, totalLimitBytes })).toThrow();
  });
  it('blocks picker callbacks after account switch, signout and same-account session switch', () => {
    let current = { accountId: 'A', sessionId: 'sA' } as { accountId: string | null; sessionId: string | null };
    const accepted: string[][] = [];
    const select = scopedAttachmentSelection(current, () => current, ids => accepted.push(ids));
    select(['own-file']);
    current = { accountId: 'B', sessionId: 'sB' }; select(['A-private-file']);
    current = { accountId: null, sessionId: null }; select(['A-private-file']);
    current = { accountId: 'A', sessionId: 'sA2' }; select(['A-private-file']);
    expect(accepted).toEqual([['own-file']]);
  });
});

describe('private attachment responses', () => {
  it('separates cached file IDs by account and session', () => {
    const a = attachmentMetadataKey({ accountId: 'A', sessionId: 'sA' }, 'same-file');
    expect(a).not.toEqual(attachmentMetadataKey({ accountId: 'B', sessionId: 'sB' }, 'same-file'));
    expect(a).not.toEqual(attachmentMetadataKey({ accountId: 'A', sessionId: 'sA2' }, 'same-file'));
  });
  it('rejects an in-flight response after an account switch', async () => {
    let current = { accountId: 'A', sessionId: 'sA' };
    let finish!: (value: string) => void;
    const pending = readScopedStorage(current, () => current, () => new Promise<string>(resolve => { finish = resolve; }));
    const rejected = expect(pending).rejects.toThrow('Storage account changed');
    current = { accountId: 'B', sessionId: 'sB' };
    finish('private-A-metadata');
    await rejected;
  });
  it('passes SDK read failures through without inventing capacity', async () => {
    const identity = { accountId: 'A', sessionId: 'sA' };
    await expect(readScopedStorage(identity, () => identity, async () => { throw new Error('413 quota exceeded'); })).rejects.toThrow('413 quota exceeded');
  });
});
