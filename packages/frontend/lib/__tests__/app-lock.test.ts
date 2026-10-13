import { describe, expect, it } from 'vitest';
import { LOCK_GRACE_MS, initialLocked, lockApplies, lockOnReturn } from '@/lib/app-lock';

const on = { enabled: true, canAuthenticate: true };

describe('lockApplies', () => {
  it('needs both the setting and a way to authenticate', () => {
    expect(lockApplies(on)).toBe(true);
    expect(lockApplies({ enabled: false, canAuthenticate: true })).toBe(false);
  });

  it('never engages a lock nobody can open', () => {
    expect(lockApplies({ enabled: true, canAuthenticate: false })).toBe(false);
  });
});

describe('initialLocked', () => {
  it('starts locked only when the lock applies', () => {
    expect(initialLocked(on)).toBe(true);
    expect(initialLocked({ enabled: false, canAuthenticate: true })).toBe(false);
    expect(initialLocked({ enabled: true, canAuthenticate: false })).toBe(false);
  });
});

describe('lockOnReturn', () => {
  const t0 = 1_000_000;

  it('stays open for a short trip out of the app', () => {
    expect(lockOnReturn(on, t0, t0 + LOCK_GRACE_MS - 1)).toBe(false);
  });

  it('locks once the grace period has passed, boundary included', () => {
    expect(lockOnReturn(on, t0, t0 + LOCK_GRACE_MS)).toBe(true);
    expect(lockOnReturn(on, t0, t0 + 10 * 60_000)).toBe(true);
  });

  it('does nothing when the app was never seen leaving', () => {
    expect(lockOnReturn(on, null, t0)).toBe(false);
  });

  it('does nothing when the lock does not apply', () => {
    const off = { enabled: false, canAuthenticate: true };
    expect(lockOnReturn(off, t0, t0 + 10 * 60_000)).toBe(false);
  });
});
