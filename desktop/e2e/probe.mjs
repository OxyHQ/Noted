// Load the probe page in the built desktop shell through tauri-driver (WebDriver) and
// print what the webview supports.
//
//   node desktop/e2e/probe.mjs <path-to-binary>
//
// Hard requirements fail the run; everything else is reported, because "this engine
// has no WebGPU" is a finding to record, not a reason to keep CI red forever.
import { appendFileSync } from 'node:fs';
import { sleep, withSession } from './driver.mjs';

const application = process.argv[2];
if (!application) throw new Error('usage: probe.mjs <path-to-binary>');

await withSession(application, async ({ run }) => {
  let probe = null;
  for (let attempt = 0; attempt < 30 && probe === null; attempt += 1) {
    probe = await run("return document.body && document.body.getAttribute('data-probe')");
    if (probe === null) await sleep(500);
  }
  if (probe === null) throw new Error('the probe page never reported');

  const result = JSON.parse(probe);
  console.log(JSON.stringify(result, null, 2));

  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = Object.entries(result)
      .filter(([key]) => key !== 'userAgent')
      .map(([key, value]) => `| ${key} | \`${value}\` |`);
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Webview capabilities\n\n\`${result.userAgent}\`\n\n| capability | value |\n|---|---|\n${rows.join('\n')}\n`,
    );
  }

  // What the web recorder cannot work without.
  const required = ['getUserMedia', 'mediaRecorder', 'audioContext', 'audioWorklet', 'webAssembly'];
  const missing = required.filter((key) => result[key] !== 'function' && result[key] !== 'object');
  // And the native store the shell provides in place of OPFS.
  if (result.nativeSqlite !== 'ok') missing.push(`nativeSqlite (${result.nativeSqlite})`);
  if (result.refusesPathNames !== true) missing.push('refusesPathNames');
  if (missing.length > 0) {
    console.error(`::error::this webview lacks what the app needs: ${missing.join(', ')}`);
    process.exitCode = 1;
  }
});
