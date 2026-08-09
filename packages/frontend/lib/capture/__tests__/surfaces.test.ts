import { describe, expect, it } from 'vitest';

import { showsRecordButton } from '@/lib/capture/surfaces';

describe('showsRecordButton', () => {
  it('offers to record on the note lists', () => {
    for (const path of ['/', '/reminders', '/labels', '/archive', '/trash']) {
      expect(showsRecordButton(path)).toBe(true);
    }
  });

  it('offers to record on a single note', () => {
    expect(showsRecordButton('/n/0198c3f2a1b74e0f8c2d5a6b7c8d9e01')).toBe(true);
  });

  it('stays off the settings screens', () => {
    // The report that prompted this rule: a floating microphone on top of
    // settings. Every settings route, not just the index.
    expect(showsRecordButton('/settings')).toBe(false);
    expect(showsRecordButton('/settings/general')).toBe(false);
    expect(showsRecordButton('/settings/transcription')).toBe(false);
  });

  it('stays off the screens that exist before a session does', () => {
    expect(showsRecordButton('/login')).toBe(false);
    expect(showsRecordButton('/authorize')).toBe(false);
    expect(showsRecordButton('/reset-password')).toBe(false);
  });

  it('does not treat a route that merely starts with a note list as one', () => {
    // `/trash` is a list; `/trashcan` would be a different screen entirely, and
    // a prefix match rather than an exact one would silently claim it.
    expect(showsRecordButton('/trashcan')).toBe(false);
    expect(showsRecordButton('/labels-editor')).toBe(false);
  });

  it('does not claim an unknown route by default', () => {
    expect(showsRecordButton('/something-added-next-year')).toBe(false);
  });
});
