import React from 'react';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defined } from '@/lib/__tests__/defined';

const { create, act } = createRequire(import.meta.url)('react-test-renderer');
const state = vi.hoisted(() => ({ remove: vi.fn(), toast: vi.fn() }));
vi.mock('react-native', () => ({ Pressable: 'Pressable', View: 'View' }));
vi.mock('lucide-react-native', () => ({ Trash2: 'Trash2' }));
vi.mock('@/components/ui/text', () => ({ Text: 'Text' }));
vi.mock('@oxy.so/bloom/toast', () => ({ toast: { error: state.toast } }));
vi.mock('@noted/shared-types', () => ({ CAPTURE_PROFILES: [] }));
vi.mock('@/lib/capture/captures-repo', () => ({
  useNoteCaptures: () => ({ data: [{ id: 'capture', audioPath: 'audio:capture' }] }),
  useCaptureTranscript: () => ({ data: [] }),
  deleteRecordingAudio: state.remove,
  deleteRecordingTranscript: vi.fn(),
}));
vi.mock('@/lib/capture/retry', () => ({ regenerateWithProfile: vi.fn() }));
vi.mock('@/lib/capture/retention', () => ({
  hasRemovableParts: () => true,
  retentionParts: () => [{ kind: 'audio', present: true, costKey: 'cost', keepsKey: 'keeps' }],
}));
vi.mock('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({ colors: { foreground: '#000' } }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { RecordingControls } from '@/components/capture/recording-controls';

let root:
  | {
      root: {
        findByProps(props: Record<string, unknown>): {
          props: { onPress(): void; disabled: boolean };
        };
      };
      unmount(): void;
    }
  | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  vi.clearAllMocks();
});
describe('recording controls', () => {
  it('shows a deletion error and re-enables the action', async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    let reject!: (error: Error) => void;
    state.remove.mockReturnValue(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    await act(async () => {
      root = create(React.createElement(RecordingControls, { noteId: 'note' }));
    });
    const button = defined(root, 'rendered controls').root.findByProps({
      accessibilityLabel: 'capture.retention.audio',
    });
    await act(async () => {
      button.props.onPress();
    });
    expect(button.props.disabled).toBe(true);
    await act(async () => {
      reject(new Error('storage unavailable'));
      await Promise.resolve();
    });
    expect(state.toast).toHaveBeenCalledWith('capture.retention.removeFailed');
    expect(button.props.disabled).toBe(false);
  });

  it('finishes a successful deletion without an error', async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    state.remove.mockResolvedValueOnce(undefined);
    await act(async () => {
      root = create(React.createElement(RecordingControls, { noteId: 'note' }));
    });
    const button = defined(root, 'rendered controls').root.findByProps({
      accessibilityLabel: 'capture.retention.audio',
    });
    await act(async () => {
      button.props.onPress();
      await Promise.resolve();
    });
    expect(state.toast).not.toHaveBeenCalled();
    expect(button.props.disabled).toBe(false);
  });
});
