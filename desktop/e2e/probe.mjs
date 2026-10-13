// Load the probe page in the built desktop shell through tauri-driver (WebDriver) and
// print what the webview supports.
//
//   node desktop/e2e/probe.mjs <path-to-binary>
//
// Hard requirements fail the run; everything else is reported, because "this engine
// has no WebGPU" is a finding to record, not a reason to keep CI red forever.
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const application = process.argv[2];
if (!application) throw new Error('usage: probe.mjs <path-to-binary>');

const BASE = 'http://127.0.0.1:4444';
const driver = spawn('tauri-driver', [], { stdio: 'inherit' });
driver.on('error', (error) => {
  console.error('could not start tauri-driver:', error.message);
  process.exit(1);
});

async function request(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${JSON.stringify(json)}`);
  return json.value;
}

async function waitForDriver() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await fetch(`${BASE}/status`);
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error('tauri-driver never came up');
}

let sessionId;
try {
  await waitForDriver();
  const session = await request('POST', '/session', {
    capabilities: { alwaysMatch: { 'tauri:options': { application } } },
  });
  sessionId = session.sessionId;

  let probe = null;
  for (let attempt = 0; attempt < 30 && probe === null; attempt += 1) {
    probe = await request('POST', `/session/${sessionId}/execute/sync`, {
      script: "return document.body && document.body.getAttribute('data-probe')",
      args: [],
    });
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
  if (missing.length > 0) {
    console.error(`::error::this webview lacks what the recorder needs: ${missing.join(', ')}`);
    process.exitCode = 1;
  }
} finally {
  if (sessionId) await request('DELETE', `/session/${sessionId}`).catch(() => undefined);
  driver.kill();
}
