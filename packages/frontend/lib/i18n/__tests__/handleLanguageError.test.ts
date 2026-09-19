import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockError } = vi.hoisted(() => ({ mockError: vi.fn() }));
vi.mock('@oxy.so/core/logger', () => ({
  createLogger: () => ({ error: mockError }),
}));

import { handleLanguageError } from '../handleLanguageError';

/**
 * `OxyProvider`'s `language` config reports a failed `onChange` here instead
 * of throwing into render — a missing catalogue entry for the resolved
 * locale must not take the whole app tree down over a chrome-language
 * mismatch.
 */
describe('handleLanguageError', () => {
  beforeEach(() => {
    mockError.mockClear();
  });

  it('logs the failure with the locale that failed to load, never throws', () => {
    const failure = new Error('missing catalogue entry');

    expect(() => handleLanguageError(failure, 'es')).not.toThrow();
    expect(mockError).toHaveBeenCalledWith(
      'Failed to follow the Oxy-resolved language',
      failure,
      { locale: 'es' },
    );
  });
});
