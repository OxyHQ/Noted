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

await withSession(application, async ({ run, screenshot }) => {
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

  if (!state.inShell) {
    console.error('::error::the page is not running inside the desktop shell');
    process.exitCode = 1;
  }
  if (!(state.rootChildren > 0 && state.text.length > 0)) {
    console.error('::error::the Noted web app did not mount inside the shell');
    process.exitCode = 1;
  }
});
