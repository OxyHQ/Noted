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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchModel, readModelRecord } from './models.mjs';

const [binary, sample, workdir] = process.argv.slice(2);
if (!binary || !sample || !workdir) throw new Error('usage: verify.mjs <binary> <wav> <workdir>');

// The app's own `tiny` model: fetched and verified against models.ts.
const modelPath = await fetchModel(readModelRecord('tiny'), workdir);

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
