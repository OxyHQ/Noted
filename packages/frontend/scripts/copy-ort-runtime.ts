/**
 * Put onnxruntime-web's WebAssembly runtime where the browser can fetch it.
 *
 * Web transcription runs on onnxruntime-web, which loads its WebAssembly in two
 * pieces at runtime: a JavaScript glue module and the 23 MB `.wasm` itself.
 * Neither goes through the bundler — the runtime fetches them by URL — so they
 * have to be served as static files.
 *
 * They are copied from `node_modules` at build time rather than committed: 23 MB
 * of binary in a git repository is 23 MB in every clone forever, and the files
 * belong to a pinned dependency that already has them.
 *
 * ## Why they are not simply bundled
 *
 * onnxruntime-web ships builds that embed this glue — the `.bundle.min.mjs`
 * ones, which is why its `exports` map points there. Every minified build
 * contains `import(/*webpackIgnore:true* / a)`, a dynamic import of a variable,
 * which Metro's parser rejects outright: the web bundle will not build at all.
 * So the app resolves the unminified build (see `metro.config.js`), and that one
 * carries no embedded runtime — hence this.
 */

import { existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '../../../node_modules/onnxruntime-web/dist');
const destination = join(here, '../public/ort');

/**
 * The variant the resolved build asks for.
 *
 * `ort.webgpu.mjs` selects `asyncify` at runtime. Copying the wrong variant
 * produces a 404 at the moment somebody transcribes rather than at build time,
 * so the name is asserted below rather than assumed.
 */
const FILES = [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
];

function main(): void {
  if (!existsSync(source)) {
    throw new Error(`onnxruntime-web is not installed: ${source} does not exist`);
  }
  mkdirSync(destination, { recursive: true });

  for (const file of FILES) {
    const from = join(source, file);
    if (!existsSync(from)) {
      throw new Error(
        `${file} is missing from onnxruntime-web. The build variant it ships may have ` +
          'changed; check which file `ort.webgpu.mjs` requests before editing this list.',
      );
    }
    copyFileSync(from, join(destination, file));
    // Printed because a silent copy of the wrong thing is the failure mode this
    // whole script exists to avoid.
    console.log(`ort runtime: ${file} (${String(statSync(from).size)} bytes)`);
  }
}

main();
