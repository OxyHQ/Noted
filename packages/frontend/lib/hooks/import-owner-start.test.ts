import React from 'react';
import { createRequire } from 'node:module';
import { OxyServices } from '@oxy.so/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  picker: vi.fn(),
  read: vi.fn(),
  create: vi.fn(),
  sync: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => fixture.auth }));
vi.mock('@/lib/oxy', () => ({
  get oxyServices() {
    return fixture.oxy;
  },
}));
vi.mock('expo-document-picker', () => ({
  getDocumentAsync: (...args: unknown[]) => fixture.picker(...args),
}));
vi.mock('@/lib/import/read-file', () => ({
  readPickedText: (...args: unknown[]) => fixture.read(...args),
}));
vi.mock('@/lib/db/client', () => ({ getActiveViewerId: () => fixture.viewer }));
vi.mock('@/lib/db/ids', () => ({ newNoteId: () => 'synthetic-id' }));
vi.mock('@/lib/db/notes-repo', () => ({
  createNote: (...args: unknown[]) => fixture.create(...args),
}));
vi.mock('@/lib/db/labels-repo', () => ({ saveLabel: vi.fn() }));
vi.mock('@/lib/db/use-local-store', () => ({
  requestSync: (...args: unknown[]) => fixture.sync(...args),
}));
vi.mock('@/lib/api/client', () => ({ default: { post: vi.fn() } }));
vi.mock('@/lib/hooks/use-labels', () => ({ useLabels: () => ({ data: [] }) }));
vi.mock('@oxy.so/bloom/toast', () => ({
  toast: {
    success: (...args: unknown[]) => fixture.success(...args),
    error: (...args: unknown[]) => fixture.error(...args),
  },
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { useImportNotes } from '@/lib/hooks/use-import-notes';

let oxy: OxyServices;
let root: ReturnType<typeof create>;
let pickAndImport: ReturnType<typeof useImportNotes>['pickAndImport'];
function Harness() {
  pickAndImport = useImportNotes().pickAndImport;
  return null;
}
async function switchAccount(viewer: string) {
  fixture.viewer = viewer;
  fixture.auth.user = { id: viewer };
  fixture.auth.activeSessionId = `session-${viewer}`;
  await act(async () => root.update(React.createElement(Harness)));
}
beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.viewer = 'A';
  oxy = new OxyServices({ baseURL: 'https://noted.example' });
  fixture.oxy = oxy;
  fixture.auth = {
    isAuthenticated: true,
    user: { id: 'A' },
    activeSessionId: 'session-A',
    oxyServices: oxy,
  };
  fixture.picker
    .mockReset()
    .mockResolvedValue({ canceled: false, assets: [{ name: 'example.md', uri: 'mock://file' }] });
  fixture.read.mockReset().mockResolvedValue('# Imported note\n\nSynthetic content');
  fixture.create
    .mockReset()
    .mockImplementation(async (_id: string, _input: unknown, viewer: string) => {
      if (viewer !== fixture.viewer) throw new Error('The active account changed');
    });
  fixture.sync.mockReset();
  fixture.success.mockReset();
  fixture.error.mockReset();
  await act(async () => {
    root = create(React.createElement(Harness));
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  oxy.dispose();
});
describe('import ownership', () => {
  it('imports a local Markdown file while a restored session has no bearer', async () => {
    await act(async () => {
      await pickAndImport();
    });
    expect(fixture.create).toHaveBeenCalledWith(
      'synthetic-id',
      expect.objectContaining({ title: 'Imported note' }),
      'A',
    );
    expect(fixture.success).toHaveBeenCalledOnce();
  });
  it('does not start a retained A import after switching to B', async () => {
    const retained = pickAndImport;
    await switchAccount('B');
    await act(async () => {
      await retained();
    });
    expect(fixture.picker).not.toHaveBeenCalled();
    expect(fixture.create).not.toHaveBeenCalled();
  });
  it('still starts an import from the current B account', async () => {
    await switchAccount('B');
    await act(async () => {
      await pickAndImport();
    });
    expect(fixture.create).toHaveBeenCalledWith(
      'synthetic-id',
      expect.objectContaining({ title: 'Imported note' }),
      'B',
    );
  });
  it('does not revive a retained A callback after A to B to A', async () => {
    const retained = pickAndImport;
    await switchAccount('B');
    await switchAccount('A');
    await act(async () => {
      await retained();
    });
    expect(fixture.picker).not.toHaveBeenCalled();
  });
  it('rejects a different or opaque bearer for a projected A account', async () => {
    const claims = Buffer.from(
      JSON.stringify({ userId: 'B', sessionId: 'session-B', exp: 4102444800 }),
    ).toString('base64url');
    for (const token of [`h.${claims}.s`, 'opaque-token']) {
      await act(async () => {
        oxy.session.setAccessToken(token);
      });
      await act(async () => {
        await pickAndImport();
      });
      expect(fixture.picker).not.toHaveBeenCalled();
    }
  });
  it('does not start tokenless without a projected session id', async () => {
    fixture.auth.activeSessionId = '';
    await act(async () => root.update(React.createElement(Harness)));
    await act(async () => {
      await pickAndImport();
    });
    expect(fixture.picker).not.toHaveBeenCalled();
  });
  it('preserves existing behavior for a picker already open during A to B to A', async () => {
    let release!: (value: unknown) => void;
    fixture.picker.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    let pending!: ReturnType<typeof pickAndImport>;
    await act(async () => {
      pending = pickAndImport();
      await Promise.resolve();
    });
    await switchAccount('B');
    await switchAccount('A');
    await act(async () => {
      release({ canceled: false, assets: [{ name: 'example.md', uri: 'mock://file' }] });
      await pending;
    });
    expect(fixture.create).toHaveBeenCalledOnce();
    expect(fixture.success).toHaveBeenCalledOnce();
  });
});
