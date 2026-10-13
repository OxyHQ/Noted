// Prove the whisper.cpp command-line binary can be the desktop shell's transcriber.
//
//   node desktop/sidecar/verify.mjs <whisper-cli binary> <sample.wav> <workdir>
//
// It uses the SAME model the app downloads on a phone — the file name, URL and
// sha256 are read out of `packages/frontend/lib/stt/models.ts`, so this also checks
// that the digest recorded there is the digest of that file — then transcribes a
// sample with a known sentence and checks what the app needs from a transcript: the
// words, and segments with millisecond offsets (they become `transcript_segments`).
//
// It says the sidecar approach WORKS. It does not say the shell can run it (that is a
// separate step) or how fast it is on a real laptop.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [binary, sample, workdir] = process.argv.slice(2);
if (!binary || !sample || !workdir) throw new Error('usage: verify.mjs <binary> <wav> <workdir>');
mkdirSync(workdir, { recursive: true });

// ── The app's own record of the model ──────────────────────────────
const source = readFileSync('packages/frontend/lib/stt/models.ts', 'utf8');
const baseUrl = /const MODEL_BASE_URL = '([^']+)'/.exec(source)?.[1];
const block = source.slice(source.indexOf('tiny: {'), source.indexOf('base: {'));
const filename = /filename: '([^']+)'/.exec(block)?.[1];
const sha256 = /sha256: '([0-9a-f]{64})'/.exec(block)?.[1];
const bytes = Number(/bytes: ([\d_]+)/.exec(block)?.[1]?.replaceAll('_', ''));
if (!baseUrl || !filename || !sha256 || !bytes)
  throw new Error('could not read the tiny model from models.ts');

// ── Fetch and verify the weights, exactly as the app does ──────────
const modelPath = join(workdir, filename);
if (!existsSync(modelPath)) {
  console.log(`downloading ${filename} (${bytes} bytes)`);
  const response = await fetch(`${baseUrl}/${filename}`);
  if (!response.ok) throw new Error(`download failed: ${response.status}`);
  writeFileSync(modelPath, Buffer.from(await response.arrayBuffer()));
}
const weights = readFileSync(modelPath);
const digest = createHash('sha256').update(weights).digest('hex');
console.log(`model: ${filename}  ${weights.length} bytes  sha256 ${digest}`);
if (weights.length !== bytes)
  throw new Error(`size ${weights.length} != ${bytes} recorded in models.ts`);
if (digest !== sha256) throw new Error(`sha256 ${digest} != ${sha256} recorded in models.ts`);

// ── Transcribe ─────────────────────────────────────────────────────
const outBase = join(workdir, 'result');
const run = spawnSync(binary, ['-m', modelPath, '-f', sample, '-l', 'en', '-oj', '-of', outBase], {
  encoding: 'utf8',
});
console.log(run.stdout.split('\n').slice(-12).join('\n'));
if (run.status !== 0) {
  console.error(run.stderr);
  throw new Error(`whisper exited with ${run.status}`);
}

const result = JSON.parse(readFileSync(`${outBase}.json`, 'utf8'));
const segments = result.transcription ?? [];
const text = segments
  .map((segment) => segment.text)
  .join(' ')
  .toLowerCase();
console.log(
  JSON.stringify(
    segments.map(({ text: t, offsets }) => ({ text: t, offsets })),
    null,
    2,
  ),
);

const failures = [];
if (!text.includes('ask not what your country can do for you'))
  failures.push(`unexpected text: ${text}`);
if (segments.length === 0) failures.push('no segments');
for (const segment of segments) {
  const { from, to } = segment.offsets ?? {};
  if (!(Number.isFinite(from) && Number.isFinite(to) && to > from)) {
    failures.push(`segment without usable offsets: ${JSON.stringify(segment)}`);
  }
}
const end = segments.at(-1)?.offsets?.to ?? 0;
// The sample is eleven seconds long.
if (end < 9_000 || end > 13_000)
  failures.push(`last segment ends at ${end} ms, expected about 11000`);

if (failures.length > 0) {
  for (const failure of failures) console.error(`::error::${failure}`);
  process.exit(1);
}
console.log(`ok: ${segments.length} segment(s), ending at ${end} ms`);
