/**
 * A test hook for the desktop shell's local store. NEVER part of a production build.
 *
 * It exists because the screens that use the local store sit behind an Oxy sign-in
 * that CI cannot perform, so the chain the shell depends on — the broker, the real
 * store engine, the desktop driver, Rust, SQLite — would otherwise only be checked
 * link by link. This runs that whole chain the way the app does: activate an
 * account, let the engine open and migrate its database, write a note through the
 * note repository, read it back.
 *
 * Loaded only when the web export is built with `EXPO_PUBLIC_E2E=1` (the
 * app-in-shell CI job). Metro inlines that variable and drops the branch in any
 * other build; `.github/workflows/ci.yml` checks the ordinary build for the hook's
 * name so a leak fails the pull request.
 */

import { execute, setActiveViewer } from '@/lib/db/client';
import { newNoteId } from '@/lib/db/ids';
import { createNote, getNote } from '@/lib/db/notes-repo';

export interface DesktopStoreReport {
  title: string | undefined;
  body: string | undefined;
  noteCount: number;
  userVersion: number;
  reopenedNoteCount: number;
}

async function run(viewer: string): Promise<DesktopStoreReport> {
  await setActiveViewer(viewer);

  const id = newNoteId();
  await createNote(
    id,
    { title: 'stored in Rust', userBody: 'hello from the desktop shell' },
    viewer,
  );
  const note = await getNote(id, viewer);

  const count = await execute<{ n: number }>('SELECT COUNT(*) AS n FROM notes', [], viewer);
  const version = await execute<{ user_version: number }>('PRAGMA user_version', [], viewer);

  return {
    title: note?.title,
    body: note?.body,
    noteCount: Number(count[0]?.n ?? 0),
    userVersion: Number(version[0]?.user_version ?? 0),
    reopenedNoteCount: 0,
  };
}

declare global {
  interface Window {
    __NOTED_E2E_HOOK__?: { run: (viewer: string) => Promise<DesktopStoreReport> };
  }
}

if (typeof window !== 'undefined') window.__NOTED_E2E_HOOK__ = { run };
