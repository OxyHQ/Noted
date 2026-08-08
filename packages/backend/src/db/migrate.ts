/**
 * Apply the SQL migrations in `packages/backend/drizzle/` to `DATABASE_URL`.
 *
 * This is the ONE migration mechanism for this package. `bun run db:migrate`
 * runs it, and production runs its bundled form as a one-shot task before the
 * new image rolls out. Nothing applies a migration by any other route.
 *
 * ## Why not `drizzle-kit migrate`
 *
 * drizzle-kit is a devDependency and the shipped image installs production
 * dependencies only, so the CLI cannot reach production at all. `drizzle-orm` —
 * a runtime dependency — ships the migrator itself. Both tools share ONE ledger,
 * so drizzle-kit stays a devDependency for `db:generate`, which only ever runs
 * on a developer's machine.
 *
 * ## `--target-database=<name>` is REQUIRED, on every run including a dry run
 *
 * This is the guard whose absence does not fail loudly: pointed at the wrong
 * database a migrator finds an empty ledger, applies the entire journal, logs
 * `Applied N` and exits 0 — leaving the real database untouched while the
 * operator reads a success line.
 *
 *     bun run db:migrate --target-database=noted_dev
 *
 * ## `--phase=pre|post|all`, default `all`
 *
 * Every generated `.sql` file must carry `-- oxy:deploy-phase=pre` or
 * `-- oxy:deploy-phase=post` on its own line. An unmarked migration is a hard
 * failure here, before any DDL runs.
 *
 *   `pre`  — additive only (new table, new defaulted column, widened CHECK).
 *   `post` — anything that takes something away (DROP, RENAME, narrowed
 *            constraint), applied only once the new image is live.
 *
 * The default is `all` because a developer's own database has no previous image
 * to protect. A deploy workflow passes `pre` and `post` explicitly.
 *
 * ## `DRY_RUN`
 *
 * `DRY_RUN=true` reports what WOULD be applied and writes nothing — not even the
 * ledger table.
 */

import {
  MIGRATION_RUNS,
  readTargetDatabase,
  runMigrations,
  type MigrationRun,
  type RequiredExtension,
} from '@oxyhq/db/migrate';

import { log } from '../lib/logger.js';
import { MIGRATIONS_FOLDER } from './migrationsFolder.js';

/**
 * The Postgres extensions this app's schema depends on, ensured before any
 * migration is applied rather than inside a numbered one.
 *
 * Empty: nothing in Noted's schema names an extension-provided type. Full-text
 * search uses the built-in `tsvector`, which needs no extension. Add an entry
 * the moment a column names one — a migration naming an absent extension's type
 * fails only on a FRESH database, which is the shape that passes on a warm
 * developer machine and then fails in CI.
 */
const REQUIRED_EXTENSIONS: readonly RequiredExtension[] = [];

/** Whether `DRY_RUN` asks for a report instead of an apply. */
function isDryRun(): boolean {
  const value = (process.env.DRY_RUN ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

/**
 * Read `--phase=<pre|post|all>` out of an argument list, defaulting to `all`.
 *
 * An unrecognised value throws rather than falling back: silently running `all`
 * for someone who typed `--phase=pre-deploy` is exactly the drop-applied-too-early
 * outage the phases exist to prevent.
 */
function readPhase(argv: readonly string[]): MigrationRun {
  const prefix = '--phase=';
  const flag = argv.find((arg) => arg.startsWith(prefix));
  if (!flag) return 'all';

  const value = flag.slice(prefix.length).trim();
  if (!(MIGRATION_RUNS as readonly string[]).includes(value)) {
    throw new Error(
      `Unrecognised --phase=${JSON.stringify(value)}. Use one of: ${MIGRATION_RUNS.join(', ')}.`,
    );
  }
  return value as MigrationRun;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // Before DATABASE_URL, and before anything opens a socket: an operator who
  // forgot the flag should learn it instantly rather than after a connection.
  const expectedDatabase = readTargetDatabase(argv);
  const run = readPhase(argv);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is not set. Start a local Postgres with: ' +
        'docker compose -f docker-compose.postgres.yml up -d postgres',
    );
  }

  await runMigrations({
    databaseUrl,
    migrationsFolder: MIGRATIONS_FOLDER,
    extensions: REQUIRED_EXTENSIONS,
    run,
    expectedDatabase,
    dryRun: isDryRun(),
    logger: log.general,
  });
}

main().catch((error: unknown) => {
  log.general.error({ err: error }, 'Postgres migration failed');
  process.exitCode = 1;
});
