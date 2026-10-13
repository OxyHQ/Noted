import { describe, expect, it } from 'vitest';
import { shouldShowOnboarding } from '@/lib/onboarding';

const base = { settingsLoading: false, notesLoading: false, seen: false, noteCount: 0 };

describe('shouldShowOnboarding', () => {
  it('shows to a new account with no notes', () => {
    expect(shouldShowOnboarding(base)).toBe(true);
  });

  it('waits until both stores have answered', () => {
    expect(shouldShowOnboarding({ ...base, settingsLoading: true })).toBe(false);
    expect(shouldShowOnboarding({ ...base, notesLoading: true })).toBe(false);
  });

  it('never shows twice, or to someone who already has notes', () => {
    expect(shouldShowOnboarding({ ...base, seen: true })).toBe(false);
    expect(shouldShowOnboarding({ ...base, noteCount: 3 })).toBe(false);
  });
});
