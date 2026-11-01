import React from 'react';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Invoke } from '@/lib/db/desktop-driver';
import { createDesktopModels, type DesktopModelInfo } from '@/lib/stt/desktop-models';

const { create, act } = createRequire(import.meta.url)('react-test-renderer');
const state = vi.hoisted(() => ({
  download: vi.fn(),
  states: vi.fn(),
  writeSetting: vi.fn(),
  models: {
    tiny: {
      id: 'tiny',
      bytes: 10,
      url: 'https://model.test/tiny',
      sha256: 'c848e1013f9f04a9d63fa43ce7fd4af035152c7c669a4a404b67107cee5f2e4e',
    },
    base: { id: 'base', bytes: 20, url: 'https://model.test/base', sha256: '' },
    small: { id: 'small', bytes: 30, url: 'https://model.test/small', sha256: '' },
  },
}));
vi.mock('react-native', () => ({
  View: 'View',
  Pressable: 'Pressable',
  ActivityIndicator: 'ActivityIndicator',
}));
vi.mock('lucide-react-native', () => ({ Check: 'Check', Download: 'Download', Trash2: 'Trash2' }));
vi.mock('@oxy.so/bloom/typography', () => ({ Text: 'Text' }));
vi.mock('@oxy.so/bloom/button', () => ({ Button: 'Button' }));
vi.mock('@oxy.so/bloom/switch', () => ({ Switch: 'Switch' }));
vi.mock('@oxy.so/bloom/settings-modal', () => ({
  SettingsCard: 'SettingsCard',
  SettingsRow: 'SettingsRow',
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({ colors: { primary: '#000', mutedForeground: '#777' } }),
}));
vi.mock('@/lib/capture/support', () => ({ hasDownloadableModels: () => false }));
vi.mock('@/lib/desktop/bridge', () => ({ isDesktop: () => true }));
vi.mock('@/lib/enhance/use-llm-model', () => ({ useLlmModel: vi.fn() }));
vi.mock('@/lib/db/client', () => ({ getActiveViewerId: () => 'alice' }));
vi.mock('@/lib/db/settings-repo', () => ({
  SETTING_KEYS: { sttModel: 'stt.model', sttLanguage: 'stt.language', liveNotes: 'stt.live' },
  readSetting: (_settings: unknown, _key: string, _valid: unknown, fallback: unknown) => fallback,
  useSettings: () => ({ settings: {} }),
  writeSetting: state.writeSetting,
}));
vi.mock('@/lib/stt/models', () => ({
  STT_MODELS: state.models,
  DEFAULT_STT_MODEL: 'base',
  getModelStates: state.states,
  downloadModel: state.download,
  deleteModel: vi.fn(),
}));
import { TranscriptionSection } from '@/components/settings/transcription-section';
import { useSttModels } from '@/lib/stt/use-models';

let root: ReturnType<typeof create> | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  state.writeSetting.mockResolvedValue(undefined);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});

type TestButton = {
  props: { onPress: () => void; disabled: boolean; accessibilityHint?: string };
  findAllByType: (type: string) => Array<{ props: { children?: unknown } }>;
};

function modelButton(): TestButton {
  const matches = root?.root.findAllByType('Pressable') ?? [];
  const button = matches.find((candidate: TestButton) =>
    candidate
      .findAllByType('Text')
      .some(
        (node: { props: { children?: unknown } }) =>
          node.props.children === 'transcription.models.tiny.name',
      ),
  );
  if (!button) throw new Error('model button not found');
  return button;
}

describe('model download failure UI', () => {
  it('offers retry when the partial size lookup fails before any fetch', async () => {
    const invoke: Invoke = async <T>(command: string) => {
      if (command === 'model_status') return null as T;
      if (command === 'model_partial') throw new Error('partial metadata unavailable');
      throw new Error(`unexpected command: ${command}`);
    };
    const fetchModel = vi.fn(async () => new Response());
    const desktop = createDesktopModels(async () => invoke, fetchModel);
    state.download.mockImplementation(
      (model: DesktopModelInfo, onProgress?: (fraction: number) => void) =>
        desktop.download(model, onProgress),
    );
    state.states.mockResolvedValue({ tiny: 'absent', base: 'absent', small: 'absent' });
    await act(async () => {
      root = create(React.createElement(TranscriptionSection));
    });
    await vi.waitFor(() => expect(state.states).toHaveBeenCalled());
    await act(async () => {
      modelButton().props.onPress();
      await vi.waitFor(() => expect(state.states).toHaveBeenCalledTimes(2));
    });
    expect(JSON.stringify(root?.toJSON())).toContain('transcription.downloadCouldNotFinish');
    expect(modelButton().props.disabled).toBe(false);
    expect(fetchModel).not.toHaveBeenCalled();
    expect(state.writeSetting).not.toHaveBeenCalled();
  });

  it.each(['partial', 'invalid'] as const)(
    'offers retry after %s range and preserves the partial',
    async (kind) => {
      let partial = Buffer.from([1, 2, 3, 4]);
      const whole = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      let ready = false;
      const requests: string[] = [];
      let count = 0;
      const invoke: Invoke = async <T>(command: string, args: Record<string, unknown> = {}) => {
        if (command === 'model_status')
          return (ready && args.name === 'ggml-tiny-q5_1.bin' ? 10 : null) as T;
        if (command === 'model_partial') return partial.length as T;
        if (command === 'model_write') {
          const bytes = Buffer.from(String(args.chunk), 'base64');
          partial = args.reset ? bytes : Buffer.concat([partial, bytes]);
        }
        if (command === 'model_commit') {
          if (
            partial.length !== 10 ||
            createHash('sha256').update(partial).digest('hex') !== args.sha256
          ) {
            partial = Buffer.alloc(0);
            throw new Error('sha256 mismatch');
          }
          ready = true;
        }
        return undefined as T;
      };
      const desktop = createDesktopModels(
        async () => invoke,
        async (_url, init) => {
          requests.push(String((init?.headers as Record<string, string> | undefined)?.Range));
          if (count++ === 0) {
            return kind === 'partial'
              ? new Response(new Uint8Array([5, 6, 7]), {
                  status: 206,
                  headers: { 'Content-Range': 'bytes 4-6/10' },
                })
              : new Response(new Uint8Array([1, 2, 3, 4, 5, 6]), {
                  status: 206,
                  headers: { 'Content-Range': 'bytes 0-5/10' },
                });
          }
          return kind === 'partial'
            ? new Response(new Uint8Array([8, 9, 10]), {
                status: 206,
                headers: { 'Content-Range': 'bytes 7-9/10' },
              })
            : new Response(new Uint8Array([5, 6, 7, 8, 9, 10]), {
                status: 206,
                headers: { 'Content-Range': 'bytes 4-9/10' },
              });
        },
      );
      state.download.mockImplementation(
        (model: DesktopModelInfo, onProgress?: (fraction: number) => void) =>
          desktop.download(model, onProgress),
      );
      state.states.mockImplementation(async () => ({
        tiny: ready ? 'ready' : 'absent',
        base: 'absent',
        small: 'absent',
      }));
      await act(async () => {
        root = create(React.createElement(TranscriptionSection));
      });
      await vi.waitFor(() => expect(state.states).toHaveBeenCalled());
      await act(async () => {
        modelButton().props.onPress();
        await vi.waitFor(() => expect(requests.length).toBe(1));
      });
      await vi.waitFor(() => expect(state.states).toHaveBeenCalledTimes(2));
      expect([...partial]).toEqual(kind === 'partial' ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4]);
      expect(state.writeSetting).not.toHaveBeenCalled();
      expect(JSON.stringify(root?.toJSON())).toContain('transcription.downloadCouldNotFinish');
      await act(async () => {
        modelButton().props.onPress();
        await vi.waitFor(() => expect(ready).toBe(true));
      });
      await vi.waitFor(() =>
        expect(state.writeSetting).toHaveBeenCalledWith('stt.model', 'tiny', 'alice'),
      );
      expect([...partial]).toEqual([...whole]);
      expect(requests).toEqual(
        kind === 'partial' ? ['bytes=4-', 'bytes=7-'] : ['bytes=4-', 'bytes=4-'],
      );
      expect(JSON.stringify(root?.toJSON())).not.toContain('transcription.downloadCouldNotFinish');
    },
  );
});

it('does not let a delayed status refresh hide a retry in progress', async () => {
  let releaseRefresh!: (value: Record<string, string>) => void;
  let finishRetry!: () => void;
  const absent = { tiny: 'absent', base: 'absent', small: 'absent' };
  state.states
    .mockResolvedValueOnce(absent)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseRefresh = resolve;
        }),
    )
    .mockResolvedValue({ ...absent, tiny: 'ready' });
  state.download.mockRejectedValueOnce(new Error('invalid Content-Range')).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishRetry = resolve;
      }),
  );
  await act(async () => {
    root = create(React.createElement(TranscriptionSection));
  });
  await vi.waitFor(() => expect(state.states).toHaveBeenCalledOnce());
  await act(async () => {
    modelButton().props.onPress();
  });
  await vi.waitFor(() =>
    expect(JSON.stringify(root?.toJSON())).toContain('transcription.downloadCouldNotFinish'),
  );
  expect(modelButton().props.disabled).toBe(false);
  await act(async () => {
    modelButton().props.onPress();
  });
  await vi.waitFor(() => expect(state.download).toHaveBeenCalledTimes(2));
  expect(modelButton().props.disabled).toBe(true);
  await act(async () => {
    releaseRefresh(absent);
  });
  expect(modelButton().props.disabled).toBe(true);
  await act(async () => {
    finishRetry();
  });
  await vi.waitFor(() =>
    expect(state.writeSetting).toHaveBeenCalledWith('stt.model', 'tiny', 'alice'),
  );
});

it('does not let an older refresh replace a completed retry with stale data', async () => {
  let releaseRefresh!: (value: Record<string, string>) => void;
  const absent = { tiny: 'absent', base: 'absent', small: 'absent' };
  state.states
    .mockResolvedValueOnce(absent)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseRefresh = resolve;
        }),
    )
    .mockResolvedValue({ ...absent, tiny: 'ready' });
  state.download
    .mockRejectedValueOnce(new Error('invalid Content-Range'))
    .mockResolvedValueOnce(undefined);
  await act(async () => {
    root = create(React.createElement(TranscriptionSection));
  });
  await vi.waitFor(() => expect(state.states).toHaveBeenCalledOnce());
  await act(async () => {
    modelButton().props.onPress();
  });
  await vi.waitFor(() =>
    expect(JSON.stringify(root?.toJSON())).toContain('transcription.downloadCouldNotFinish'),
  );
  await act(async () => {
    modelButton().props.onPress();
  });
  await vi.waitFor(() =>
    expect(state.writeSetting).toHaveBeenCalledWith('stt.model', 'tiny', 'alice'),
  );
  expect(modelButton().findAllByType('Download')).toHaveLength(0);
  await act(async () => {
    releaseRefresh(absent);
  });
  expect(modelButton().findAllByType('Download')).toHaveLength(0);
});

it('shows retry even if refreshing the model status fails', async () => {
  const absent = { tiny: 'absent', base: 'absent', small: 'absent' };
  state.states
    .mockResolvedValueOnce(absent)
    .mockRejectedValueOnce(new Error('status unavailable'))
    .mockResolvedValue({ ...absent, tiny: 'ready' });
  state.download
    .mockRejectedValueOnce(new Error('invalid Content-Range'))
    .mockResolvedValueOnce(undefined);
  await act(async () => {
    root = create(React.createElement(TranscriptionSection));
  });
  await vi.waitFor(() => expect(state.states).toHaveBeenCalledOnce());
  await act(async () => {
    modelButton().props.onPress();
  });
  await vi.waitFor(() =>
    expect(JSON.stringify(root?.toJSON())).toContain('transcription.downloadCouldNotFinish'),
  );
  expect(modelButton().props.disabled).toBe(false);
  expect(modelButton().props.accessibilityHint).toBe('common.retry');
  await act(async () => {
    modelButton().props.onPress();
  });
  await vi.waitFor(() =>
    expect(state.writeSetting).toHaveBeenCalledWith('stt.model', 'tiny', 'alice'),
  );
});

it('shows the failed action even if the file is already ready and clears it on retry', async () => {
  const absent = { tiny: 'absent', base: 'absent', small: 'absent' };
  state.states.mockResolvedValueOnce(absent).mockResolvedValue({ ...absent, tiny: 'ready' });
  state.download.mockRejectedValueOnce(new Error('bookkeeping failed after the file became ready'));
  await act(async () => {
    root = create(React.createElement(TranscriptionSection));
  });
  await vi.waitFor(() => expect(state.states).toHaveBeenCalledOnce());
  await act(async () => {
    modelButton().props.onPress();
  });
  await vi.waitFor(() =>
    expect(JSON.stringify(root?.toJSON())).toContain('transcription.downloadCouldNotFinish'),
  );
  await vi.waitFor(() => expect(state.states).toHaveBeenCalledTimes(2));
  expect(state.writeSetting).not.toHaveBeenCalled();
  await act(async () => {
    modelButton().props.onPress();
  });
  await vi.waitFor(() =>
    expect(state.writeSetting).toHaveBeenCalledWith('stt.model', 'tiny', 'alice'),
  );
  expect(state.download).toHaveBeenCalledOnce();
  expect(JSON.stringify(root?.toJSON())).not.toContain('transcription.downloadCouldNotFinish');
});

it('does not clear a newer failure when an older retained action succeeds late', async () => {
  let finishFirst!: () => void;
  const absent = { tiny: 'absent', base: 'absent', small: 'absent' };
  state.states
    .mockResolvedValueOnce(absent)
    .mockResolvedValueOnce(absent)
    .mockResolvedValue({ ...absent, tiny: 'ready' });
  state.download
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error('later attempt failed'));
  await act(async () => {
    root = create(React.createElement(TranscriptionSection));
  });
  await vi.waitFor(() => expect(state.states).toHaveBeenCalledOnce());
  const retained = modelButton().props.onPress;
  await act(async () => {
    retained();
    retained();
  });
  await vi.waitFor(() =>
    expect(JSON.stringify(root?.toJSON())).toContain('transcription.downloadCouldNotFinish'),
  );
  expect(state.download).toHaveBeenCalledTimes(2);
  await act(async () => {
    finishFirst();
  });
  await vi.waitFor(() => expect(state.states).toHaveBeenCalledTimes(3));
  expect(state.writeSetting).not.toHaveBeenCalled();
  expect(JSON.stringify(root?.toJSON())).toContain('transcription.downloadCouldNotFinish');
});

it('keeps a newer failure when an older ready-file selection finishes late', async () => {
  let finishSelection!: () => void;
  const absent = { tiny: 'absent', base: 'absent', small: 'absent' };
  state.states
    .mockResolvedValueOnce(absent)
    .mockResolvedValueOnce({ ...absent, tiny: 'ready' })
    .mockResolvedValue(absent);
  state.download
    .mockRejectedValueOnce(new Error('bookkeeping failed after file became ready'))
    .mockRejectedValueOnce(new Error('new download failed'));
  state.writeSetting.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishSelection = resolve;
      }),
  );
  await act(async () => {
    root = create(React.createElement(TranscriptionSection));
  });
  await vi.waitFor(() => expect(state.states).toHaveBeenCalledOnce());
  await act(async () => {
    modelButton().props.onPress();
  });
  await vi.waitFor(() => expect(state.states).toHaveBeenCalledTimes(2));
  expect(JSON.stringify(root?.toJSON())).toContain('transcription.downloadCouldNotFinish');
  await act(async () => {
    modelButton().props.onPress();
  });
  await vi.waitFor(() => expect(state.writeSetting).toHaveBeenCalledOnce());
  await act(async () => {
    root?.root.findByProps({ accessibilityLabel: 'transcription.remove' }).props.onPress();
  });
  await vi.waitFor(() => expect(state.states).toHaveBeenCalledTimes(3));
  await act(async () => {
    modelButton().props.onPress();
  });
  await vi.waitFor(() => expect(state.download).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(state.states).toHaveBeenCalledTimes(4));
  expect(JSON.stringify(root?.toJSON())).toContain('transcription.downloadCouldNotFinish');
  await act(async () => {
    finishSelection();
  });
  expect(JSON.stringify(root?.toJSON())).toContain('transcription.downloadCouldNotFinish');
});

it('offers retry when the download succeeds but its status cannot be confirmed', async () => {
  const absent = { tiny: 'absent', base: 'absent', small: 'absent' };
  state.states
    .mockResolvedValueOnce(absent)
    .mockRejectedValueOnce(new Error('status unavailable'))
    .mockResolvedValue({ ...absent, tiny: 'ready' });
  state.download.mockResolvedValue(undefined);
  await act(async () => {
    root = create(React.createElement(TranscriptionSection));
  });
  await vi.waitFor(() => expect(state.states).toHaveBeenCalledOnce());
  await act(async () => {
    modelButton().props.onPress();
  });
  await vi.waitFor(() => expect(state.states).toHaveBeenCalledTimes(2));
  expect(JSON.stringify(root?.toJSON())).toContain('transcription.downloadCouldNotFinish');
  expect(state.writeSetting).not.toHaveBeenCalled();
  expect(modelButton().props.disabled).toBe(false);
  await act(async () => {
    modelButton().props.onPress();
  });
  await vi.waitFor(() =>
    expect(state.writeSetting).toHaveBeenCalledWith('stt.model', 'tiny', 'alice'),
  );
});

it('requires ready status after a successful download before selecting', async () => {
  const absent = { tiny: 'absent', base: 'absent', small: 'absent' };
  state.states
    .mockResolvedValueOnce(absent)
    .mockResolvedValueOnce(absent)
    .mockResolvedValue({ ...absent, tiny: 'ready' });
  state.download.mockResolvedValue(undefined);
  await act(async () => {
    root = create(React.createElement(TranscriptionSection));
  });
  await vi.waitFor(() => expect(state.states).toHaveBeenCalledOnce());
  await act(async () => {
    modelButton().props.onPress();
  });
  await vi.waitFor(() =>
    expect(JSON.stringify(root?.toJSON())).toContain('transcription.downloadCouldNotFinish'),
  );
  expect(state.writeSetting).not.toHaveBeenCalled();
  expect(modelButton().props.disabled).toBe(false);
  await act(async () => {
    modelButton().props.onPress();
  });
  await vi.waitFor(() =>
    expect(state.writeSetting).toHaveBeenCalledWith('stt.model', 'tiny', 'alice'),
  );
});

it('preserves the original download error if the subsequent refresh also fails', async () => {
  const original = new Error('download failed');
  const absent = { tiny: 'absent', base: 'absent', small: 'absent' };
  state.states.mockResolvedValueOnce(absent).mockRejectedValueOnce(new Error('status unavailable'));
  state.download.mockRejectedValueOnce(original);
  let hook: ReturnType<typeof useSttModels> | undefined;
  function HookHarness() {
    hook = useSttModels();
    return null;
  }
  await act(async () => {
    root = create(React.createElement(HookHarness));
  });
  await vi.waitFor(() => expect(state.states).toHaveBeenCalledOnce());
  let result: unknown;
  await act(async () => {
    result = await hook?.download('tiny').catch((error: unknown) => error);
  });
  expect(result).toBe(original);
});

it('does not select using a successful refresh superseded by a newer refresh', async () => {
  let releaseOlder!: (value: Record<string, string>) => void;
  const absent = { tiny: 'absent', base: 'absent', small: 'absent' };
  const ready = { ...absent, tiny: 'ready' };
  state.states
    .mockResolvedValueOnce(absent)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseOlder = resolve;
        }),
    )
    .mockResolvedValue(ready);
  state.download.mockResolvedValue(undefined);
  await act(async () => {
    root = create(React.createElement(TranscriptionSection));
  });
  await vi.waitFor(() => expect(state.states).toHaveBeenCalledOnce());
  const retained = modelButton().props.onPress;
  await act(async () => {
    retained();
  });
  await vi.waitFor(() => expect(state.states).toHaveBeenCalledTimes(2));
  await act(async () => {
    retained();
  });
  await vi.waitFor(() => expect(state.writeSetting).toHaveBeenCalledTimes(1));
  await act(async () => {
    releaseOlder(ready);
  });
  expect(state.writeSetting).toHaveBeenCalledTimes(1);
});

it('does not select using an older download after a newer attempt completes', async () => {
  let finishOlder!: () => void;
  const absent = { tiny: 'absent', base: 'absent', small: 'absent' };
  state.states.mockResolvedValueOnce(absent).mockResolvedValue({ ...absent, tiny: 'ready' });
  state.download
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishOlder = resolve;
        }),
    )
    .mockResolvedValueOnce(undefined);
  await act(async () => {
    root = create(React.createElement(TranscriptionSection));
  });
  await vi.waitFor(() => expect(state.states).toHaveBeenCalledOnce());
  const retained = modelButton().props.onPress;
  await act(async () => {
    retained();
    retained();
  });
  await vi.waitFor(() => expect(state.writeSetting).toHaveBeenCalledTimes(1));
  await act(async () => {
    finishOlder();
  });
  await vi.waitFor(() => expect(state.states).toHaveBeenCalledTimes(3));
  expect(state.writeSetting).toHaveBeenCalledTimes(1);
});
