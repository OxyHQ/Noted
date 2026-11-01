// Load the REAL Noted web build inside the desktop shell and check it mounts.
//
//   node desktop/e2e/app.mjs <path-to-binary> <screenshot.png>
//
// The shell must have been built with `packages/frontend/dist` holding the Expo web
// export. This says the bundle starts in this webview without taking the page down;
// it cannot say the app is usable, because the interesting screens sit behind an
// Oxy sign-in that CI does not have. The screenshot is the evidence.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { sleep, withSession } from './driver.mjs';

const application = process.argv[2];
const screenshotPath = process.argv[3];
if (!application || !screenshotPath) throw new Error('usage: app.mjs <binary> <screenshot.png>');

const SNAPSHOT = `
  const root = document.getElementById('root') || document.body;
  return {
    readyState: document.readyState,
    title: document.title,
    rootChildren: root.children.length,
    text: (document.body.innerText || '').trim().slice(0, 400),
    inShell: '__TAURI_INTERNALS__' in window,
    hasStorageApi: typeof navigator.storage,
    origin: location.origin,
  };
`;

/** A 16-bit PCM WAV as base64 of little-endian float32, which is what the app's engine takes. */
function wavAsFloat32Base64(path) {
  const wav = readFileSync(path);
  for (let at = 12; at + 8 <= wav.length; ) {
    const size = wav.readUInt32LE(at + 4);
    if (wav.toString('ascii', at, at + 4) === 'data') {
      const count = Math.floor(size / 2);
      const floats = new Float32Array(count);
      for (let index = 0; index < count; index += 1) {
        floats[index] = wav.readInt16LE(at + 8 + index * 2) / 32768;
      }
      return Buffer.from(floats.buffer).toString('base64');
    }
    at += 8 + size + (size % 2);
  }
  throw new Error(`no data chunk in ${path}`);
}

await withSession(application, async ({ run, runAsync, screenshot }) => {
  let state = null;
  // Expo's bundle is large and the page fetches fonts and config: allow a minute.
  for (let attempt = 0; attempt < 90; attempt += 1) {
    state = await run(SNAPSHOT);
    if (state.rootChildren > 0 && state.text.length > 0) break;
    await sleep(1000);
  }
  console.log(JSON.stringify(state, null, 2));

  writeFileSync(screenshotPath, Buffer.from(await screenshot(), 'base64'));
  console.log(`screenshot written to ${screenshotPath}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Noted web app inside the desktop shell\n\n- mounted: \`${state.rootChildren > 0 && state.text.length > 0}\`\n- in shell: \`${state.inShell}\`\n- origin: \`${state.origin}\`\n- \`navigator.storage\`: \`${state.hasStorageApi}\`\n- visible text: \`${JSON.stringify(state.text.slice(0, 120))}\`\n`,
    );
  }

  // The whole local-store chain, in the real shell: only in a build made with
  // EXPO_PUBLIC_E2E=1, which installs the hook that lets us skip the Oxy sign-in.
  let store = null;
  if (process.env.E2E_STORE === '1') {
    store = await runAsync(
      `const done = arguments[arguments.length - 1];
       const hook = window.__NOTED_E2E_HOOK__;
       if (!hook) { done({ error: 'the e2e hook is not installed' }); return; }
       hook.run('e2e-user').then(done, (error) => done({ error: String(error) }));`,
    );
    console.log(JSON.stringify({ store }, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `\n### Local store inside the shell (broker → engine → driver → Rust → SQLite)\n\n\`\`\`json\n${JSON.stringify(store, null, 2)}\n\`\`\`\n`,
      );
    }
    const ok =
      store &&
      !store.error &&
      store.title === 'stored in Rust' &&
      store.body === 'hello from the desktop shell' &&
      store.noteCount === 1 &&
      store.userVersion > 0;
    if (!ok) {
      console.error('::error::the local store did not work end to end inside the shell');
      process.exitCode = 1;
    }
  }

  // Speech to text, end to end, with the REAL sidecar: the web app's own engine →
  // the desktop adapter → Tauri IPC → the Rust command → whisper-cli → the app's
  // model (placed where Rust looks for it) → segments. Needs the job to have built
  // the sidecar and fetched the model, and the e2e build for the hook.
  if (process.env.E2E_STT === '1') {
    const audio = wavAsFloat32Base64(process.env.E2E_SAMPLE);
    // The packaged path: Tauri must have copied the sidecar next to the executable.
    if (!existsSync(join(dirname(application), 'whisper-cli'))) {
      console.error('::error::externalBin did not put whisper-cli next to the shell executable');
      process.exitCode = 1;
    }
    const outcome = await runAsync(
      `const done = arguments[arguments.length - 1];
       const hook = window.__NOTED_E2E_HOOK__;
       if (!hook) { done({ error: 'the e2e hook is not installed' }); return; }
       hook.transcribe(arguments[0]).then((segments) => done({ segments }), (error) => done({ error: String(error) }));`,
      [audio],
    );
    console.log(JSON.stringify({ transcription: outcome }, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `\n### Speech to text inside the shell (web engine → adapter → Rust → whisper.cpp)\n\n\`\`\`json\n${JSON.stringify(outcome, null, 2)}\n\`\`\`\n`,
      );
    }
    const segments = outcome?.segments ?? [];
    const text = segments
      .map((segment) => segment.text)
      .join(' ')
      .toLowerCase();
    const end = segments.at(-1)?.endMs ?? 0;
    if (
      outcome?.error ||
      !text.includes('ask not what your country can do for you') ||
      !(end >= 9000 && end <= 13000)
    ) {
      console.error('::error::speech to text did not work end to end inside the shell');
      process.exitCode = 1;
    }
  }

  // Model downloads, end to end: the app's real manager fetches over HTTP and streams
  // to Rust, which verifies size and sha256 before the file becomes visible. A local
  // server stands in for the model host (it rate-limits CI), serving the real `tiny`
  // model and, at another path, a same-sized corrupt copy that must be refused.
  if (process.env.E2E_MODELS === '1') {
    const good = readFileSync(process.env.E2E_MODEL_FILE);
    const corrupt = Buffer.alloc(good.length);
    const ranges = [];
    const server = createServer((request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Headers', 'Range');
      if (request.url !== '/hidden') {
        response.setHeader('Access-Control-Expose-Headers', 'Content-Range');
      }
      if (request.method === 'OPTIONS') {
        response.writeHead(204).end();
        return;
      }
      const body =
        request.url === '/good' || request.url === '/hidden'
          ? good
          : request.url === '/corrupt'
            ? corrupt
            : null;
      if (!body) {
        response.writeHead(404).end();
        return;
      }
      const range = /^bytes=(\d+)-$/.exec(request.headers.range ?? '');
      if (range) {
        ranges.push(request.headers.range);
        const from = Number(range[1]);
        response.writeHead(206, {
          'Content-Length': body.length - from,
          'Content-Range': `bytes ${from}-${body.length - 1}/${body.length}`,
        });
        response.end(body.subarray(from));
        return;
      }
      response.writeHead(200, { 'Content-Length': body.length });
      response.end(body);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const download = (path) =>
      runAsync(
        `const done = arguments[arguments.length - 1];
         window.__NOTED_E2E_HOOK__.downloadModel('tiny', arguments[0] + arguments[1]).then(done, (e) => done({ hookError: String(e) }));`,
        [base, path],
      );
    const refused = await download('/corrupt');
    const accepted = await download('/good');
    const removed = await runAsync(
      `const done = arguments[arguments.length - 1];
       window.__NOTED_E2E_HOOK__.removeModel('tiny').then(done, (e) => done({ hookError: String(e) }));`,
      [],
    );

    // An interrupted download: the first part of the file is already on disk. The
    // manager must ask for the rest, and Rust's sha256 over the stitched file is what
    // proves the halves joined correctly.
    const half = Math.floor(good.length / 2);
    const seeded = await runAsync(
      `const done = arguments[arguments.length - 1];
       window.__NOTED_E2E_HOOK__.seedPartial('tiny', arguments[0]).then(done, (e) => done({ hookError: String(e) }));`,
      [good.subarray(0, half).toString('base64')],
    );
    // CORS must expose Content-Range to the shell. A hidden header must fail
    // before writing; the following success verifies that the partial survived.
    const hidden = await download('/hidden');
    const resumed = await download('/good');
    await runAsync(
      `const done = arguments[arguments.length - 1];
       window.__NOTED_E2E_HOOK__.removeModel('tiny').then(done, () => done(null));`,
      [],
    );
    server.close();
    const report = {
      refused,
      accepted,
      removed,
      resume: { seeded, half, hidden, resumed, ranges },
    };
    console.log(JSON.stringify({ modelDownload: report }, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `\n### Model download inside the shell\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`,
      );
    }
    if (
      refused?.before !== 'absent' ||
      refused?.after !== 'absent' ||
      !refused?.error ||
      accepted?.after !== 'ready' ||
      accepted?.error ||
      removed !== 'absent' ||
      seeded !== half ||
      hidden?.after !== 'absent' ||
      !String(hidden?.error).includes('invalid Content-Range') ||
      resumed?.after !== 'ready' ||
      resumed?.error ||
      ranges.length !== 2 ||
      ranges.some((range) => range !== `bytes=${half}-`)
    ) {
      console.error('::error::model download did not behave end to end inside the shell');
      process.exitCode = 1;
    }
  }

  if (!state.inShell) {
    console.error('::error::the page is not running inside the desktop shell');
    process.exitCode = 1;
  }
  if (!(state.rootChildren > 0 && state.text.length > 0)) {
    console.error('::error::the Noted web app did not mount inside the shell');
    process.exitCode = 1;
  }
});

// Local-first means the notes outlive the app. Open the shell AGAIN, as a new
// process, and ask the same account's database how many notes it holds: the one
// written above must still be there, read from the file Rust saved.
if (process.env.E2E_STORE === '1' && process.exitCode !== 1) {
  await withSession(application, async ({ runAsync }) => {
    // Let the page load and the hook install before calling it.
    let persisted = null;
    for (let attempt = 0; attempt < 60 && persisted === null; attempt += 1) {
      const answer = await runAsync(
        `const done = arguments[arguments.length - 1];
         const hook = window.__NOTED_E2E_HOOK__;
         if (!hook) { done(null); return; }
         hook.count('e2e-user').then(done, (error) => done({ error: String(error) }));`,
      );
      if (answer !== null) persisted = answer;
      else await sleep(1000);
    }
    console.log(JSON.stringify({ persistedNoteCount: persisted }, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `\n- after restarting the shell, the account's database still holds \`${JSON.stringify(persisted)}\` note(s)\n`,
      );
    }
    if (typeof persisted !== 'number' || persisted < 1) {
      console.error('::error::the note did not survive restarting the shell');
      process.exitCode = 1;
    }
  });
}
