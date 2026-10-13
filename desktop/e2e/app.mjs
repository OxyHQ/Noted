// Load the REAL Noted web build inside the desktop shell and check it mounts.
//
//   node desktop/e2e/app.mjs <path-to-binary> <screenshot.png>
//
// The shell must have been built with `packages/frontend/dist` holding the Expo web
// export. This says the bundle starts in this webview without taking the page down;
// it cannot say the app is usable, because the interesting screens sit behind an
// Oxy sign-in that CI does not have. The screenshot is the evidence.
import { appendFileSync, writeFileSync } from 'node:fs';
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

  if (!state.inShell) {
    console.error('::error::the page is not running inside the desktop shell');
    process.exitCode = 1;
  }
  if (!(state.rootChildren > 0 && state.text.length > 0)) {
    console.error('::error::the Noted web app did not mount inside the shell');
    process.exitCode = 1;
  }
});
