import { describe, expect, it } from 'vitest';

import { digestCapabilityInput, IdempotencyConflictError } from '../capability-idempotency.js';

describe('capability idempotency', () => {
  it('hashes semantically identical object input identically', () => {
    expect(digestCapabilityInput({ b: 2, a: { d: 4, c: 3 } })).toBe(
      digestCapabilityInput({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it('keeps array order significant', () => {
    expect(digestCapabilityInput({ labels: ['a', 'b'] })).not.toBe(
      digestCapabilityInput({ labels: ['b', 'a'] }),
    );
  });

  it('exposes a stable conflict error for callers', () => {
    const error = new IdempotencyConflictError();
    expect(error.name).toBe('IdempotencyConflictError');
    expect(error.message).toContain('different input');
  });
});
