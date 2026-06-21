import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/index.js',
  // Keep node_modules external except @oxyhq/* (their ESM builds have broken
  // imports) and @noted/* workspace packages (e.g. @noted/shared-types — a
  // private workspace dep that is NOT published, so it must be inlined into the
  // bundle; the runtime image never carries its dist).
  plugins: [{
    name: 'externalize-except-workspace',
    setup(build) {
      // Bundle (inline) our own workspace packages and @oxyhq/* (whose ESM has
      // missing .js extensions). Returning undefined lets esbuild resolve +
      // bundle the import instead of externalizing it.
      build.onResolve({ filter: /^@oxyhq\// }, () => undefined);
      build.onResolve({ filter: /^@noted\// }, () => undefined);
      // Externalize every other bare import (real node_modules).
      build.onResolve({ filter: /^[^./]/ }, args => {
        if (args.path.startsWith('@oxyhq/') || args.path.startsWith('@noted/')) return undefined;
        return { path: args.path, external: true };
      });
    },
  }],
  sourcemap: false,
  minify: false,
  logLevel: 'info',
});

console.log('✅ Build complete');
