import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defined } from '@/lib/__tests__/defined';
import { createLockManager, deferred } from '@/lib/db/__tests__/browser-lock-fixture';
import { accountLockName } from '@/lib/db/web-locks';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
const db = vi.hoisted(() => ({ execute: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/db/client', () => ({
  execute: db.execute,
  executeTransaction: db.transaction,
  getActiveViewerId: () => 'alice',
}));
vi.mock('@/lib/db/live-query', () => ({ useLiveQuery: vi.fn() }));
vi.mock('@/lib/audio/store', () => ({ deleteCaptureAudio: vi.fn() }));

async function tab() {
  vi.resetModules();
  return {
    ownership: await import('@/lib/capture/ownership'),
    repo: await import('@/lib/capture/captures-repo'),
  };
}

beforeEach(() => {
  vi.stubGlobal('navigator', { locks: createLockManager() });
  db.execute.mockReset().mockResolvedValue([{ id: 'capture' }]);
  db.transaction.mockReset().mockResolvedValue([1]);
});
afterEach(() => vi.unstubAllGlobals());

describe('cross-tab recording ownership', () => {
  it('claims before inserting the starting row, so another tab never recovers a live recording', async () => {
    const first = await tab();
    const second = await tab();
    const insert = deferred<number[]>();
    db.transaction.mockImplementationOnce(() => insert.promise);
    const started = first.repo.beginCapture(
      { id: 'capture', noteId: 'note', audioPath: '' },
      'alice',
    );
    await vi.waitFor(() => expect(db.transaction).toHaveBeenCalledOnce());

    expect(await second.repo.recoverInterruptedCaptures('alice')).toBe(0);
    expect(db.transaction).toHaveBeenCalledOnce();
    insert.resolve([1]);
    await started;
    expect(await second.repo.recoverInterruptedCaptures('alice')).toBe(0);
    first.ownership.releaseCapture('alice', 'capture');
    await Promise.resolve();
    expect(await second.repo.recoverInterruptedCaptures('alice')).toBe(1);
    const [[statement], viewer] = defined(db.transaction.mock.calls.at(-1), 'a transaction call');
    expect(viewer).toBe('alice');
    expect(statement.sql).toContain('WHERE id = ? AND capture_status IN');
    expect(statement.params.at(-1)).toBe('capture');
  });

  it('releases a failed startup lease, keeping the surviving row recoverable', async () => {
    const first = await tab();
    const second = await tab();
    db.transaction.mockRejectedValueOnce(new Error('write interrupted'));
    await expect(
      first.repo.beginCapture({ id: 'capture', noteId: 'note', audioPath: '' }, 'alice'),
    ).rejects.toThrow('write interrupted');
    expect(await second.repo.recoverInterruptedCaptures('alice')).toBe(1);
  });

  it('releases ownership when stop persistence is rejected after an account change', async () => {
    const first = await tab();
    const second = await tab();
    await first.repo.beginCapture({ id: 'capture', noteId: 'note', audioPath: '' }, 'alice');
    db.transaction.mockRejectedValueOnce(new Error('account changed'));
    await expect(first.repo.finishCapture('capture', 10, 'audio', 'alice')).rejects.toThrow(
      'account changed',
    );
    expect(await second.repo.recoverInterruptedCaptures('alice')).toBe(1);
  });

  it('does not let another tab release the live owner, and keeps opaque account IDs distinct', async () => {
    const first = await tab();
    const second = await tab();
    await first.ownership.claimCapture('alice/a', 'capture');
    second.ownership.releaseCapture('alice/a', 'capture');
    const recover = vi.fn().mockResolvedValue(1);
    expect(await second.ownership.recoverUnownedCapture('alice/a', 'capture', recover)).toBeNull();
    expect(await second.ownership.recoverUnownedCapture('alice_a', 'capture', recover)).toBe(1);
    expect(accountLockName('capture', 'alice/a', 'capture')).not.toBe(
      accountLockName('capture', 'alice_a', 'capture'),
    );
    await expect(second.ownership.claimCapture('alice/a', 'capture')).rejects.toThrow(
      'another tab',
    );
    first.ownership.releaseCapture('alice/a', 'capture');
  });
});
