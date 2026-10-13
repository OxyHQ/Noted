// Put the transcriber where Tauri's `externalBin` looks for it.
//
//   node desktop/sidecar/stage.mjs <whisper-cli binary | --placeholder>
//
// `bundle.externalBin` names `binaries/whisper-cli`; at build time Tauri requires
// `binaries/whisper-cli-<target triple>[.exe]` to exist and copies it next to the
// app's executable, which is where `src/stt.rs` looks. Every job that compiles the
// shell therefore needs a file there. Jobs that do not transcribe stage a
// placeholder (it fails loudly if run); the job that does stages the real binary.
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = process.argv[2];
if (!source) throw new Error('usage: stage.mjs <whisper-cli binary | --placeholder>');

const host = /^host: (.+)$/m.exec(execFileSync('rustc', ['-vV'], { encoding: 'utf8' }))?.[1];
if (!host) throw new Error('could not read the host target triple from `rustc -vV`');

const directory = join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'binaries');
mkdirSync(directory, { recursive: true });
const target = join(directory, `whisper-cli-${host}${host.includes('windows') ? '.exe' : ''}`);

if (source === '--placeholder') {
  writeFileSync(
    target,
    '#!/bin/sh\necho "whisper-cli placeholder: the real sidecar was not staged" >&2\nexit 1\n',
  );
} else {
  copyFileSync(source, target);
}
chmodSync(target, 0o755);
console.log(`staged ${source === '--placeholder' ? 'a placeholder' : source} as ${target}`);
