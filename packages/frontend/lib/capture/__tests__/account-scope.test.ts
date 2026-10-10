import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  viewer: 'account-a' as string | null,
  writes: [] as { viewer: string; sql: string }[],
  transcribe: vi.fn(),
  deleteAudio: vi.fn(),
}));

vi.mock('@/lib/db/client', () => {
  function check(expected?: string | null) {
    if (expected !== undefined && (!expected || expected !== state.viewer)) {
      throw new Error('The active account changed before this write could be saved');
    }
  }
  return {
    getActiveViewerId: () => state.viewer,
    executeTransaction: async (statements: { sql: string }[], expected?: string | null) => {
      check(expected);
      for (const { sql } of statements) state.writes.push({ viewer: state.viewer!, sql });
      return statements.map(() => 1);
    },
    execute: async (_sql: string, _params: unknown[], expected?: string | null) => {
      check(expected);
      return [
        {
          id: 'capture-a',
          note_id: 'note-a',
          state: 'recording',
          capture_status: 'recording',
          transcription_status: 'live',
          generation_status: 'live',
          enhancement_status: 'pending',
          profile: 'auto',
          transcript_revision: 0,
          started_at: '2026-10-10',
          duration_ms: 10,
          audio_path: 'capture-a.wav',
          error_code: null,
        },
      ];
    },
  };
});
vi.mock('@/lib/db/live-query', () => ({ useLiveQuery: vi.fn() }));
vi.mock('@/lib/db/settings-repo', () => ({ loadSetting: async () => 'en', SETTING_KEYS: {} }));
vi.mock('@/lib/audio/store', () => ({ deleteCaptureAudio: state.deleteAudio }));
vi.mock('@/lib/stt/engine', () => ({
  getSttEngine: () => ({ isSupported: () => true, transcribe: state.transcribe }),
}));
vi.mock('@/lib/stt/models', () => ({ DEFAULT_STT_MODEL: 'tiny' }));
vi.mock('@/lib/capture/restructure', () => ({
  restructureNote: vi.fn(),
  finalizeNote: vi.fn(),
  enhanceNote: vi.fn(),
}));

import { createLiveCoordinator } from '@/lib/capture/live-coordinator';
import { deleteRecordingAudio, getCapture, makeSegment } from '@/lib/capture/captures-repo';
import { transcribeAfterStop } from '@/lib/capture/transcribe-after';

beforeEach(() => {
  state.viewer = 'account-a';
  state.writes = [];
  state.transcribe.mockReset();
  state.deleteAudio.mockReset();
});

describe('capture account ownership', () => {
  it('does not save recorder cleanup into the account that replaced its owner', async () => {
    const coordinator = createLiveCoordinator({
      captureId: 'capture-a',
      noteId: 'note-a',
      startedAt: new Date(),
      language: 'en',
    });
    await coordinator.markRecording();
    expect(state.writes.length).toBeGreaterThan(0);
    state.writes = [];
    state.viewer = 'account-b';
    await expect(coordinator.markStopped(5000, 'capture-a.wav')).rejects.toThrow(
      'active account changed',
    );
    await expect(coordinator.markFailed('persist_audio')).rejects.toThrow('active account changed');
    expect(state.writes).toEqual([]);
  });

  it('drops transcription that finishes after an account switch, including its failure update', async () => {
    let finish!: (segments: ReturnType<typeof makeSegment>[]) => void;
    state.transcribe.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = transcribeAfterStop({
      captureId: 'capture-a',
      noteId: 'note-a',
      startedAt: new Date(),
      audioPath: 'capture-a.wav',
    });
    await vi.waitFor(() => expect(state.transcribe).toHaveBeenCalledOnce());
    state.writes = [];
    state.viewer = 'account-b';
    finish([
      makeSegment({
        captureId: 'capture-a',
        sliceIndex: 0,
        segmentIndex: 0,
        startMs: 0,
        endMs: 100,
        text: 'Private words',
      }),
    ]);
    await pending;
    expect(state.writes).toEqual([]);
  });

  it('never updates the new account after delayed audio deletion', async () => {
    const capture = await getCapture('capture-a');
    let finish!: () => void;
    state.deleteAudio.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = deleteRecordingAudio(capture!);
    state.viewer = 'account-b';
    finish();
    await expect(pending).rejects.toThrow('active account changed');
    expect(state.deleteAudio).toHaveBeenCalledWith('capture-a.wav', 'capture-a');
    expect(state.writes).toEqual([]);
  });
});
