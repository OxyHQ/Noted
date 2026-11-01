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
  available: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
  share: vi.fn(),
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
vi.mock('expo-file-system', () => ({
  Paths: { cache: 'cache' },
  Directory: class {
    create() {}
  },
  File: class {
    uri = 'file:///synthetic-export';
    exists = false;
    create() {}
    delete() {
      fixture.remove();
    }
    write(value: unknown) {
      return fixture.write(value);
    }
  },
}));
vi.mock('expo-sharing', () => ({
  isAvailableAsync: () => fixture.available(),
  shareAsync: (...args: unknown[]) => fixture.share(...args),
}));
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
let jsonBusy: boolean;
let zipBusy: boolean;
function Harness() {
  const json = useExportAll();
  const zip = useExportMarkdownZip();
  jsonExport = json.exportAll;
  jsonBusy = json.exporting;
  zipExport = zip.exportZip;
  zipBusy = zip.exportingZip;
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
  fixture.available.mockReset().mockResolvedValue(true);
  fixture.write.mockReset();
  fixture.remove.mockReset();
  fixture.share.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  fixture.api.dispose();
  oxy.dispose();
  globalThis.fetch = originalFetch;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('export ownership', () => {
  it.each(['json', 'zip'] as const)('exports normally for the current owner (%s)', async (kind) => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ owner: 'A' }), { status: 200 }),
    ) as typeof fetch;
    await act(async () => {
      root = create(React.createElement(Harness));
    });
    await act(async () => {
      await (kind === 'json' ? jsonExport() : zipExport());
    });
    expect(kind === 'json' ? fixture.saveText : fixture.saveBinary).toHaveBeenCalledOnce();
    expect(fixture.toast).not.toHaveBeenCalled();
  });

  it('does not let an unfinished A request block B or clear B busy state', async () => {
    let releaseA!: (response: Response) => void;
    let releaseB!: (response: Response) => void;
    let startedA!: () => void;
    let startedB!: () => void;
    const waitA = new Promise<void>((resolve) => {
      startedA = resolve;
    });
    const waitB = new Promise<void>((resolve) => {
      startedB = resolve;
    });
    globalThis.fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('authorization');
      if (auth === `Bearer ${jwt('A')}`) {
        startedA();
        return new Promise<Response>((resolve) => {
          releaseA = resolve;
        });
      }
      if (auth === `Bearer ${jwt('B')}`) {
        startedB();
        return new Promise<Response>((resolve) => {
          releaseB = resolve;
        });
      }
      throw new Error('unexpected bearer');
    }) as typeof fetch;
    await act(async () => {
      root = create(React.createElement(Harness));
    });
    let a!: Promise<void>;
    await act(async () => {
      a = jsonExport();
      await waitA;
    });
    expect(jsonBusy).toBe(true);
    await act(async () => switchAccount('B'));
    expect(jsonBusy).toBe(false);
    let b!: Promise<void>;
    await act(async () => {
      b = jsonExport();
      await waitB;
    });
    expect(jsonBusy).toBe(true);
    await act(async () => {
      releaseA(new Response('{}', { status: 200 }));
      await a;
    });
    expect(jsonBusy).toBe(true);
    expect(fixture.toast).not.toHaveBeenCalled();
    await act(async () => {
      releaseB(new Response('{}', { status: 200 }));
      await b;
    });
    expect(jsonBusy).toBe(false);
    expect(fixture.saveText).toHaveBeenCalledOnce();
  });

  it('drops a pending export after leaving the settings section', async () => {
    let release!: (rows: unknown[]) => void;
    fixture.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await act(async () => {
      root = create(React.createElement(Harness));
    });
    let pending!: Promise<void>;
    await act(async () => {
      pending = zipExport();
      await Promise.resolve();
    });
    expect(zipBusy).toBe(true);
    await act(async () => {
      root?.unmount();
      root = undefined;
    });
    await act(async () => {
      release([{ viewer: 'A' }]);
      await pending;
    });
    expect(fixture.execute).toHaveBeenCalledOnce();
    expect(fixture.saveBinary).not.toHaveBeenCalled();
  });

  it('continues through a same-session token refresh', async () => {
    let finish!: (rows: unknown[]) => void;
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
    });
    const epoch = oxy.http.getSessionEpoch();
    await act(async () => {
      oxy.session.setAccessToken(jwt('A', 'fresh'));
    });
    expect(oxy.http.getSessionEpoch()).toBe(epoch);
    await act(async () => {
      finish([{ viewer: 'A' }]);
      await pending;
    });
    expect(fixture.saveBinary).toHaveBeenCalledOnce();
  });

  it('does not start when the authenticated projection is unavailable', async () => {
    fixture.auth.isAuthenticated = false;
    await act(async () => {
      root = create(React.createElement(Harness));
    });
    await act(async () => {
      await jsonExport();
      await zipExport();
    });
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fixture.saveText).not.toHaveBeenCalled();
    expect(fixture.saveBinary).not.toHaveBeenCalled();
  });

  it('reports a network export unavailable when a cached session has no bearer', async () => {
    oxy.session.clear();
    const fetchSpy = vi.fn() as typeof fetch;
    globalThis.fetch = fetchSpy;
    await act(async () => {
      root = create(React.createElement(Harness));
    });
    await act(async () => {
      await jsonExport();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fixture.toast).toHaveBeenCalledWith('settings.export.failed');
  });

  it('rejects a different or opaque bearer even when the local projection says A', async () => {
    for (const token of [jwt('B'), 'opaque-token']) {
      oxy.session.setAccessToken(token);
      await act(async () => {
        root = create(React.createElement(Harness));
      });
      await act(async () => {
        await zipExport();
      });
      expect(fixture.execute).not.toHaveBeenCalled();
      expect(fixture.saveBinary).not.toHaveBeenCalled();
      await act(async () => {
        root?.unmount();
        root = undefined;
      });
    }
  });

  it('does not use tokenless local fallback without a projected session id', async () => {
    oxy.session.clear();
    fixture.auth.activeSessionId = '';
    await act(async () => {
      root = create(React.createElement(Harness));
    });
    await act(async () => {
      await zipExport();
    });
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fixture.saveBinary).not.toHaveBeenCalled();
  });

  it('drops a tokenless local export after committed A to B to A projections', async () => {
    oxy.session.clear();
    let finish!: (rows: unknown[]) => void;
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
    });
    expect(fixture.execute).toHaveBeenCalledOnce();
    const epoch = oxy.http.getSessionEpoch();
    await act(async () => {
      fixture.viewer = 'B';
      fixture.auth = {
        isAuthenticated: true,
        user: { id: 'B' },
        activeSessionId: 'session-B',
        oxyServices: oxy,
      };
      root?.update(React.createElement(Harness));
    });
    expect(zipBusy).toBe(false);
    await act(async () => {
      fixture.viewer = 'A';
      fixture.auth = {
        isAuthenticated: true,
        user: { id: 'A' },
        activeSessionId: 'session-A',
        oxyServices: oxy,
      };
      root?.update(React.createElement(Harness));
    });
    expect(oxy.http.getSessionEpoch()).toBe(epoch);
    await act(async () => {
      finish([{ viewer: 'A' }]);
      await pending;
    });
    expect(fixture.saveBinary).not.toHaveBeenCalled();
  });

  it('does not start native writing after A to B to A during availability', async () => {
    const native = await import('@/lib/export/save.native');
    fixture.saveBinary.mockImplementation(native.saveBinaryFile);
    let release!: (value: boolean) => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    fixture.available.mockImplementation(() => {
      started();
      return new Promise<boolean>((resolve) => {
        release = resolve;
      });
    });
    await act(async () => {
      root = create(React.createElement(Harness));
    });
    let pending!: Promise<void>;
    await act(async () => {
      pending = zipExport();
      await waiting;
    });
    await act(async () => switchAccount('B'));
    await act(async () => switchAccount('A'));
    await act(async () => {
      release(true);
      await pending;
    });
    expect(fixture.write).not.toHaveBeenCalled();
    expect(fixture.share).not.toHaveBeenCalled();
  });

  it('does not open native sharing after a session change during the write', async () => {
    const native = await import('@/lib/export/save.native');
    fixture.saveBinary.mockImplementation(native.saveBinaryFile);
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    fixture.write.mockImplementation(() => {
      started();
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await act(async () => {
      root = create(React.createElement(Harness));
    });
    let pending!: Promise<void>;
    await act(async () => {
      pending = zipExport();
      await waiting;
    });
    await act(async () => switchAccount('B'));
    await act(async () => {
      release();
      await pending;
    });
    expect(fixture.write).toHaveBeenCalledOnce();
    expect(fixture.share).not.toHaveBeenCalled();
    expect(fixture.remove).not.toHaveBeenCalled();
    expect(fixture.toast).not.toHaveBeenCalled();
  });

  it('cannot retract native sharing once it has started', async () => {
    const native = await import('@/lib/export/save.native');
    fixture.saveBinary.mockImplementation(native.saveBinaryFile);
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    fixture.share.mockImplementation(() => {
      started();
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await act(async () => {
      root = create(React.createElement(Harness));
    });
    let pending!: Promise<void>;
    await act(async () => {
      pending = zipExport();
      await waiting;
    });
    await act(async () => switchAccount('B'));
    await act(async () => {
      release();
      await pending;
    });
    expect(fixture.share).toHaveBeenCalledOnce();
    expect(fixture.remove).not.toHaveBeenCalled();
    expect(fixture.toast).not.toHaveBeenCalled();
  });

  it('does not click a web download after ownership changes while creating its link', async () => {
    const web = await import('@/lib/export/save.web');
    let current = true;
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('document', {
      createElement: () => link,
      body: {
        appendChild: () => {
          current = false;
        },
      },
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    expect(() =>
      web.saveBinaryFile('test.zip', new Uint8Array([1]), 'application/zip', () => current),
    ).toThrow('active account changed');
    expect(link.click).not.toHaveBeenCalled();
    expect(link.remove).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:synthetic');
  });
  it.each(['json', 'zip'] as const)(
    'does not write or share a %s export if the owner changes during native availability',
    async (kind) => {
      const native = await import('@/lib/export/save.native');
      fixture.saveText.mockImplementation(native.saveTextFile);
      fixture.saveBinary.mockImplementation(native.saveBinaryFile);
      globalThis.fetch = vi.fn(
        async () => new Response(JSON.stringify({ owner: 'A' }), { status: 200 }),
      ) as typeof fetch;
      let release!: (value: boolean) => void;
      let started!: () => void;
      const waiting = new Promise<void>((resolve) => {
        started = resolve;
      });
      fixture.available.mockImplementation(() => {
        started();
        return new Promise<boolean>((resolve) => {
          release = resolve;
        });
      });
      await act(async () => {
        root = create(React.createElement(Harness));
      });
      let pending!: Promise<void>;
      await act(async () => {
        pending = kind === 'json' ? jsonExport() : zipExport();
        await waiting;
      });
      await act(async () => switchAccount('B'));
      await act(async () => {
        release(true);
        await pending;
      });
      expect(fixture.write).not.toHaveBeenCalled();
      expect(fixture.share).not.toHaveBeenCalled();
    },
  );
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
