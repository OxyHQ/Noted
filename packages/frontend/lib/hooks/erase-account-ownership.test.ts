import React from 'react';
import { createRequire } from 'node:module';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OxyServices } from '@oxy.so/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { create, act } = createRequire(import.meta.url)('react-test-renderer');
const fixture = vi.hoisted(() => ({
  viewer: 'A',
  auth: {
    isAuthenticated: true,
    user: { id: 'A' },
    activeSessionId: 'session-A',
    oxyServices: null as unknown as OxyServices,
  },
  oxy: null as unknown as OxyServices,
  post: vi.fn(),
  erase: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  reset: vi.fn(),
}));
vi.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => fixture.auth }));
vi.mock('../oxy', () => ({
  get oxyServices() {
    return fixture.oxy;
  },
}));
vi.mock('../api/client', () => ({ default: { post: fixture.post } }));
vi.mock('../db/client', () => ({ getActiveViewerId: () => fixture.viewer }));
vi.mock('../db/erase-local', () => ({ eraseLocalAccountData: fixture.erase }));
vi.mock('@oxy.so/bloom/toast', () => ({
  toast: { success: fixture.success, error: fixture.error },
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../stores/notes-ui-store', () => ({
  useNotesUIStore: {
    getState: () => ({
      setActiveLabel: fixture.reset,
      setActiveFolder: fixture.reset,
      setSearchQuery: fixture.reset,
      clearSelection: fixture.reset,
    }),
  },
}));

import { useEraseAccountData } from './use-erase-account-data';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (id: string) =>
  `h.${encode({ userId: id, sessionId: `session-${id}`, exp: 4102444800 })}.s`;
let oxy: OxyServices;
let client: QueryClient;
let root: { update(element: React.ReactNode): void; unmount(): void } | undefined;
let invoke: () => Promise<void>;
let fire: () => void;
let shown = true;
function Harness() {
  const mutation = useEraseAccountData();
  invoke = mutation.mutateAsync;
  fire = mutation.mutate;
  return null;
}
function App() {
  return React.createElement(
    QueryClientProvider,
    { client },
    shown ? React.createElement(Harness) : null,
  );
}
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  oxy = new OxyServices({ baseURL: 'https://noted.example' });
  oxy.session.setAccessToken(jwt('A'));
  fixture.oxy = oxy;
  fixture.viewer = 'A';
  fixture.auth = {
    isAuthenticated: true,
    user: { id: 'A' },
    activeSessionId: 'session-A',
    oxyServices: oxy,
  };
  fixture.post.mockResolvedValue({});
  fixture.erase.mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  shown = true;
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  oxy.dispose();
  client.clear();
});
async function mount() {
  await act(async () => {
    root = create(React.createElement(App));
  });
}
async function switchToB() {
  await act(async () => {
    oxy.session.setAccessToken(jwt('B'));
    fixture.viewer = 'B';
    fixture.auth.user = { id: 'B' };
    fixture.auth.activeSessionId = 'session-B';
    root?.update(React.createElement(App));
  });
}
describe('erase account ownership', () => {
  it('rejects a confirmation retained from A after switching to B', async () => {
    await mount();
    const confirmA = invoke;
    await switchToB();
    await act(async () => {
      await expect(confirmA()).rejects.toThrow();
    });
    expect(fixture.post).not.toHaveBeenCalled();
    expect(fixture.erase).not.toHaveBeenCalled();
  });
  it('does not send when the retained UI confirmation is pressed after the switch', async () => {
    await mount();
    const confirmA = fire;
    await switchToB();
    await act(async () => {
      confirmA();
      await Promise.resolve();
    });
    expect(fixture.post).not.toHaveBeenCalled();
    expect(fixture.error).not.toHaveBeenCalled();
  });
  it('rejects a retained confirmation after the settings screen unmounts', async () => {
    await mount();
    const confirmA = invoke;
    await act(async () => {
      shown = false;
      root?.update(React.createElement(App));
    });
    await act(async () => {
      await expect(confirmA()).rejects.toThrow();
    });
    expect(fixture.post).not.toHaveBeenCalled();
  });
  it('rejects an old A confirmation after A to B to A', async () => {
    await mount();
    const confirmA = invoke;
    await switchToB();
    await act(async () => {
      oxy.session.setAccessToken(jwt('A'));
      fixture.viewer = 'A';
      fixture.auth.user = { id: 'A' };
      fixture.auth.activeSessionId = 'session-A';
      root?.update(React.createElement(App));
    });
    await act(async () => {
      await expect(confirmA()).rejects.toThrow();
    });
    expect(fixture.post).not.toHaveBeenCalled();
  });
  it('rejects an old confirmation when B is projected before the bearer changes', async () => {
    await mount();
    const confirmA = invoke;
    await act(async () => {
      fixture.auth.user = { id: 'B' };
      fixture.auth.activeSessionId = 'session-B';
      root?.update(React.createElement(App));
    });
    await act(async () => {
      await expect(confirmA()).rejects.toThrow();
    });
    expect(fixture.post).not.toHaveBeenCalled();
  });
  it('erases the current viewer and clears the current UI on success', async () => {
    await mount();
    await act(async () => {
      await invoke();
    });
    expect(fixture.post).toHaveBeenCalledWith(
      expect.any(String),
      { confirm: 'DELETE' },
      { expectedViewerId: 'A' },
    );
    expect(fixture.erase).toHaveBeenCalledWith('A');
    expect(fixture.reset).toHaveBeenCalled();
    expect(fixture.success).toHaveBeenCalled();
  });
  it('does not reset B UI when A response arrives after a switch', async () => {
    let resolve!: () => void;
    fixture.post.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    await mount();
    let pending!: Promise<void>;
    await act(async () => {
      pending = invoke();
      await Promise.resolve();
    });
    await switchToB();
    await act(async () => {
      resolve();
      await pending;
    });
    expect(fixture.erase).toHaveBeenCalledWith('A');
    expect(fixture.reset).not.toHaveBeenCalled();
    expect(fixture.success).not.toHaveBeenCalled();
  });
});
