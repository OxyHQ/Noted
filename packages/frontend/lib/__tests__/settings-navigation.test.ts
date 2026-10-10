import React from 'react';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotedSettingsProvider, useNotedSettings } from '@/components/settings/settings-provider';
import { SettingsRoute } from '@/components/settings/settings-route';
const { create, act } = createRequire(import.meta.url)('react-test-renderer');
const fake = vi.hoisted(() => ({
  modal: null as null | { page: string; initialView: string; onClose: () => void },
  replace: vi.fn(),
  mounts: 0,
}));
vi.mock('@/components/settings/settings-modal', () => ({
  default: (props: NonNullable<typeof fake.modal>) => {
    React.useEffect(() => {
      fake.mounts++;
      fake.modal = props;
      return () => {
        fake.modal = null;
      };
    }, [props]);
    return null;
  },
}));
const router = { replace: fake.replace };
vi.mock('expo-router', () => ({ useRouter: () => router }));
let controls: ReturnType<typeof useNotedSettings>;
let tree: { unmount: () => void } | undefined;
function Consumer() {
  controls = useNotedSettings();
  return null;
}
async function render(route?: React.ReactNode) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await act(async () => {
    tree = create(
      React.createElement(NotedSettingsProvider, null, React.createElement(Consumer), route),
    );
  });
}
afterEach(async () => {
  await act(async () => tree?.unmount());
  fake.modal = null;
  fake.mounts = 0;
  vi.clearAllMocks();
});

describe('settings lifecycle', () => {
  it('does not load a dialog at startup; opens navigation and closes in place', async () => {
    await render();
    expect(fake.modal).toBeNull();
    expect(fake.mounts).toBe(0);
    await act(async () => controls.open());
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(fake.modal).toMatchObject({ page: 'general', initialView: 'navigation' });
    await act(async () => fake.modal?.onClose());
    expect(fake.modal).toBeNull();
    expect(fake.replace).not.toHaveBeenCalled();
  });
  it('honors an explicit section, including a second request while open', async () => {
    await render();
    await act(async () => controls.open('transcription'));
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(fake.modal).toMatchObject({ page: 'transcription', initialView: 'page' });
    await act(async () => controls.open('storage'));
    expect(fake.modal).toMatchObject({ page: 'storage', initialView: 'page' });
  });
  it('unmounts the settings focus trap before opening an Oxy-owned surface', async () => {
    await render();
    await act(async () => controls.open('account'));
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    const action = vi.fn(() => expect(fake.modal).toBeNull());
    await act(async () => controls.afterClose(action));
    expect(action).toHaveBeenCalledOnce();
  });
  it('preserves deep links to a section without leaving an empty settings route', async () => {
    await render(React.createElement(SettingsRoute, { page: 'feedback' }));
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(fake.modal).toMatchObject({ page: 'feedback', initialView: 'page' });
    expect(fake.replace).toHaveBeenCalledWith('/(app)');
  });
});
