import { describe, expect, it } from 'vitest';

import {
  decideMerge,
  OUTBOX_BASE_DELAY_MS,
  OUTBOX_MAX_DELAY_MS,
  outboxRetryDelayMs,
  type LocalNoteState,
} from '@/lib/db/merge';

const OLD = '2026-08-01T10:00:00.000Z';
const MID = '2026-08-01T11:00:00.000Z';
const NEW = '2026-08-01T12:00:00.000Z';

function local(overrides: Partial<LocalNoteState>): LocalNoteState {
  return { updatedAt: MID, serverUpdatedAt: OLD, dirty: false, ...overrides };
}

describe('decideMerge', () => {
  it('takes the server version for a note it has never seen', () => {
    expect(decideMerge(null, NEW)).toBe('apply');
  });

  it('takes the server version when there is nothing local to lose', () => {
    expect(decideMerge(local({ dirty: false }), NEW)).toBe('apply');
  });

  it('does nothing with a version it already holds', () => {
    // The ordinary case in a pull: an untouched note the server re-sends
    // unchanged. Applying it would write a row identical to the one already
    // there, which wakes every live query over that table and invites the pull
    // that follows — a sync loop that never settles. Every other clean-note
    // fixture here is deliberately mismatched (`OLD` against `NEW`), so this is
    // the only one that can tell "already have it" from "take the server's".
    expect(decideMerge(local({ dirty: false, serverUpdatedAt: NEW }), NEW)).toBe('skip');
  });

  it('keeps unsent local edits made on top of the version the server still holds', () => {
    expect(decideMerge(local({ dirty: true, serverUpdatedAt: NEW }), NEW)).toBe('skip');
  });

  it('reports a conflict when both sides moved', () => {
    expect(decideMerge(local({ dirty: true, serverUpdatedAt: OLD }), NEW)).toBe('conflict');
  });

  // The two cases below are the whole reason this function compares
  // `serverUpdatedAt` instead of `updatedAt`. Every other case above passes
  // under either rule, so without these a naive "newest timestamp wins" would
  // look correct — and would silently drop text the user typed.
  it('does not treat a newer local timestamp as agreement with the server', () => {
    // Local clock ahead of the server's, and the server has genuinely changed
    // since this device last agreed with it. Timestamp-ordering would call the
    // local copy the winner and drop the server's edit without a trace.
    const ahead = local({ dirty: true, updatedAt: NEW, serverUpdatedAt: OLD });
    expect(decideMerge(ahead, MID)).toBe('conflict');
  });

  it('keeps local edits whose timestamp is older than the server version they are based on', () => {
    // Local clock behind the server's, but this device has seen exactly the
    // version the server is offering. Timestamp-ordering would call the server
    // newer and overwrite the user's unsent text.
    const behind = local({ dirty: true, updatedAt: OLD, serverUpdatedAt: NEW });
    expect(decideMerge(behind, NEW)).toBe('skip');
  });

  it('treats a locally-created note the server also knows about as a conflict', () => {
    // The upload landed but its response never arrived, so the note was edited
    // again while still marked as never-confirmed.
    const neverConfirmed = local({ dirty: true, serverUpdatedAt: null });
    expect(decideMerge(neverConfirmed, NEW)).toBe('conflict');
  });
});

describe('outboxRetryDelayMs', () => {
  it('waits the base delay after the first failure', () => {
    expect(outboxRetryDelayMs(1)).toBe(OUTBOX_BASE_DELAY_MS);
  });

  it('backs off exponentially', () => {
    expect(outboxRetryDelayMs(2)).toBe(OUTBOX_BASE_DELAY_MS * 2);
    expect(outboxRetryDelayMs(3)).toBe(OUTBOX_BASE_DELAY_MS * 4);
  });

  it('never exceeds the cap, however many failures there have been', () => {
    expect(outboxRetryDelayMs(50)).toBe(OUTBOX_MAX_DELAY_MS);
    expect(outboxRetryDelayMs(5_000)).toBe(OUTBOX_MAX_DELAY_MS);
  });

  it('never returns a delay that would retry immediately', () => {
    for (let attempts = 1; attempts <= 20; attempts += 1) {
      expect(outboxRetryDelayMs(attempts)).toBeGreaterThanOrEqual(OUTBOX_BASE_DELAY_MS);
    }
  });
});
