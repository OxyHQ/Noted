import React from 'react';
import { createRequire } from 'node:module';
import { OxyServices } from '@oxy.so/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotedClient } from '@/lib/api/noted-client';

const { create, act } = createRequire(import.meta.url)('react-test-renderer');
const fixture = vi.hoisted(() => ({
  viewer: 'A',
  oxy: null as unknown as OxyServices,
  auth: {
    isAuthenticated: true,
    user: { id: 'A' },
    activeSessionId: 'session-A',
    oxyServices: null as unknown as OxyServices,
  },
  api: null as unknown as ReturnType<typeof import('@/lib/api/noted-client').createNotedClient>,
  execute: vi.fn(),
  saveText: vi.fn(),
  saveBinary: vi.fn(),
  archive: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => fixture.auth }));
vi.mock('@/lib/oxy', () => ({
  get oxyServices() {
    return fixture.oxy;
  },
}));
vi.mock('@/lib/api/client', () => ({
  default: { get: (...args: Parameters<typeof fixture.api.get>) => fixture.api.get(...args) },
}));
vi.mock('@/lib/db/client', () => ({
  getActiveViewerId: () => fixture.viewer,
  execute: (...args: unknown[]) => fixture.execute(...args),
}));
vi.mock('@/lib/db/notes-repo', () => ({
  noteListQuery: ({ view }: { view: string }) => ({ sql: view, params: [] }),
  rowsToNotes: (rows: unknown[]) => rows,
}));
vi.mock('@/lib/export/archive', () => ({
  notesToArchive: (...args: unknown[]) => fixture.archive(...args),
}));
vi.mock('@/lib/export/save', () => ({
  saveTextFile: (...args: unknown[]) => fixture.saveText(...args),
  saveBinaryFile: (...args: unknown[]) => fixture.saveBinary(...args),
}));
vi.mock('@oxy.so/bloom/toast', () => ({
  toast: { error: (...args: unknown[]) => fixture.toast(...args) },
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { useExportAll } from '@/lib/hooks/use-export-all';
import { useExportMarkdownZip } from '@/lib/hooks/use-export-markdown-zip';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (userId: string, nonce = 'first') =>
  `h.${encode({ userId, sessionId: `session-${userId}`, exp: 4102444800, nonce })}.s`;
const originalFetch = globalThis.fetch;
let oxy: OxyServices;
let root: ReturnType<typeof create> | undefined;
let jsonExport: () => Promise<void>;
let zipExport: () => Promise<void>;
function Harness() {
  jsonExport = useExportAll().exportAll;
  zipExport = useExportMarkdownZip().exportZip;
  return null;
}
function switchAccount(viewer: string) {
  oxy.session.setAccessToken(jwt(viewer));
  fixture.viewer = viewer;
  fixture.auth = {
    isAuthenticated: true,
    user: { id: viewer },
    activeSessionId: `session-${viewer}`,
    oxyServices: oxy,
  };
  root?.update(React.createElement(Harness));
}
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.viewer = 'A';
  oxy = new OxyServices({ baseURL: 'https://noted.example' });
  oxy.session.setAccessToken(jwt('A'));
  fixture.oxy = oxy;
  fixture.auth = {
    isAuthenticated: true,
    user: { id: 'A' },
    activeSessionId: 'session-A',
    oxyServices: oxy,
  };
  fixture.api = createNotedClient(oxy, 'https://noted.example');
  fixture.execute
    .mockReset()
    .mockImplementation(async (sql: string, _params: unknown, viewer: string) => [{ sql, viewer }]);
  fixture.saveText.mockReset().mockResolvedValue(undefined);
  fixture.saveBinary.mockReset().mockResolvedValue(undefined);
  fixture.archive
    .mockReset()
    .mockImplementation((notes: unknown) => new TextEncoder().encode(JSON.stringify(notes)));
  fixture.toast.mockReset();
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  fixture.api.dispose();
  oxy.dispose();
  globalThis.fetch = originalFetch;
});

describe('export ownership', () => {
  it('does not let a retained A JSON export callback issue a request as B', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ owner: 'B' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    globalThis.fetch = fetchSpy as typeof fetch;
    await act(async () => {
      root = create(React.createElement(Harness));
    });
    const old = jsonExport;
    await act(async () => switchAccount('B'));
    await act(async () => {
      await old();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fixture.saveText).not.toHaveBeenCalled();
  });
  it('does not let a retained A Markdown export callback read and save B notes', async () => {
    await act(async () => {
      root = create(React.createElement(Harness));
    });
    const old = zipExport;
    await act(async () => switchAccount('B'));
    await act(async () => {
      await old();
    });
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fixture.saveBinary).not.toHaveBeenCalled();
  });
  it('does not save a late A Markdown read after switching to B', async () => {
    let finish!: (rows: unknown[]) => void;
    fixture.execute.mockImplementationOnce(async () => [{ viewer: 'A', sql: 'active' }]);
    fixture.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      root = create(React.createElement(Harness));
    });
    let pending!: Promise<void>;
    await act(async () => {
      pending = zipExport();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fixture.execute).toHaveBeenCalledTimes(2);
    await act(async () => switchAccount('B'));
    await act(async () => {
      finish([{ viewer: 'A', sql: 'archived' }]);
      await pending;
    });
    expect(fixture.saveBinary).not.toHaveBeenCalled();
  });
  it('does not save a late A Markdown read after A to B to A', async () => {
    let finish!: (rows: unknown[]) => void;
    fixture.execute.mockImplementationOnce(async () => [{ viewer: 'A', sql: 'active' }]);
    fixture.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      root = create(React.createElement(Harness));
    });
    let pending!: Promise<void>;
    await act(async () => {
      pending = zipExport();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fixture.execute).toHaveBeenCalledTimes(2);
    await act(async () => switchAccount('B'));
    await act(async () => switchAccount('A'));
    await act(async () => {
      finish([{ viewer: 'A', sql: 'archived' }]);
      await pending;
    });
    expect(fixture.saveBinary).not.toHaveBeenCalled();
  });
});
