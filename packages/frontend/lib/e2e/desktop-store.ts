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

import { plainText } from '@/lib/notes/blocks';
import { execute, setActiveViewer } from '@/lib/db/client';
import { newNoteId } from '@/lib/db/ids';
import { createNote, getNote } from '@/lib/db/notes-repo';
import { loadTauriInvoke } from '@/lib/db/desktop-driver';
import { createDesktopModels } from '@/lib/stt/desktop-models';
import { transcribeSamples } from '@/lib/stt/engine.web';
import { STT_MODELS, type SttModelId } from '@/lib/stt/models';

export interface DesktopStoreReport {
  title: string | undefined;
  body: string | undefined;
  noteCount: number;
  userVersion: number;
}

async function run(viewer: string): Promise<DesktopStoreReport> {
  await setActiveViewer(viewer);

  const id = newNoteId();
  await createNote(
    id,
    {
      title: 'stored in Rust',
      blocks: [
        {
          id: newNoteId(),
          parentBlockId: null,
          type: 'paragraph',
          content: { text: 'hello from the desktop shell' },
          order: 0,
        },
      ],
    },
    viewer,
  );
  const note = await getNote(id, viewer);

  const count = await execute<{ n: number }>('SELECT COUNT(*) AS n FROM notes', [], viewer);
  const version = await execute<{ user_version: number }>('PRAGMA user_version', [], viewer);

  return {
    title: note?.title,
    body: note ? plainText(note.blocks) : undefined,
    noteCount: Number(count[0]?.n ?? 0),
    userVersion: Number(version[0]?.user_version ?? 0),
  };
}

/** How many notes the account's database holds, opened fresh: the persistence check. */
async function count(viewer: string): Promise<number> {
  await setActiveViewer(viewer);
  const rows = await execute<{ n: number }>('SELECT COUNT(*) AS n FROM notes', [], viewer);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Transcribe audio through the web app's REAL engine (`transcribeSamples`), which in
 * the desktop shell hands it to the whisper.cpp sidecar. `samples` is base64 of
 * little-endian float32 PCM at 16 kHz, mono.
 */
async function transcribe(samples: string) {
  const bytes = Uint8Array.from(atob(samples), (character) => character.charCodeAt(0));
  const pcm = new Float32Array(bytes.buffer);
  const segments = await transcribeSamples(pcm, 'e2e-capture', 'en', 0, 0);
  return segments.map(({ text, startMs, endMs }) => ({ text, startMs, endMs }));
}

/**
 * Download a speech model through the app's REAL desktop manager, from `url` (a local
 * test server, since the catalogue's host rate-limits CI), and report what Rust says.
 */
async function downloadModel(id: SttModelId, url: string) {
  const model = { ...STT_MODELS[id], url };
  const models = createDesktopModels(loadTauriInvoke);
  const before = await models.stateOf(model);
  const progress: number[] = [];
  let error: string | null = null;
  try {
    await models.download(model, (fraction) => progress.push(fraction));
  } catch (caught) {
    error = String(caught);
  }
  return {
    before,
    after: await models.stateOf(model),
    error,
    lastProgress: progress.at(-1) ?? null,
  };
}

/** Leave the first `count` bytes of `base64` as an interrupted download would. */
async function seedPartial(id: SttModelId, base64: string) {
  const invoke = await loadTauriInvoke();
  await invoke('model_write', { name: STT_MODELS[id].filename, chunk: base64, reset: true });
  return invoke<number>('model_partial', { name: STT_MODELS[id].filename });
}

async function removeModel(id: SttModelId) {
  const models = createDesktopModels(loadTauriInvoke);
  await models.remove(STT_MODELS[id]);
  return models.stateOf(STT_MODELS[id]);
}

declare global {
  interface Window {
    __NOTED_E2E_HOOK__?: {
      run: (viewer: string) => Promise<DesktopStoreReport>;
      count: (viewer: string) => Promise<number>;
      transcribe: (samples: string) => ReturnType<typeof transcribe>;
      downloadModel: (id: SttModelId, url: string) => ReturnType<typeof downloadModel>;
      removeModel: (id: SttModelId) => ReturnType<typeof removeModel>;
      seedPartial: (id: SttModelId, base64: string) => ReturnType<typeof seedPartial>;
    };
  }
}

if (typeof window !== 'undefined')
  window.__NOTED_E2E_HOOK__ = { run, count, transcribe, downloadModel, removeModel, seedPartial };
