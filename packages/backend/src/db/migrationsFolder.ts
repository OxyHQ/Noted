/**
 * Where the SQL migrations live — ONE constant, because two things read it.
 *
 * `db/migrate.ts` applies the folder; `db/postgres.ts` reads the same folder's
 * journal to decide whether a task may serve traffic (`GET /health/ready`). If
 * those two disagreed, readiness would assert against a journal the migrator
 * does not apply — and it would PASS, because a journal nobody applies has
 * nothing pending. A gate that cannot fail is worse than no gate, so the path is
 * stated once here rather than copied into both.
 *
 * It cannot simply be imported from `migrate.ts`: that module runs its `main()`
 * at load, so importing it to borrow a constant would run a migration.
 *
 * ## Resolved by finding the PACKAGE ROOT, not by counting directories
 *
 * No fixed depth is correct for every way this module runs. `bun run db:migrate`
 * executes the TypeScript source at `src/db/`; the shipped build is a single
 * bundled `dist/index.js` at the package root. Walking up to the nearest
 * `package.json` is depth-independent, so it is right for both — and it throws
 * rather than guessing, because a silent fallback here produces a migrator
 * pointed at an empty directory that reports "nothing to do".
 *
 * `import.meta.url` and not `__dirname`: this package is ESM (`"type":
 * "module"`, esbuild `format: 'esm'`), where `__dirname` does not exist. The
 * scaffold in `create-oxy-app` uses `__dirname` because it compiles to CommonJS;
 * the resolution strategy is the same, only the way to ask "where am I" differs.
 *
 * NOTE for the container image: the runtime stage must copy `drizzle/` beside
 * `package.json` — for the migration task AND for every serving task, since
 * readiness reads the journal from here.
 */

import { existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The nearest ancestor of `from` (inclusive) holding a `package.json`. */
function findPackageRoot(from: string): string {
  const { root } = parse(from);
  let dir = from;
  while (!existsSync(join(dir, 'package.json'))) {
    if (dir === root) {
      throw new Error(
        `Could not locate the backend package root above ${from}, so the drizzle ` +
          `migrations folder cannot be resolved. The runtime image must ship ` +
          `packages/backend/package.json beside the bundle.`,
      );
    }
    dir = dirname(dir);
  }
  return dir;
}

export const MIGRATIONS_FOLDER = join(
  findPackageRoot(dirname(fileURLToPath(import.meta.url))),
  'drizzle',
);
