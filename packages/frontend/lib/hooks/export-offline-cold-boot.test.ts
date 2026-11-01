import React from 'react';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { OxyServices } from '@oxy.so/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { create, act } = require('react-test-renderer');
const fixture = vi.hoisted(() => ({
  viewer: 'A',
  oxy: null as unknown as OxyServices,
  auth: {
    isAuthenticated: true,
    user: { id: 'A' },
    activeSessionId: 'session-A',
    oxyServices: null as unknown as OxyServices,
  },
  execute: vi.fn(),
  save: vi.fn(),
}));
vi.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => fixture.auth }));
vi.mock('@/lib/oxy', () => ({
  get oxyServices() {
    return fixture.oxy;
  },
}));
vi.mock('@/lib/db/client', () => ({
  getActiveViewerId: () => fixture.viewer,
  execute: (...args: unknown[]) => fixture.execute(...args),
  executeTransaction: vi.fn(),
}));
vi.mock('@/lib/capture/captures-repo', () => ({ deleteNoteRecordings: vi.fn() }));
vi.mock('@/lib/export/save', () => ({
  saveBinaryFile: (...args: unknown[]) => fixture.save(...args),
}));
vi.mock('@oxy.so/bloom/toast', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { MIGRATIONS } from '@/lib/db/migrations';
import { useExportMarkdownZip } from '@/lib/hooks/use-export-markdown-zip';

const sqlite = await import('node:sqlite').catch(() => null);
const servicesPackage = require.resolve('@oxy.so/services/package.json');
const { createCachedBootStore } = require(
  join(dirname(servicesPackage), 'lib/commonjs/ui/session/cachedBoot.js'),
);
const originalFetch = globalThis.fetch;
let root: ReturnType<typeof create> | undefined;
let oxy: OxyServices | undefined;
let exportZip: () => Promise<void>;
function Harness() {
  exportZip = useExportMarkdownZip().exportZip;
  return null;
}
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  oxy?.dispose();
  oxy = undefined;
  globalThis.fetch = originalFetch;
});

describe('offline restored session export', () => {
  if (!sqlite) {
    it.skip('needs node:sqlite', () => {});
    return;
  }
  it('exports local notes when Services restores a cached session without a warm token', async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const values = new Map<string, string>();
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: async (key: string) => {
        values.delete(key);
      },
    };
    const cache = createCachedBootStore(storage, 'synthetic', () =>
      Date.parse('2027-01-01T00:00:00Z'),
    );
    await cache.saveLane('client', 'device');
    await cache.saveAccount({ id: 'A' });
    const cached = await cache.readSession('client', {
      load: async () => ({
        userId: 'A',
        sessionId: 'session-A',
        deviceId: 'device-A',
        deviceSecret: 'synthetic-secret',
        accessToken: 'expired-synthetic-token',
        expiresAt: '2026-01-01T00:00:00.000Z',
      }),
    });
    expect(cached?.warmToken).toBeNull();
    expect(cached?.user.id).toBe('A');

    oxy = new OxyServices({ baseURL: 'https://noted.example' });
    expect(oxy.session.userId).toBeFalsy();
    fixture.oxy = oxy;
    fixture.viewer = cached.userId;
    fixture.auth = {
      isAuthenticated: true,
      user: cached.user,
      activeSessionId: cached.sessionId,
      oxyServices: oxy,
    };
    fixture.save.mockReset().mockResolvedValue(undefined);
    const db = new sqlite.DatabaseSync(':memory:');
    try {
      for (const migration of MIGRATIONS) for (const statement of migration) db.exec(statement);
      db.prepare(
        'INSERT INTO notes (id, title, body_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run('note-A', 'Offline note', '', '2027-01-01', '2027-01-01');
      fixture.execute
        .mockReset()
        .mockImplementation(async (sql: string, params: readonly unknown[], viewer: string) => {
          expect(viewer).toBe('A');
          return db.prepare(sql).all(...(params as string[]));
        });
      const fetchSpy = vi.fn(async () => {
        throw new Error('offline');
      });
      globalThis.fetch = fetchSpy as typeof fetch;
      await act(async () => {
        root = create(React.createElement(Harness));
      });
      await act(async () => {
        await exportZip();
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(fixture.save).toHaveBeenCalledOnce();
      const bytes = fixture.save.mock.calls[0][1] as Uint8Array;
      expect(new TextDecoder().decode(bytes)).toContain('# Offline note');
      const payload = Buffer.from(
        JSON.stringify({ userId: 'A', sessionId: 'session-A', exp: 4102444800 }),
      ).toString('base64url');
      await act(async () => {
        oxy?.session.setAccessToken(`h.${payload}.s`);
      });
      fixture.save.mockClear();
      await act(async () => {
        await exportZip();
      });
      expect(fixture.save).toHaveBeenCalledOnce();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });
});
