import * as esbuild from 'esbuild';

await esbuild.build({
  // Operational entry points ship beside the server. `src/db/migrate.ts` is
  // what the deploy runs as a
  // one-shot task before the rollout, and it has to be in the SAME image as the
  // server it migrates for — otherwise the image ships a service whose readiness
  // probe asserts a migration nothing in that image can apply.
  // `register-capability-catalog.ts` publishes the exact catalog compiled into
  // this image after migrations and before the rollout.
  entryPoints: [
    'src/index.ts',
    'src/db/migrate.ts',
    'src/register-capability-catalog.ts',
  ],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  outdir: 'dist',
  entryNames: '[name]',
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
